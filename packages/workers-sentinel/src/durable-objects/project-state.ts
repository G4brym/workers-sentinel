import { DurableObject } from 'cloudflare:workers';
import type { Env, SentryEvent, Issue } from '../types';
import { generateFingerprint, extractTitle, extractCulprit, extractMetadata } from '../lib/fingerprint';

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
`;

export class ProjectState extends DurableObject<Env> {
	private sql: SqlStorage;
	private initialized = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
	}

	private async ensureSchema(): Promise<void> {
		if (this.initialized) return;
		this.sql.exec(SCHEMA);
		this.initialized = true;
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
				case '/issue/events':
					return this.handleGetIssueEvents(request);
				case '/event':
					return this.handleGetEvent(request);
				case '/events/latest':
					return this.handleGetLatestEvents(request);
				case '/stats':
					return this.handleGetStats(request);
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
		const event = (await request.json()) as SentryEvent;

		const eventId = event.event_id || crypto.randomUUID();
		const now = new Date().toISOString();
		const timestamp = event.timestamp || now;

		// Generate fingerprint
		const fingerprint = generateFingerprint(event);

		// Check for existing issue
		const existingRows = this.sql.exec('SELECT id, count FROM issues WHERE fingerprint = ?', fingerprint).toArray();
		const existingIssue = existingRows.length > 0 ? existingRows[0] : null;

		let issueId: string;

		if (existingIssue) {
			// Update existing issue
			issueId = existingIssue.id as string;
			this.sql.exec('UPDATE issues SET last_seen = ?, count = count + 1 WHERE id = ?', now, issueId);
		} else {
			// Create new issue
			issueId = crypto.randomUUID();
			const title = extractTitle(event);
			const culprit = extractCulprit(event);
			const metadata = extractMetadata(event);

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

		// Update hourly stats
		const bucket = this.getHourBucket(timestamp);
		this.sql.exec(
			`INSERT INTO issue_stats (issue_id, bucket, count)
       VALUES (?, ?, 1)
       ON CONFLICT (issue_id, bucket) DO UPDATE SET count = count + 1`,
			issueId,
			bucket,
		);

		// Track unique users
		if (event.user) {
			const userHash = await this.hashUserIdentifier(event.user);
			if (userHash) {
				const existingUser = this.sql
					.exec('SELECT issue_id FROM issue_users WHERE issue_id = ? AND user_hash = ?', issueId, userHash)
					.one();

				if (existingUser) {
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

		return this.jsonResponse({ eventId, issueId });
	}

	private async handleGetIssues(request: Request): Promise<Response> {
		const { status, level, query, sort, cursor, limit } = (await request.json()) as {
			status?: string;
			level?: string;
			query?: string;
			sort?: string;
			cursor?: string;
			limit?: number;
		};

		const pageLimit = Math.min(limit || 25, 100);
		const sortField = sort || 'last_seen';
		const sortOrder = 'DESC';

		let sql = 'SELECT * FROM issues WHERE 1=1';
		const params: (string | number)[] = [];

		if (status) {
			sql += ' AND status = ?';
			params.push(status);
		}

		if (level) {
			sql += ' AND level = ?';
			params.push(level);
		}

		if (query) {
			sql += ' AND (title LIKE ? OR culprit LIKE ?)';
			params.push(`%${query}%`, `%${query}%`);
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

		const nextCursor = hasMore && issues.length > 0 ? (issues[issues.length - 1] as Issue)[sortField as keyof Issue] : undefined;

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
			.exec('SELECT bucket, count FROM issue_stats WHERE issue_id = ? ORDER BY bucket DESC LIMIT 168', issueId)
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
		const { issueId, status } = (await request.json()) as {
			issueId: string;
			status?: string;
		};

		if (!issueId) {
			return this.jsonResponse({ error: 'missing_issue_id' }, 400);
		}

		const updates: string[] = [];
		const params: (string | null)[] = [];

		if (status) {
			updates.push('status = ?');
			params.push(status);
		}

		if (updates.length === 0) {
			return this.jsonResponse({ error: 'no_updates' }, 400);
		}

		params.push(issueId);
		this.sql.exec(`UPDATE issues SET ${updates.join(', ')} WHERE id = ?`, ...params);

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
			hasMore && events.length > 0 ? (events[events.length - 1] as SentryEvent).timestamp : undefined;

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

		const rows = this.sql.exec('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?', pageLimit).toArray();

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
			: new Date(endDate.getTime() - (interval === '1w' ? 7 : interval === '1d' ? 1 : 1) * 24 * 60 * 60 * 1000);

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

	private getHourBucket(timestamp: string): string {
		const date = new Date(timestamp);
		date.setMinutes(0, 0, 0);
		return date.toISOString();
	}

	private async hashUserIdentifier(
		user: SentryEvent['user'],
	): Promise<string | null> {
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
			metadata: JSON.parse((row.metadata as string) || '{}'),
		};
	}

	private jsonResponse(data: unknown, status = 200): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
