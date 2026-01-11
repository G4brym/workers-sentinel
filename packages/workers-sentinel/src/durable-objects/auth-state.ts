import { DurableObject } from 'cloudflare:workers';
import type { Env, User, Session, Project } from '../types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL DEFAULT 'javascript',
  public_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_public_key ON projects(public_key);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export class AuthState extends DurableObject<Env> {
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
				case '/register':
					return this.handleRegister(request);
				case '/login':
					return this.handleLogin(request);
				case '/logout':
					return this.handleLogout(request);
				case '/validate-session':
					return this.handleValidateSession(request);
				case '/me':
					return this.handleGetMe(request);
				case '/create-project':
					return this.handleCreateProject(request);
				case '/list-projects':
					return this.handleListProjects(request);
				case '/get-project':
					return this.handleGetProject(request);
				case '/get-project-by-key':
					return this.handleGetProjectByKey(request);
				case '/delete-project':
					return this.handleDeleteProject(request);
				case '/check-access':
					return this.handleCheckAccess(request);
				default:
					return new Response(JSON.stringify({ error: 'not_found' }), {
						status: 404,
						headers: { 'Content-Type': 'application/json' },
					});
			}
		} catch (error) {
			console.error('AuthState error:', error);
			return new Response(
				JSON.stringify({
					error: 'internal_error',
					message: error instanceof Error ? error.message : 'Unknown error',
				}),
				{ status: 500, headers: { 'Content-Type': 'application/json' } },
			);
		}
	}

	private async handleRegister(request: Request): Promise<Response> {
		const { email, password, name } = (await request.json()) as {
			email: string;
			password: string;
			name: string;
		};

		if (!email || !password || !name) {
			return this.jsonResponse({ error: 'missing_fields', message: 'Email, password, and name are required' }, 400);
		}

		// Check if user already exists
		const existing = this.sql.exec('SELECT id FROM users WHERE email = ?', email).toArray();
		if (existing.length > 0) {
			return this.jsonResponse({ error: 'user_exists', message: 'User with this email already exists' }, 409);
		}

		// Check if this is the first user (becomes admin)
		const userCount = this.sql.exec('SELECT COUNT(*) as count FROM users').one();
		const isFirstUser = (userCount?.count as number) === 0;

		// Hash password
		const passwordHash = await this.hashPassword(password);

		// Create user
		const userId = crypto.randomUUID();
		const now = new Date().toISOString();
		const role = isFirstUser ? 'admin' : 'member';

		this.sql.exec(
			'INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			userId,
			email.toLowerCase(),
			passwordHash,
			name,
			role,
			now,
			now,
		);

		// Create session
		const session = await this.createSession(userId);

		const user: User = {
			id: userId,
			email: email.toLowerCase(),
			name,
			role: role as 'admin' | 'member',
			createdAt: now,
			updatedAt: now,
		};

		return this.jsonResponse({ user, token: session.id });
	}

	private async handleLogin(request: Request): Promise<Response> {
		const { email, password } = (await request.json()) as {
			email: string;
			password: string;
		};

		if (!email || !password) {
			return this.jsonResponse({ error: 'missing_fields', message: 'Email and password are required' }, 400);
		}

		// Find user
		const userRows = this.sql
			.exec(
				'SELECT id, email, password_hash, name, role, created_at, updated_at FROM users WHERE email = ?',
				email.toLowerCase(),
			)
			.toArray();

		if (userRows.length === 0) {
			return this.jsonResponse({ error: 'invalid_credentials', message: 'Invalid email or password' }, 401);
		}

		const userRow = userRows[0];

		// Verify password
		const valid = await this.verifyPassword(password, userRow.password_hash as string);
		if (!valid) {
			return this.jsonResponse({ error: 'invalid_credentials', message: 'Invalid email or password' }, 401);
		}

		// Create session
		const session = await this.createSession(userRow.id as string);

		const user: User = {
			id: userRow.id as string,
			email: userRow.email as string,
			name: userRow.name as string,
			role: userRow.role as 'admin' | 'member',
			createdAt: userRow.created_at as string,
			updatedAt: userRow.updated_at as string,
		};

		return this.jsonResponse({ user, token: session.id });
	}

	private async handleLogout(request: Request): Promise<Response> {
		const { token } = (await request.json()) as { token: string };

		if (token) {
			this.sql.exec('DELETE FROM sessions WHERE id = ?', token);
		}

		return this.jsonResponse({ success: true });
	}

	private async handleValidateSession(request: Request): Promise<Response> {
		const { token } = (await request.json()) as { token: string };

		if (!token) {
			return this.jsonResponse({ error: 'missing_token' }, 400);
		}

		// Clean expired sessions periodically
		await this.cleanExpiredSessions();

		// Get session with user
		const rows = this.sql
			.exec(
				`SELECT s.id as session_id, s.expires_at, s.created_at as session_created,
              u.id as user_id, u.email, u.name, u.role, u.created_at, u.updated_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ?`,
				token,
				new Date().toISOString(),
			)
			.toArray();

		if (rows.length === 0) {
			return this.jsonResponse({ error: 'invalid_session' }, 401);
		}

		const row = rows[0];

		const user: User = {
			id: row.user_id as string,
			email: row.email as string,
			name: row.name as string,
			role: row.role as 'admin' | 'member',
			createdAt: row.created_at as string,
			updatedAt: row.updated_at as string,
		};

		const session: Session = {
			id: row.session_id as string,
			userId: row.user_id as string,
			expiresAt: row.expires_at as string,
			createdAt: row.session_created as string,
		};

		return this.jsonResponse({ user, session });
	}

	private async handleGetMe(request: Request): Promise<Response> {
		const { token } = (await request.json()) as { token: string };
		return this.handleValidateSession(
			new Request(request.url, {
				method: 'POST',
				body: JSON.stringify({ token }),
			}),
		);
	}

	private async handleCreateProject(request: Request): Promise<Response> {
		const { name, platform, userId } = (await request.json()) as {
			name: string;
			platform?: string;
			userId: string;
		};

		if (!name || !userId) {
			return this.jsonResponse({ error: 'missing_fields', message: 'Name and userId are required' }, 400);
		}

		// Generate unique slug
		const baseSlug = this.slugify(name);
		let slug = baseSlug;
		let counter = 1;
		while (this.sql.exec('SELECT id FROM projects WHERE slug = ?', slug).toArray().length > 0) {
			slug = `${baseSlug}-${counter}`;
			counter++;
		}

		// Generate public key for DSN
		const publicKey = this.generateKey(32);

		const projectId = crypto.randomUUID();
		const now = new Date().toISOString();

		this.sql.exec(
			'INSERT INTO projects (id, name, slug, platform, public_key, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
			projectId,
			name,
			slug,
			platform || 'javascript',
			publicKey,
			now,
			userId,
		);

		// Add creator as owner
		this.sql.exec(
			'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
			projectId,
			userId,
			'owner',
			now,
		);

		const project: Project = {
			id: projectId,
			name,
			slug,
			platform: platform || 'javascript',
			publicKey,
			createdAt: now,
			createdBy: userId,
		};

		return this.jsonResponse({ project });
	}

	private async handleListProjects(request: Request): Promise<Response> {
		const { userId } = (await request.json()) as { userId: string };

		if (!userId) {
			return this.jsonResponse({ error: 'missing_user_id' }, 400);
		}

		const rows = this.sql
			.exec(
				`SELECT p.id, p.name, p.slug, p.platform, p.public_key, p.created_at, p.created_by, pm.role as member_role
       FROM projects p
       JOIN project_members pm ON p.id = pm.project_id
       WHERE pm.user_id = ?
       ORDER BY p.created_at DESC`,
				userId,
			)
			.toArray();

		const projects = rows.map((row) => ({
			id: row.id as string,
			name: row.name as string,
			slug: row.slug as string,
			platform: row.platform as string,
			publicKey: row.public_key as string,
			createdAt: row.created_at as string,
			createdBy: row.created_by as string,
			memberRole: row.member_role as string,
		}));

		return this.jsonResponse({ projects });
	}

	private async handleGetProject(request: Request): Promise<Response> {
		const { slug, userId } = (await request.json()) as { slug: string; userId: string };

		if (!slug) {
			return this.jsonResponse({ error: 'missing_slug' }, 400);
		}

		let rows;
		if (userId) {
			rows = this.sql
				.exec(
					`SELECT p.id, p.name, p.slug, p.platform, p.public_key, p.created_at, p.created_by
       FROM projects p
       JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
       WHERE p.slug = ?`,
					userId,
					slug,
				)
				.toArray();
		} else {
			rows = this.sql
				.exec(
					`SELECT p.id, p.name, p.slug, p.platform, p.public_key, p.created_at, p.created_by
       FROM projects p
       WHERE p.slug = ?`,
					slug,
				)
				.toArray();
		}

		if (rows.length === 0) {
			return this.jsonResponse({ error: 'project_not_found' }, 404);
		}

		const row = rows[0];

		const project: Project = {
			id: row.id as string,
			name: row.name as string,
			slug: row.slug as string,
			platform: row.platform as string,
			publicKey: row.public_key as string,
			createdAt: row.created_at as string,
			createdBy: row.created_by as string,
		};

		return this.jsonResponse({ project });
	}

	private async handleGetProjectByKey(request: Request): Promise<Response> {
		const { publicKey } = (await request.json()) as { publicKey: string };

		if (!publicKey) {
			return this.jsonResponse({ error: 'missing_key' }, 400);
		}

		const rows = this.sql
			.exec(
				'SELECT id, name, slug, platform, public_key, created_at, created_by FROM projects WHERE public_key = ?',
				publicKey,
			)
			.toArray();

		if (rows.length === 0) {
			return this.jsonResponse({ error: 'project_not_found' }, 404);
		}

		const row = rows[0];

		const project: Project = {
			id: row.id as string,
			name: row.name as string,
			slug: row.slug as string,
			platform: row.platform as string,
			publicKey: row.public_key as string,
			createdAt: row.created_at as string,
			createdBy: row.created_by as string,
		};

		return this.jsonResponse({ project });
	}

	private async handleDeleteProject(request: Request): Promise<Response> {
		const { projectId, userId } = (await request.json()) as { projectId: string; userId: string };

		if (!projectId || !userId) {
			return this.jsonResponse({ error: 'missing_fields' }, 400);
		}

		// Check if user is owner
		const memberRows = this.sql
			.exec('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId)
			.toArray();

		if (memberRows.length === 0 || memberRows[0].role !== 'owner') {
			return this.jsonResponse({ error: 'forbidden', message: 'Only project owner can delete' }, 403);
		}

		// Delete project (cascade deletes members)
		this.sql.exec('DELETE FROM projects WHERE id = ?', projectId);

		return this.jsonResponse({ success: true });
	}

	private async handleCheckAccess(request: Request): Promise<Response> {
		const { projectId, userId } = (await request.json()) as { projectId: string; userId: string };

		if (!projectId || !userId) {
			return this.jsonResponse({ error: 'missing_fields' }, 400);
		}

		const memberRows = this.sql
			.exec('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId)
			.toArray();

		const member = memberRows.length > 0 ? memberRows[0] : null;
		return this.jsonResponse({
			hasAccess: !!member,
			role: member?.role || null,
		});
	}

	private async createSession(userId: string): Promise<Session> {
		const sessionId = this.generateKey(64);
		const now = new Date();
		const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

		this.sql.exec(
			'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
			sessionId,
			userId,
			expiresAt.toISOString(),
			now.toISOString(),
		);

		return {
			id: sessionId,
			userId,
			expiresAt: expiresAt.toISOString(),
			createdAt: now.toISOString(),
		};
	}

	private async cleanExpiredSessions(): Promise<void> {
		this.sql.exec('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
	}

	private async hashPassword(password: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	private async verifyPassword(password: string, hash: string): Promise<boolean> {
		const passwordHash = await this.hashPassword(password);
		return passwordHash === hash;
	}

	private generateKey(length: number): string {
		const array = new Uint8Array(length);
		crypto.getRandomValues(array);
		return Array.from(array)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
			.slice(0, length);
	}

	private slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 50);
	}

	private jsonResponse(data: unknown, status = 200): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
