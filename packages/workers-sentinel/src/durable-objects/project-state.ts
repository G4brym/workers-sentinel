import { DurableObject } from 'cloudflare:workers';
import {
	extractCulprit,
	extractMetadata,
	extractTitle,
	generateFingerprint,
} from '../lib/fingerprint';
import type { Env, FilterType, InboundFilter, Issue, ProjectSettings, SentryEvent } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  fingerprint TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  culprit TEXT,
  level TEXT NOT NULL DEFAULT 'error',
  platform TEXT NOT NULL DEFAULT 'javascript',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  user_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unresolved',
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_issues_fingerprint ON issues(fingerprint);
CREATE INDEX IF NOT EXISTS idx_issues_last_seen ON issues(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'error',
  platform TEXT,
  environment TEXT,
  release TEXT,
  transaction_name TEXT,
  user_id TEXT,
  user_email TEXT,
  user_ip TEXT,
  tags TEXT,
  data TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_issue ON events(issue_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_environment ON events(environment);
CREATE INDEX IF NOT EXISTS idx_events_release ON events(release);

CREATE TABLE IF NOT EXISTS issue_stats (
  issue_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, bucket),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issue_users (
  issue_id TEXT NOT NULL,
  user_hash TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (issue_id, user_hash),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_tags (
  event_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (event_id, key),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_tags_key_value ON event_tags(key, value);
CREATE INDEX IF NOT EXISTS idx_event_tags_issue ON event_tags(issue_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issue_environments (
  issue_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (issue_id, environment),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_issue ON issue_comments(issue_id);

CREATE TABLE IF NOT EXISTS issue_activity (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_activity_issue ON issue_activity(issue_id);

CREATE TABLE IF NOT EXISTS releases (
  version TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  new_issue_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_releases_last_seen ON releases(last_seen DESC);

CREATE TABLE IF NOT EXISTS release_issues (
  release_version TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  first_seen_in_release TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (release_version, issue_id),
  FOREIGN KEY (release_version) REFERENCES releases(version) ON DELETE CASCADE,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_release_issues_issue_id ON release_issues(issue_id);

CREATE TABLE IF NOT EXISTS source_maps (
  id TEXT PRIMARY KEY,
  release TEXT NOT NULL,
  file_url TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  UNIQUE(release, file_url)
);
CREATE INDEX IF NOT EXISTS idx_source_maps_release ON source_maps(release);
CREATE TABLE IF NOT EXISTS inbound_filters (
  id TEXT PRIMARY KEY,
  filter_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  dropped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

const MIGRATIONS = `
ALTER TABLE issues ADD COLUMN snoozed_until TEXT;
`;

export class ProjectState extends DurableObject<Env> {
	private sql: SqlStorage;
	private initialized = false;
	private rateLimitCount = 0;
	private rateLimitBucket = '';

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
	}

	private async ensureSchema(): Promise<void> {
		if (this.initialized) return;
		this.sql.exec(SCHEMA);
		try {
			this.sql.exec(MIGRATIONS);
		} catch {
			// Column already exists — migration already applied
		}
		this.sql.exec('CREATE INDEX IF NOT EXISTS idx_issues_snoozed_until ON issues(snoozed_until)');
		this.warmRateLimitCounter();
		this.initialized = true;

		// Schedule alarm if none exists (retention or pending snoozes)
		const alarm = await this.ctx.storage.getAlarm();
		if (!alarm) {
			await this.scheduleNextAlarm();
		}
	}

	async fetch(request: Request): Promise<Response> {
		await this.ensureSchema();

		const url = new URL(request.url);
		const path = url.pathname;

		try {
			switch (path) {
				case '/ingest':
					return this.handleIngest(request);
				case '/issues':
					return this.handleGetIssues(request);
				case '/issue':
					return this.handleGetIssue(request);
				case '/issue/update':
					return this.handleUpdateIssue(request);
				case '/issue/delete':
					return this.handleDeleteIssue(request);
				case '/issues/bulk-update':
					return this.handleBulkUpdateIssues(request);
				case '/issue/events':
					return this.handleGetIssueEvents(request);
				case '/event':
					return this.handleGetEvent(request);
				case '/events/latest':
					return this.handleGetLatestEvents(request);
				case '/stats':
					return this.handleGetStats(request);
				case '/config':
					return this.handleGetConfig();
				case '/config/update':
					return this.handleUpdateConfig(request);
				case '/rate-limit-status':
					return this.handleRateLimitStatus();
				case '/tags':
					return this.handleGetTags(request);
				case '/tag-values':
					return this.handleGetTagValues(request);
				case '/settings':
					return this.handleGetSettings();
				case '/settings/update':
					return this.handleUpdateSettings(request);
				case '/environments':
					return this.handleGetEnvironments();
				case '/summary':
					return this.handleGetSummary();
				case '/issue/comments':
					return this.handleGetComments(request);
				case '/issue/comment/add':
					return this.handleAddComment(request);
				case '/issue/comment/delete':
					return this.handleDeleteComment(request);
				case '/issue/activity':
					return this.handleGetActivity(request);
				case '/releases':
					return this.handleGetReleases(request);
				case '/release':
					return this.handleGetRelease(request);
				case '/issue/snooze':
					return this.handleSnoozeIssue(request);
				case '/issue/unsnooze':
					return this.handleUnsnoozeIssue(request);
				case '/sourcemaps/upload':
					return this.handleUploadSourceMap(request);
				case '/sourcemaps/list':
					return this.handleListSourceMaps(request);
				case '/sourcemaps/get':
					return this.handleGetSourceMap(request);
				case '/sourcemaps/delete':
					return this.handleDeleteSourceMap(request);
				case '/filters':
					return this.handleGetFilters();
				case '/filters/create':
					return this.handleCreateFilter(request);
				case '/filters/update':
					return this.handleUpdateFilter(request);
				case '/filters/delete':
					return this.handleDeleteFilter(request);
				default:
					return new Response(JSON.stringify({ error: 'not_found' }), {
						status: 404,
						headers: { 'Content-Type': 'application/json' },
					});
			}
		} catch (error) {
			console.error('ProjectState error:', error);
			return new Response(
				JSON.stringify({
					error: 'internal_error',
					message: error instanceof Error ? error.message : 'Unknown error',
				}),
				{ status: 500, headers: { 'Content-Type': 'application/json' } },
			);
		}
	}

	private async handleIngest(request: Request): Promise<Response> {
		// Check rate limit before processing
		const rateCheck = this.checkRateLimit();
		if (!rateCheck.allowed) {
			return new Response(
				JSON.stringify({ error: 'rate_limited', message: 'Project event quota exceeded' }),
				{
					status: 429,
					headers: {
						'Content-Type': 'application/json',
						'Retry-After': String(rateCheck.retryAfter || 3600),
					},
				},
			);
		}

		const event = (await request.json()) as SentryEvent;

		const eventId = event.event_id || crypto.randomUUID();
		const now = new Date().toISOString();
		const timestamp = event.timestamp || now;

		// Generate fingerprint
		const fingerprint = generateFingerprint(event);

		// Check inbound filters
		const enabledFilters = this.sql
			.exec('SELECT * FROM inbound_filters WHERE enabled = 1')
			.toArray();

		const matchedFilterId = this.shouldFilterEvent(event, enabledFilters);
		if (matchedFilterId) {
			this.sql.exec(
				'UPDATE inbound_filters SET dropped_count = dropped_count + 1 WHERE id = ?',
				matchedFilterId,
			);
			return this.jsonResponse({ filtered: true, eventId });
		}
		// Check for existing issue
		const existingRows = this.sql
			.exec('SELECT id, count, status FROM issues WHERE fingerprint = ?', fingerprint)
			.toArray();
		const existingIssue = existingRows.length > 0 ? existingRows[0] : null;

		let issueId: string;
		let newIssueTitle: string | undefined;
		let newIssueCulprit: string | null | undefined;

		if (existingIssue) {
			// Update existing issue
			issueId = existingIssue.id as string;
			this.sql.exec(
				'UPDATE issues SET last_seen = ?, count = count + 1 WHERE id = ?',
				now,
				issueId,
			);
		} else {
			// Create new issue
			issueId = crypto.randomUUID();
			const title = extractTitle(event);
			const culprit = extractCulprit(event);
			const metadata = extractMetadata(event);
			newIssueTitle = title;
			newIssueCulprit = culprit;

			this.sql.exec(
				`INSERT INTO issues (id, fingerprint, title, culprit, level, platform, first_seen, last_seen, count, status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'unresolved', ?)`,
				issueId,
				fingerprint,
				title,
				culprit,
				event.level || 'error',
				event.platform || 'javascript',
				now,
				now,
				JSON.stringify(metadata),
			);
		}

		// Store event
		this.sql.exec(
			`INSERT INTO events (id, issue_id, timestamp, received_at, level, platform, environment, release, transaction_name, user_id, user_email, user_ip, tags, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			eventId,
			issueId,
			timestamp,
			now,
			event.level || 'error',
			event.platform || null,
			event.environment || null,
			event.release || null,
			event.transaction || null,
			event.user?.id || null,
			event.user?.email || null,
			event.user?.ip_address || null,
			event.tags ? JSON.stringify(event.tags) : null,
			JSON.stringify(event),
		);

		// Store indexed tags
		if (event.tags && typeof event.tags === 'object') {
			for (const [key, value] of Object.entries(event.tags)) {
				if (
					typeof key === 'string' &&
					typeof value === 'string' &&
					key.length <= 200 &&
					value.length <= 200
				) {
					this.sql.exec(
						'INSERT OR IGNORE INTO event_tags (event_id, issue_id, key, value) VALUES (?, ?, ?, ?)',
						eventId,
						issueId,
						key,
						value,
					);
				}
			}
		}

		// Update hourly stats
		const bucket = this.getHourBucket(timestamp);
		this.sql.exec(
			`INSERT INTO issue_stats (issue_id, bucket, count)
       VALUES (?, ?, 1)
       ON CONFLICT (issue_id, bucket) DO UPDATE SET count = count + 1`,
			issueId,
			bucket,
		);

		// Update rate limit counter
		this.rateLimitCount++;
		const currentBucket = this.getHourBucket(new Date().toISOString());
		this.sql.exec(
			'INSERT INTO rate_limit_counters (bucket, count) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET count = count + 1',
			currentBucket,
		);
		// Track environment
		const environment = event.environment || null;
		if (environment) {
			this.sql.exec(
				`INSERT INTO issue_environments (issue_id, environment, first_seen, last_seen, event_count)
				 VALUES (?, ?, ?, ?, 1)
				 ON CONFLICT (issue_id, environment) DO UPDATE SET
				   last_seen = excluded.last_seen,
				   event_count = event_count + 1`,
				issueId,
				environment,
				now,
				now,
			);
		}

		// Track release and detect regressions
		if (event.release) {
			try {
				const releaseVersion = event.release;
				const isNewIssue = !existingIssue;

				// Upsert release record
				this.sql.exec(
					`INSERT INTO releases (version, first_seen, last_seen, event_count, issue_count, new_issue_count)
					 VALUES (?, ?, ?, 1, 0, 0)
					 ON CONFLICT (version) DO UPDATE SET
					   last_seen = ?,
					   event_count = event_count + 1`,
					releaseVersion,
					now,
					now,
					now,
				);

				// Link issue to release
				const existingLink = this.sql
					.exec(
						'SELECT release_version FROM release_issues WHERE release_version = ? AND issue_id = ?',
						releaseVersion,
						issueId,
					)
					.toArray();

				if (existingLink.length > 0) {
					this.sql.exec(
						'UPDATE release_issues SET event_count = event_count + 1 WHERE release_version = ? AND issue_id = ?',
						releaseVersion,
						issueId,
					);
				} else {
					this.sql.exec(
						'INSERT INTO release_issues (release_version, issue_id, first_seen_in_release, event_count) VALUES (?, ?, ?, 1)',
						releaseVersion,
						issueId,
						now,
					);
					// Update issue_count on the release
					this.sql.exec(
						'UPDATE releases SET issue_count = issue_count + 1 WHERE version = ?',
						releaseVersion,
					);
					// If this is a brand new issue, increment new_issue_count
					if (isNewIssue) {
						this.sql.exec(
							'UPDATE releases SET new_issue_count = new_issue_count + 1 WHERE version = ?',
							releaseVersion,
						);
					}
				}

				// Regression detection: reopen resolved issues
				if (existingIssue && existingIssue.status === 'resolved') {
					this.sql.exec("UPDATE issues SET status = 'unresolved' WHERE id = ?", issueId);
				}
			} catch (e) {
				console.error('Release tracking failed:', e);
			}
		}

		// Track unique users
		if (event.user) {
			const userHash = await this.hashUserIdentifier(event.user);
			if (userHash) {
				const existingUserRows = this.sql
					.exec(
						'SELECT issue_id FROM issue_users WHERE issue_id = ? AND user_hash = ?',
						issueId,
						userHash,
					)
					.toArray();

				if (existingUserRows.length > 0) {
					this.sql.exec(
						'UPDATE issue_users SET last_seen = ? WHERE issue_id = ? AND user_hash = ?',
						now,
						issueId,
						userHash,
					);
				} else {
					this.sql.exec(
						'INSERT INTO issue_users (issue_id, user_hash, first_seen, last_seen) VALUES (?, ?, ?, ?)',
						issueId,
						userHash,
						now,
						now,
					);
					// Update user count
					this.sql.exec('UPDATE issues SET user_count = user_count + 1 WHERE id = ?', issueId);
				}
			}
		}

		return this.jsonResponse({
			eventId,
			issueId,
			isNewIssue: !existingIssue,
			title: newIssueTitle,
			level: event.level || 'error',
			culprit: newIssueCulprit ?? null,
		});
	}

	private static readonly ALLOWED_SORT_FIELDS = new Set([
		'last_seen',
		'first_seen',
		'count',
		'user_count',
		'level',
		'title',
	]);

	private async handleGetIssues(request: Request): Promise<Response> {
		const { status, level, environment, query, sort, cursor, limit, tags } =
			(await request.json()) as {
				status?: string;
				level?: string;
				environment?: string;
				query?: string;
				sort?: string;
				cursor?: string;
				limit?: number;
				tags?: string[];
			};

		const pageLimit = Math.min(limit || 25, 100);
		const sortField = sort && ProjectState.ALLOWED_SORT_FIELDS.has(sort) ? sort : 'last_seen';
		const sortOrder = 'DESC';
		const now = new Date().toISOString();

		let sql = 'SELECT * FROM issues WHERE 1=1';
		const params: (string | number)[] = [];

		if (status === 'snoozed') {
			// Show only currently snoozed issues
			sql += ' AND snoozed_until IS NOT NULL AND snoozed_until > ?';
			params.push(now);
		} else {
			if (status) {
				sql += ' AND status = ?';
				params.push(status);
			}
			// Hide snoozed issues from default views
			sql += ' AND (snoozed_until IS NULL OR snoozed_until <= ?)';
			params.push(now);
		}

		if (level) {
			sql += ' AND level = ?';
			params.push(level);
		}

		if (environment) {
			sql += ' AND id IN (SELECT issue_id FROM issue_environments WHERE environment = ?)';
			params.push(environment);
		}

		if (query) {
			sql += ' AND (title LIKE ? OR culprit LIKE ?)';
			params.push(`%${query}%`, `%${query}%`);
		}

		if (tags && tags.length > 0) {
			for (let i = 0; i < Math.min(tags.length, 5); i++) {
				const [tagKey, ...rest] = tags[i].split(':');
				const tagValue = rest.join(':');
				if (tagKey && tagValue) {
					sql +=
						' AND id IN (SELECT DISTINCT issue_id FROM event_tags WHERE key = ? AND value = ?)';
					params.push(tagKey, tagValue);
				}
			}
		}

		if (cursor) {
			sql += ` AND ${sortField} < ?`;
			params.push(cursor);
		}

		sql += ` ORDER BY ${sortField} ${sortOrder} LIMIT ?`;
		params.push(pageLimit + 1);

		const rows = this.sql.exec(sql, ...params).toArray();
		const hasMore = rows.length > pageLimit;
		const issues = rows.slice(0, pageLimit).map((row) => this.rowToIssue(row));

		const nextCursor =
			hasMore && issues.length > 0
				? (issues[issues.length - 1] as Issue)[sortField as keyof Issue]
				: undefined;

		return this.jsonResponse({
			issues,
			nextCursor,
			hasMore,
		});
	}

	private async handleGetIssue(request: Request): Promise<Response> {
		const { issueId } = (await request.json()) as { issueId: string };

		const rows = this.sql.exec('SELECT * FROM issues WHERE id = ?', issueId).toArray();

		if (rows.length === 0) {
			return this.jsonResponse({ error: 'issue_not_found' }, 404);
		}

		const row = rows[0];

		// Get recent stats (7 days of hourly buckets)
		const statsRows = this.sql
			.exec(
				'SELECT bucket, count FROM issue_stats WHERE issue_id = ? ORDER BY bucket DESC LIMIT 168',
				issueId,
			)
			.toArray();

		const stats = statsRows.map((s) => ({
			bucket: s.bucket as string,
			count: s.count as number,
		}));

		return this.jsonResponse({
			issue: this.rowToIssue(row),
			stats,
		});
	}

	private async handleUpdateIssue(request: Request): Promise<Response> {
		const { issueId, status, userId, userName } = (await request.json()) as {
			issueId: string;
			status?: string;
			userId?: string;
			userName?: string;
		};

		if (!issueId) {
			return this.jsonResponse({ error: 'missing_issue_id' }, 400);
		}

		const updates: string[] = [];
		const params: (string | null)[] = [];

		// Get previous status before updating
		let previousStatus: string | undefined;
		if (status) {
			const current = this.sql.exec('SELECT status FROM issues WHERE id = ?', issueId).toArray();
			previousStatus = current.length > 0 ? (current[0].status as string) : 'unknown';
			updates.push('status = ?');
			params.push(status);
		}

		if (updates.length === 0) {
			return this.jsonResponse({ error: 'no_updates' }, 400);
		}

		params.push(issueId);
		this.sql.exec(`UPDATE issues SET ${updates.join(', ')} WHERE id = ?`, ...params);

		// Record status change activity
		if (status && previousStatus) {
			const activityId = crypto.randomUUID();
			const now = new Date().toISOString();
			this.sql.exec(
				`INSERT INTO issue_activity (id, issue_id, user_id, user_name, type, data, created_at)
				 VALUES (?, ?, ?, ?, 'status_change', ?, ?)`,
				activityId,
				issueId,
				userId || 'system',
				userName || 'System',
				JSON.stringify({ from: previousStatus, to: status }),
				now,
			);
		}

		const row = this.sql.exec('SELECT * FROM issues WHERE id = ?', issueId).one();
		return this.jsonResponse({ issue: row ? this.rowToIssue(row) : null });
	}

	private async handleDeleteIssue(request: Request): Promise<Response> {
		const { issueId } = (await request.json()) as { issueId: string };

		if (!issueId) {
			return this.jsonResponse({ error: 'missing_issue_id' }, 400);
		}

		// Delete cascade handles events, stats, users
		this.sql.exec('DELETE FROM issues WHERE id = ?', issueId);

		return this.jsonResponse({ success: true });
	}

	private async handleBulkUpdateIssues(request: Request): Promise<Response> {
		const { issueIds, status, action } = (await request.json()) as {
			issueIds: string[];
			status?: string;
			action?: 'delete';
		};

		if (!issueIds || !Array.isArray(issueIds) || issueIds.length === 0) {
			return this.jsonResponse({ error: 'missing_issue_ids' }, 400);
		}

		if (issueIds.length > 100) {
			return this.jsonResponse(
				{ error: 'too_many_issues', message: 'Maximum 100 issues per bulk operation' },
				400,
			);
		}

		const validStatuses = new Set(['unresolved', 'resolved', 'ignored']);
		if (status && !validStatuses.has(status)) {
			return this.jsonResponse({ error: 'invalid_status' }, 400);
		}

		const placeholders = issueIds.map(() => '?').join(', ');

		if (action === 'delete') {
			const cursor = this.sql.exec(`DELETE FROM issues WHERE id IN (${placeholders})`, ...issueIds);
			return this.jsonResponse({ success: true, affected: cursor.rowsWritten });
		}

		if (status) {
			this.sql.exec(
				`UPDATE issues SET status = ? WHERE id IN (${placeholders})`,
				status,
				...issueIds,
			);
			const changedRow = this.sql.exec('SELECT changes() as n').one();
			const affected = changedRow ? (changedRow.n as number) : 0;
			return this.jsonResponse({ success: true, affected });
		}

		return this.jsonResponse({ error: 'no_action' }, 400);
	}

	private async handleGetIssueEvents(request: Request): Promise<Response> {
		const { issueId, cursor, limit } = (await request.json()) as {
			issueId: string;
			cursor?: string;
			limit?: number;
		};

		const pageLimit = Math.min(limit || 25, 100);

		let sql = 'SELECT * FROM events WHERE issue_id = ?';
		const params: (string | number)[] = [issueId];

		if (cursor) {
			sql += ' AND timestamp < ?';
			params.push(cursor);
		}

		sql += ' ORDER BY timestamp DESC LIMIT ?';
		params.push(pageLimit + 1);

		const rows = this.sql.exec(sql, ...params).toArray();
		const hasMore = rows.length > pageLimit;
		const events = rows.slice(0, pageLimit).map((row) => JSON.parse(row.data as string));

		const nextCursor =
			hasMore && events.length > 0
				? (events[events.length - 1] as SentryEvent).timestamp
				: undefined;

		return this.jsonResponse({
			events,
			nextCursor,
			hasMore,
		});
	}

	private async handleGetEvent(request: Request): Promise<Response> {
		const { eventId } = (await request.json()) as { eventId: string };

		const rows = this.sql.exec('SELECT * FROM events WHERE id = ?', eventId).toArray();

		if (rows.length === 0) {
			return this.jsonResponse({ error: 'event_not_found' }, 404);
		}

		const row = rows[0];
		return this.jsonResponse({
			event: JSON.parse(row.data as string),
			issueId: row.issue_id,
		});
	}

	private async handleGetLatestEvents(request: Request): Promise<Response> {
		const { limit } = (await request.json()) as { limit?: number };

		const pageLimit = Math.min(limit || 25, 100);

		const rows = this.sql
			.exec('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?', pageLimit)
			.toArray();

		const events = rows.map((row) => ({
			...JSON.parse(row.data as string),
			issueId: row.issue_id,
		}));

		return this.jsonResponse({ events });
	}

	private async handleGetStats(request: Request): Promise<Response> {
		const { interval, start, end } = (await request.json()) as {
			interval?: '1h' | '1d' | '1w';
			start?: string;
			end?: string;
		};

		const endDate = end ? new Date(end) : new Date();
		const startDate = start
			? new Date(start)
			: new Date(
					endDate.getTime() -
						(interval === '1w' ? 7 : interval === '1d' ? 1 : 1) * 24 * 60 * 60 * 1000,
				);

		// Aggregate stats by bucket
		const rows = this.sql
			.exec(
				`SELECT bucket, SUM(count) as count
       FROM issue_stats
       WHERE bucket >= ? AND bucket <= ?
       GROUP BY bucket
       ORDER BY bucket ASC`,
				startDate.toISOString(),
				endDate.toISOString(),
			)
			.toArray();

		const series = rows.map((row) => ({
			bucket: row.bucket as string,
			count: row.count as number,
		}));

		const total = series.reduce((sum, s) => sum + s.count, 0);

		return this.jsonResponse({ total, series });
	}

	private async handleGetTags(request: Request): Promise<Response> {
		const { limit } = (await request.json()) as { limit?: number };
		const facetLimit = Math.min(limit || 10, 50);

		const keys = this.sql
			.exec(
				`SELECT key, COUNT(DISTINCT issue_id) as issue_count, COUNT(*) as event_count
				 FROM event_tags
				 GROUP BY key
				 ORDER BY issue_count DESC
				 LIMIT ?`,
				facetLimit,
			)
			.toArray();

		const facets = keys.map((row) => {
			const topValues = this.sql
				.exec(
					`SELECT value, COUNT(DISTINCT issue_id) as issue_count, COUNT(*) as event_count
					 FROM event_tags
					 WHERE key = ?
					 GROUP BY value
					 ORDER BY issue_count DESC
					 LIMIT 10`,
					row.key as string,
				)
				.toArray();

			return {
				key: row.key as string,
				issueCount: row.issue_count as number,
				eventCount: row.event_count as number,
				topValues: topValues.map((v) => ({
					value: v.value as string,
					issueCount: v.issue_count as number,
					eventCount: v.event_count as number,
				})),
			};
		});

		return this.jsonResponse({ facets });
	}

	private async handleGetTagValues(request: Request): Promise<Response> {
		const { key, query, limit } = (await request.json()) as {
			key: string;
			query?: string;
			limit?: number;
		};

		if (!key) {
			return this.jsonResponse({ error: 'missing_key' }, 400);
		}

		const pageLimit = Math.min(limit || 25, 100);

		let sql = `SELECT value, COUNT(DISTINCT issue_id) as issue_count, COUNT(*) as event_count
			FROM event_tags
			WHERE key = ?`;
		const params: (string | number)[] = [key];

		if (query) {
			sql += " AND value LIKE ? ESCAPE '\\'";
			const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
			params.push(`%${escaped}%`);
		}

		sql += ' GROUP BY value ORDER BY issue_count DESC LIMIT ?';
		params.push(pageLimit);

		const rows = this.sql.exec(sql, ...params).toArray();
		const values = rows.map((row) => ({
			value: row.value as string,
			issueCount: row.issue_count as number,
			eventCount: row.event_count as number,
		}));

		return this.jsonResponse({ key, values });
	}

	private async handleGetReleases(request: Request): Promise<Response> {
		const { cursor, limit } = (await request.json()) as {
			cursor?: string;
			limit?: number;
		};

		const pageLimit = Math.min(limit || 25, 100);
		const params: (string | number)[] = [];

		let sql = 'SELECT * FROM releases WHERE 1=1';

		if (cursor) {
			sql += ' AND last_seen < ?';
			params.push(cursor);
		}

		sql += ' ORDER BY last_seen DESC LIMIT ?';
		params.push(pageLimit + 1);

		const rows = this.sql.exec(sql, ...params).toArray();
		const hasMore = rows.length > pageLimit;
		const releases = rows.slice(0, pageLimit).map((row) => ({
			version: row.version as string,
			firstSeen: row.first_seen as string,
			lastSeen: row.last_seen as string,
			eventCount: row.event_count as number,
			issueCount: row.issue_count as number,
			newIssueCount: row.new_issue_count as number,
		}));

		const nextCursor =
			hasMore && releases.length > 0 ? releases[releases.length - 1].lastSeen : undefined;

		return this.jsonResponse({ releases, nextCursor, hasMore });
	}

	private async handleGetRelease(request: Request): Promise<Response> {
		const { version } = (await request.json()) as { version: string };

		const releaseRows = this.sql
			.exec('SELECT * FROM releases WHERE version = ?', version)
			.toArray();

		if (releaseRows.length === 0) {
			return this.jsonResponse({ error: 'release_not_found' }, 404);
		}

		const row = releaseRows[0];
		const release = {
			version: row.version as string,
			firstSeen: row.first_seen as string,
			lastSeen: row.last_seen as string,
			eventCount: row.event_count as number,
			issueCount: row.issue_count as number,
			newIssueCount: row.new_issue_count as number,
		};

		// Get issues for this release
		const issueRows = this.sql
			.exec(
				`SELECT i.*, ri.first_seen_in_release, ri.event_count as release_event_count
				 FROM release_issues ri
				 JOIN issues i ON i.id = ri.issue_id
				 WHERE ri.release_version = ?
				 ORDER BY ri.event_count DESC
				 LIMIT 100`,
				version,
			)
			.toArray();

		const issues = issueRows.map((r) => ({
			...this.rowToIssue(r),
			firstSeenInRelease: r.first_seen_in_release as string,
			releaseEventCount: r.release_event_count as number,
		}));

		return this.jsonResponse({ release, issues });
	}

	private handleGetEnvironments(): Response {
		const rows = this.sql
			.exec(
				`SELECT environment, COUNT(DISTINCT issue_id) as issue_count, MAX(last_seen) as last_seen
			 FROM issue_environments
			 GROUP BY environment
			 ORDER BY last_seen DESC`,
			)
			.toArray();

		const environments = rows.map((row) => ({
			name: row.environment as string,
			issueCount: row.issue_count as number,
			lastSeen: row.last_seen as string,
		}));

		return this.jsonResponse({ environments });
	}

	private async handleGetSummary(): Promise<Response> {
		const now = new Date();
		const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
		const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

		// Issue counts by status
		const statusCounts = this.sql
			.exec('SELECT status, COUNT(*) as count FROM issues GROUP BY status')
			.toArray();

		const issuesByStatus: Record<string, number> = {};
		for (const row of statusCounts) {
			issuesByStatus[row.status as string] = row.count as number;
		}

		// Event counts for 24h and 7d
		const events24h = this.sql
			.exec('SELECT COUNT(*) as count FROM events WHERE received_at >= ?', oneDayAgo)
			.one();
		const events7d = this.sql
			.exec('SELECT COUNT(*) as count FROM events WHERE received_at >= ?', sevenDaysAgo)
			.one();

		// Error trend: hourly buckets for last 7 days
		const trendRows = this.sql
			.exec(
				`SELECT bucket, SUM(count) as count FROM issue_stats
				 WHERE bucket >= ? GROUP BY bucket ORDER BY bucket ASC`,
				sevenDaysAgo,
			)
			.toArray();

		const trend = trendRows.map((row) => ({
			bucket: row.bucket as string,
			count: row.count as number,
		}));

		// Top 5 most active unresolved issues
		const topIssueRows = this.sql
			.exec(
				`SELECT * FROM issues WHERE status = 'unresolved'
				 ORDER BY issues.count DESC LIMIT 5`,
			)
			.toArray();

		const topIssues = topIssueRows.map((row) => this.rowToIssue(row));

		// Total unique users affected
		const userCountRow = this.sql
			.exec('SELECT COUNT(DISTINCT user_hash) as count FROM issue_users')
			.one();

		return this.jsonResponse({
			issuesByStatus,
			events24h: (events24h?.count as number) || 0,
			events7d: (events7d?.count as number) || 0,
			trend,
			topIssues,
			totalUsers: (userCountRow?.count as number) || 0,
		});
	}

	private async handleGetComments(request: Request): Promise<Response> {
		const { issueId } = (await request.json()) as { issueId: string };

		const rows = this.sql
			.exec('SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC', issueId)
			.toArray();

		const comments = rows.map((row) => ({
			id: row.id as string,
			issueId: row.issue_id as string,
			userId: row.user_id as string,
			userName: row.user_name as string,
			body: row.body as string,
			createdAt: row.created_at as string,
		}));

		return this.jsonResponse({ comments });
	}

	private async handleAddComment(request: Request): Promise<Response> {
		const { issueId, userId, userName, body } = (await request.json()) as {
			issueId: string;
			userId: string;
			userName: string;
			body: string;
		};

		if (!body || body.trim().length === 0) {
			return this.jsonResponse({ error: 'comment_body_required' }, 400);
		}

		if (body.length > 2000) {
			return this.jsonResponse({ error: 'comment_body_too_long' }, 400);
		}

		const commentId = crypto.randomUUID();
		const now = new Date().toISOString();

		this.sql.exec(
			`INSERT INTO issue_comments (id, issue_id, user_id, user_name, body, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			commentId,
			issueId,
			userId,
			userName,
			body.trim(),
			now,
		);

		// Also record activity
		const activityId = crypto.randomUUID();
		this.sql.exec(
			`INSERT INTO issue_activity (id, issue_id, user_id, user_name, type, data, created_at)
			 VALUES (?, ?, ?, ?, 'comment', ?, ?)`,
			activityId,
			issueId,
			userId,
			userName,
			JSON.stringify({ commentId, body: body.trim() }),
			now,
		);

		const comment = {
			id: commentId,
			issueId,
			userId,
			userName,
			body: body.trim(),
			createdAt: now,
		};

		return this.jsonResponse({ comment }, 201);
	}

	private async handleDeleteComment(request: Request): Promise<Response> {
		const { commentId, userId, issueId } = (await request.json()) as {
			commentId: string;
			userId: string;
			issueId: string;
		};

		const rows = this.sql.exec('SELECT * FROM issue_comments WHERE id = ?', commentId).toArray();

		if (rows.length === 0) {
			return this.jsonResponse({ error: 'comment_not_found' }, 404);
		}

		const comment = rows[0];
		if (comment.user_id !== userId) {
			return this.jsonResponse({ error: 'forbidden' }, 403);
		}

		this.sql.exec('DELETE FROM issue_comments WHERE id = ?', commentId);

		// Delete corresponding activity entry, scoped by issue_id for efficiency
		const commentIssueId = issueId || (comment.issue_id as string);
		this.sql.exec(
			`DELETE FROM issue_activity WHERE type = 'comment' AND issue_id = ? AND json_extract(data, '$.commentId') = ?`,
			commentIssueId,
			commentId,
		);

		return this.jsonResponse({ success: true });
	}

	private async handleGetActivity(request: Request): Promise<Response> {
		const { issueId, cursor, limit } = (await request.json()) as {
			issueId: string;
			cursor?: string;
			limit?: number;
		};

		const pageLimit = Math.min(limit || 50, 100);

		let sql = 'SELECT * FROM issue_activity WHERE issue_id = ?';
		const params: (string | number)[] = [issueId];

		if (cursor) {
			// Composite cursor: "created_at|id" to avoid skipping entries with same timestamp
			const [cursorTime, cursorId] = cursor.split('|');
			sql += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
			params.push(cursorTime, cursorTime, cursorId);
		}

		sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
		params.push(pageLimit + 1);

		const rows = this.sql.exec(sql, ...params).toArray();
		const hasMore = rows.length > pageLimit;

		const activity = rows.slice(0, pageLimit).map((row) => ({
			id: row.id as string,
			issueId: row.issue_id as string,
			userId: row.user_id as string,
			userName: row.user_name as string,
			type: row.type as string,
			data: JSON.parse((row.data as string) || '{}'),
			createdAt: row.created_at as string,
		}));

		const lastEntry = activity.length > 0 ? activity[activity.length - 1] : undefined;
		const nextCursor = hasMore && lastEntry ? `${lastEntry.createdAt}|${lastEntry.id}` : undefined;

		return this.jsonResponse({ activity, nextCursor, hasMore });
	}

	private async scheduleNextAlarm(): Promise<void> {
		const candidates: number[] = [];

		// Consider retention schedule if enabled
		const retentionDays = this.getRetentionDays();
		if (retentionDays > 0) {
			candidates.push(Date.now() + MS_PER_DAY);
		}

		// Consider earliest pending snooze expiry
		const rows = this.sql
			.exec(
				'SELECT MIN(snoozed_until) as next FROM issues WHERE snoozed_until IS NOT NULL AND snoozed_until > ?',
				new Date().toISOString(),
			)
			.toArray();

		const next = rows[0]?.next as string | null;
		if (next) {
			candidates.push(new Date(next).getTime());
		}

		if (candidates.length > 0) {
			await this.ctx.storage.setAlarm(Math.min(...candidates));
		}
	}

	private async handleSnoozeIssue(request: Request): Promise<Response> {
		const { issueId, duration } = (await request.json()) as {
			issueId: string;
			duration: string;
		};

		if (!issueId || !duration) {
			return this.jsonResponse({ error: 'missing_parameters' }, 400);
		}

		const rows = this.sql.exec('SELECT id FROM issues WHERE id = ?', issueId).toArray();
		if (rows.length === 0) {
			return this.jsonResponse({ error: 'issue_not_found' }, 404);
		}

		this.sql.exec('UPDATE issues SET snoozed_until = ? WHERE id = ?', duration, issueId);

		await this.scheduleNextAlarm();

		const row = this.sql.exec('SELECT * FROM issues WHERE id = ?', issueId).one();
		return this.jsonResponse({ issue: row ? this.rowToIssue(row) : null });
	}

	private async handleUnsnoozeIssue(request: Request): Promise<Response> {
		const { issueId } = (await request.json()) as { issueId: string };

		if (!issueId) {
			return this.jsonResponse({ error: 'missing_issue_id' }, 400);
		}

		const rows = this.sql.exec('SELECT id FROM issues WHERE id = ?', issueId).toArray();
		if (rows.length === 0) {
			return this.jsonResponse({ error: 'issue_not_found' }, 404);
		}

		this.sql.exec('UPDATE issues SET snoozed_until = NULL WHERE id = ?', issueId);

		const row = this.sql.exec('SELECT * FROM issues WHERE id = ?', issueId).one();
		return this.jsonResponse({ issue: row ? this.rowToIssue(row) : null });
	}

	private static readonly VALID_FILTER_TYPES = new Set([
		'message',
		'error_type',
		'ip_address',
		'release',
		'environment',
	]);

	private shouldFilterEvent(
		event: SentryEvent,
		filters: Array<Record<string, SqlStorageValue>>,
	): string | null {
		for (const filter of filters) {
			const filterType = filter.filter_type as string;
			const pattern = (filter.pattern as string).toLowerCase();
			let matched = false;

			switch (filterType) {
				case 'message': {
					const message = (
						event.exception?.values?.[0]?.value ||
						event.message ||
						''
					).toLowerCase();
					matched = message.includes(pattern);
					break;
				}
				case 'error_type': {
					const type = (event.exception?.values?.[0]?.type || '').toLowerCase();
					matched = type.includes(pattern);
					break;
				}
				case 'ip_address': {
					matched = event.user?.ip_address === filter.pattern;
					break;
				}
				case 'release': {
					matched = (event.release || '') === filter.pattern;
					break;
				}
				case 'environment': {
					matched = (event.environment || '').toLowerCase() === pattern;
					break;
				}
			}

			if (matched) {
				return filter.id as string;
			}
		}
		return null;
	}

	private handleGetFilters(): Response {
		const rows = this.sql.exec('SELECT * FROM inbound_filters ORDER BY created_at DESC').toArray();
		const filters = rows.map((row) => this.rowToFilter(row));
		return this.jsonResponse({ filters });
	}

	private async handleCreateFilter(request: Request): Promise<Response> {
		const { filterType, pattern, description } = (await request.json()) as {
			filterType: string;
			pattern: string;
			description?: string;
		};

		if (!filterType || !ProjectState.VALID_FILTER_TYPES.has(filterType)) {
			return this.jsonResponse(
				{ error: 'invalid_filter_type', message: 'Invalid filter type' },
				400,
			);
		}

		if (!pattern || pattern.length === 0 || pattern.length > 500) {
			return this.jsonResponse(
				{ error: 'invalid_pattern', message: 'Pattern must be 1-500 characters' },
				400,
			);
		}

		// Enforce a limit of 100 filters per project
		const countRow = this.sql.exec('SELECT COUNT(*) as cnt FROM inbound_filters').one();
		if (countRow && (countRow.cnt as number) >= 100) {
			return this.jsonResponse(
				{ error: 'limit_reached', message: 'Maximum of 100 filters per project' },
				400,
			);
		}

		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		this.sql.exec(
			`INSERT INTO inbound_filters (id, filter_type, pattern, enabled, description, dropped_count, created_at)
			 VALUES (?, ?, ?, 1, ?, 0, ?)`,
			id,
			filterType,
			pattern,
			description || null,
			now,
		);

		const row = this.sql.exec('SELECT * FROM inbound_filters WHERE id = ?', id).one();
		return this.jsonResponse({ filter: row ? this.rowToFilter(row) : null }, 201);
	}

	private async handleUpdateFilter(request: Request): Promise<Response> {
		const { filterId, enabled, pattern, description } = (await request.json()) as {
			filterId: string;
			enabled?: boolean;
			pattern?: string;
			description?: string | null;
		};

		if (!filterId) {
			return this.jsonResponse({ error: 'missing_filter_id' }, 400);
		}

		// Check filter exists
		const existing = this.sql
			.exec('SELECT id FROM inbound_filters WHERE id = ?', filterId)
			.toArray();
		if (existing.length === 0) {
			return this.jsonResponse({ error: 'filter_not_found' }, 404);
		}

		const updates: string[] = [];
		const params: (string | number | null)[] = [];

		if (enabled !== undefined) {
			updates.push('enabled = ?');
			params.push(enabled ? 1 : 0);
		}

		if (pattern !== undefined) {
			if (pattern.length === 0 || pattern.length > 500) {
				return this.jsonResponse(
					{ error: 'invalid_pattern', message: 'Pattern must be 1-500 characters' },
					400,
				);
			}
			updates.push('pattern = ?');
			params.push(pattern);
		}

		if (description !== undefined) {
			updates.push('description = ?');
			params.push(description);
		}

		if (updates.length === 0) {
			return this.jsonResponse({ error: 'no_updates' }, 400);
		}

		params.push(filterId);
		this.sql.exec(`UPDATE inbound_filters SET ${updates.join(', ')} WHERE id = ?`, ...params);

		const row = this.sql.exec('SELECT * FROM inbound_filters WHERE id = ?', filterId).one();
		return this.jsonResponse({ filter: row ? this.rowToFilter(row) : null });
	}

	private async handleDeleteFilter(request: Request): Promise<Response> {
		const { filterId } = (await request.json()) as { filterId: string };

		if (!filterId) {
			return this.jsonResponse({ error: 'missing_filter_id' }, 400);
		}

		// Check filter exists
		const existing = this.sql
			.exec('SELECT id FROM inbound_filters WHERE id = ?', filterId)
			.toArray();
		if (existing.length === 0) {
			return this.jsonResponse({ error: 'filter_not_found' }, 404);
		}

		this.sql.exec('DELETE FROM inbound_filters WHERE id = ?', filterId);
		return this.jsonResponse({ success: true });
	}

	private rowToFilter(row: Record<string, SqlStorageValue>): InboundFilter {
		return {
			id: row.id as string,
			filterType: row.filter_type as FilterType,
			pattern: row.pattern as string,
			enabled: (row.enabled as number) === 1,
			description: row.description as string | null,
			droppedCount: row.dropped_count as number,
			createdAt: row.created_at as string,
		};
	}

	private getHourBucket(timestamp: string): string {
		const date = new Date(timestamp);
		date.setMinutes(0, 0, 0);
		return date.toISOString();
	}

	private async hashUserIdentifier(user: SentryEvent['user']): Promise<string | null> {
		if (!user) return null;

		const identifier = user.id || user.email || user.ip_address || user.username;
		if (!identifier) return null;

		const encoder = new TextEncoder();
		const data = encoder.encode(identifier);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
			.slice(0, 32);
	}

	private rowToIssue(row: Record<string, SqlStorageValue>): Issue {
		return {
			id: row.id as string,
			fingerprint: row.fingerprint as string,
			title: row.title as string,
			culprit: row.culprit as string | null,
			level: row.level as Issue['level'],
			platform: row.platform as string,
			firstSeen: row.first_seen as string,
			lastSeen: row.last_seen as string,
			count: row.count as number,
			userCount: row.user_count as number,
			status: row.status as Issue['status'],
			snoozedUntil: (row.snoozed_until as string) || null,
			metadata: JSON.parse((row.metadata as string) || '{}'),
		};
	}

	private warmRateLimitCounter(): void {
		const bucket = this.getHourBucket(new Date().toISOString());
		this.rateLimitBucket = bucket;
		// Check persisted counter first
		const row = this.sql
			.exec('SELECT count FROM rate_limit_counters WHERE bucket = ?', bucket)
			.toArray();
		if (row.length > 0) {
			this.rateLimitCount = row[0].count as number;
		} else {
			// Fallback: sum from issue_stats for this hour
			const statsRow = this.sql
				.exec('SELECT COALESCE(SUM(count), 0) as total FROM issue_stats WHERE bucket = ?', bucket)
				.one();
			this.rateLimitCount = (statsRow?.total as number) || 0;
		}
	}

	private checkRateLimit(): { allowed: boolean; retryAfter?: number } {
		const maxPerHour = this.getConfigValue('max_events_per_hour');
		if (!maxPerHour || maxPerHour === '0') {
			return { allowed: true };
		}
		const limit = Number.parseInt(maxPerHour, 10);
		if (limit <= 0) return { allowed: true };

		const currentBucket = this.getHourBucket(new Date().toISOString());
		if (currentBucket !== this.rateLimitBucket) {
			// New hour — reset counter and clean old buckets
			this.rateLimitBucket = currentBucket;
			this.rateLimitCount = 0;
			this.sql.exec('DELETE FROM rate_limit_counters WHERE bucket < ?', currentBucket);
		}

		if (this.rateLimitCount >= limit) {
			// Calculate seconds until next hour
			const now = new Date();
			const nextHour = new Date(now);
			nextHour.setMinutes(0, 0, 0);
			nextHour.setHours(nextHour.getHours() + 1);
			const retryAfter = Math.ceil((nextHour.getTime() - now.getTime()) / 1000);
			return { allowed: false, retryAfter };
		}
		return { allowed: true };
	}

	private getConfigValue(key: string): string | null {
		const rows = this.sql.exec('SELECT value FROM project_config WHERE key = ?', key).toArray();
		return rows.length > 0 ? (rows[0].value as string) : null;
	}

	private setConfigValue(key: string, value: string): void {
		this.sql.exec(
			'INSERT INTO project_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
			key,
			value,
			value,
		);
	}

	private handleGetConfig(): Response {
		const maxEventsPerHour = this.getConfigValue('max_events_per_hour') || '0';
		return this.jsonResponse({
			config: { maxEventsPerHour: Number.parseInt(maxEventsPerHour, 10) },
		});
	}

	private async handleUpdateConfig(request: Request): Promise<Response> {
		const { maxEventsPerHour } = (await request.json()) as { maxEventsPerHour?: number };
		if (maxEventsPerHour !== undefined) {
			if (typeof maxEventsPerHour !== 'number' || maxEventsPerHour < 0) {
				return this.jsonResponse(
					{ error: 'invalid_value', message: 'maxEventsPerHour must be a non-negative number' },
					400,
				);
			}
			this.setConfigValue('max_events_per_hour', String(Math.floor(maxEventsPerHour)));
		}
		return this.handleGetConfig();
	}

	private handleRateLimitStatus(): Response {
		const maxPerHour = Number.parseInt(this.getConfigValue('max_events_per_hour') || '0', 10);
		const currentBucket = this.getHourBucket(new Date().toISOString());
		let currentCount = this.rateLimitCount;
		if (currentBucket !== this.rateLimitBucket) {
			currentCount = 0;
		}
		return this.jsonResponse({
			maxEventsPerHour: maxPerHour,
			currentHourCount: currentCount,
			currentBucket,
			isLimited: maxPerHour > 0 && currentCount >= maxPerHour,
		});
	}

	async alarm(): Promise<void> {
		await this.ensureSchema();
		const now = new Date().toISOString();

		// Un-snooze all issues whose snooze has expired
		this.sql.exec(
			'UPDATE issues SET snoozed_until = NULL WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?',
			now,
		);

		// Handle data retention if enabled
		const retentionDays = this.getRetentionDays();
		if (retentionDays > 0) {
			const cutoffDate = new Date(Date.now() - retentionDays * MS_PER_DAY).toISOString();

			// Delete old events
			this.sql.exec('DELETE FROM events WHERE received_at < ?', cutoffDate);

			// Delete old issue_stats buckets
			this.sql.exec('DELETE FROM issue_stats WHERE bucket < ?', cutoffDate);

			// Clean up issue_users whose last activity is before the cutoff
			this.sql.exec('DELETE FROM issue_users WHERE last_seen < ?', cutoffDate);

			// Recalculate issue counts from remaining events
			this.sql.exec(`
				UPDATE issues SET count = (
					SELECT COUNT(*) FROM events WHERE events.issue_id = issues.id
				)
			`);

			// Recalculate user counts from remaining issue_users
			this.sql.exec(`
				UPDATE issues SET user_count = (
					SELECT COUNT(*) FROM issue_users WHERE issue_users.issue_id = issues.id
				)
			`);

			// Delete issues with no remaining events
			this.sql.exec('DELETE FROM issues WHERE count = 0');

			// Clean up orphaned issue_users for deleted issues
			this.sql.exec('DELETE FROM issue_users WHERE issue_id NOT IN (SELECT id FROM issues)');
		}

		// Schedule next alarm (earliest of next retention run or next snooze expiry)
		await this.scheduleNextAlarm();
	}

	private getRetentionDays(): number {
		const rows = this.sql.exec("SELECT value FROM settings WHERE key = 'retention_days'").toArray();
		return rows.length > 0 ? Number.parseInt(rows[0].value as string, 10) : 0;
	}

	private handleGetSettings(): Response {
		const retentionDays = this.getRetentionDays();
		return this.jsonResponse({ retentionDays });
	}

	private async handleUpdateSettings(request: Request): Promise<Response> {
		const { retentionDays } = (await request.json()) as ProjectSettings;

		if (
			typeof retentionDays !== 'number' ||
			!Number.isInteger(retentionDays) ||
			retentionDays < 0
		) {
			return this.jsonResponse(
				{
					error: 'invalid_retention_days',
					message: 'retentionDays must be 0 or a positive integer',
				},
				400,
			);
		}

		this.sql.exec(
			"INSERT OR REPLACE INTO settings (key, value) VALUES ('retention_days', ?)",
			String(retentionDays),
		);

		// Reschedule alarm considering both retention and pending snoozes
		await this.scheduleNextAlarm();

		return this.jsonResponse({ retentionDays });
	}

	private async handleUploadSourceMap(request: Request): Promise<Response> {
		const { release, fileUrl, content } = (await request.json()) as {
			release: string;
			fileUrl: string;
			content: string;
		};

		if (!release || release.length > 200) {
			return this.jsonResponse({ error: 'invalid_release' }, 400);
		}
		if (!fileUrl || fileUrl.length > 500) {
			return this.jsonResponse({ error: 'invalid_file_url' }, 400);
		}
		if (!content || content.length > 5_242_880) {
			return this.jsonResponse({ error: 'content_too_large', maxSize: '5MB' }, 400);
		}

		try {
			JSON.parse(content);
		} catch {
			return this.jsonResponse({ error: 'invalid_source_map_json' }, 400);
		}

		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const size = new TextEncoder().encode(content).length;

		this.sql.exec(
			`INSERT INTO source_maps (id, release, file_url, content, created_at, size)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (release, file_url) DO UPDATE SET
			   id = excluded.id,
			   content = excluded.content,
			   created_at = excluded.created_at,
			   size = excluded.size`,
			id,
			release,
			fileUrl,
			content,
			now,
			size,
		);

		return this.jsonResponse({
			sourceMap: { id, release, fileUrl, createdAt: now, size },
		});
	}

	private async handleListSourceMaps(request: Request): Promise<Response> {
		const { release } = (await request.json()) as { release?: string };

		let sql = 'SELECT id, release, file_url, created_at, size FROM source_maps';
		const params: string[] = [];

		if (release) {
			sql += ' WHERE release = ?';
			params.push(release);
		}

		sql += ' ORDER BY release DESC, created_at DESC LIMIT 100';

		const rows = this.sql.exec(sql, ...params).toArray();
		const sourceMaps = rows.map((row) => ({
			id: row.id as string,
			release: row.release as string,
			fileUrl: row.file_url as string,
			createdAt: row.created_at as string,
			size: row.size as number,
		}));

		return this.jsonResponse({ sourceMaps });
	}

	private async handleGetSourceMap(request: Request): Promise<Response> {
		const { id, release, fileUrl } = (await request.json()) as {
			id?: string;
			release?: string;
			fileUrl?: string;
		};

		let row: Record<string, SqlStorageValue> | undefined;
		if (id) {
			row = this.sql.exec('SELECT * FROM source_maps WHERE id = ?', id).toArray()[0];
		} else if (release && fileUrl) {
			row = this.sql
				.exec('SELECT * FROM source_maps WHERE release = ? AND file_url = ?', release, fileUrl)
				.toArray()[0];
		} else {
			return this.jsonResponse({ error: 'missing_id_or_release_and_file_url' }, 400);
		}

		if (!row) {
			return this.jsonResponse({ error: 'source_map_not_found' }, 404);
		}

		return this.jsonResponse({
			sourceMap: {
				id: row.id as string,
				release: row.release as string,
				fileUrl: row.file_url as string,
				createdAt: row.created_at as string,
				size: row.size as number,
			},
			content: row.content as string,
		});
	}

	private async handleDeleteSourceMap(request: Request): Promise<Response> {
		const { id } = (await request.json()) as { id: string };

		if (!id) {
			return this.jsonResponse({ error: 'missing_id' }, 400);
		}

		this.sql.exec('DELETE FROM source_maps WHERE id = ?', id);
		return this.jsonResponse({ success: true });
	}

	private jsonResponse(data: unknown, status = 200): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
