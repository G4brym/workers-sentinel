import { Hono } from 'hono';
import type { AuthContext, Env } from '../types';

type Variables = {
	auth?: AuthContext;
};

export const authRoutes = new Hono<{ Bindings: Env }>();
export const tokenRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Register a new user
authRoutes.post('/register', async (c) => {
	const body = await c.req.json<{ email: string; password: string; name: string }>();

	if (!body.email || !body.password || !body.name) {
		return c.json(
			{ error: 'missing_fields', message: 'Email, password, and name are required' },
			400,
		);
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200 | 400 | 409);
});

// Login
authRoutes.post('/login', async (c) => {
	const body = await c.req.json<{ email: string; password: string }>();

	if (!body.email || !body.password) {
		return c.json({ error: 'missing_fields', message: 'Email and password are required' }, 400);
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200 | 400 | 401);
});

// Logout
authRoutes.post('/logout', async (c) => {
	const authHeader = c.req.header('Authorization');
	const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

	if (!token) {
		return c.json({ success: true });
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	await authState.fetch(
		new Request('http://internal/logout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token }),
		}),
	);

	return c.json({ success: true });
});

// Get current user
authRoutes.get('/me', async (c) => {
	const authHeader = c.req.header('Authorization');

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return c.json({ error: 'unauthorized', message: 'Missing authorization header' }, 401);
	}

	const token = authHeader.substring(7);

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/validate-session', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token }),
		}),
	);

	if (!response.ok) {
		return c.json({ error: 'unauthorized', message: 'Invalid or expired session' }, 401);
	}

	const data = await response.json();
	return c.json(data);
});

// API Token routes (require session auth - managed via authMiddleware applied in index.ts)

// Session-only guard: API tokens cannot manage API tokens
tokenRoutes.use('*', async (c, next) => {
	const authHeader = c.req.header('Authorization');
	const token = authHeader?.substring(7) || '';
	if (token.startsWith('wst_')) {
		return c.json(
			{
				error: 'forbidden',
				message: 'API token management requires session authentication',
			},
			403,
		);
	}
	return next();
});

// List current user's API tokens
tokenRoutes.get('/', async (c) => {
	const auth = c.get('auth') as AuthContext;
	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/list-api-tokens', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: auth.user.id }),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200);
});

// Create a new API token
tokenRoutes.post('/', async (c) => {
	const auth = c.get('auth') as AuthContext;
	const body = await c.req.json<{ name: string; expiresAt?: string }>();

	if (!body.name) {
		return c.json({ error: 'missing_fields', message: 'Token name is required' }, 400);
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/create-api-token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				userId: auth.user.id,
				name: body.name,
				expiresAt: body.expiresAt,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200 | 400);
});

// Revoke an API token
tokenRoutes.delete('/:tokenId', async (c) => {
	const auth = c.get('auth') as AuthContext;
	const tokenId = c.req.param('tokenId');

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/revoke-api-token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tokenId, userId: auth.user.id }),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200 | 404);
});
