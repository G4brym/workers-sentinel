import { createMiddleware } from 'hono/factory';
import type { AuthContext, Env } from '../types';

type Variables = {
	auth?: AuthContext;
};

export const authMiddleware = createMiddleware<{
	Bindings: Env;
	Variables: Variables;
}>(async (c, next) => {
	const authHeader = c.req.header('Authorization');

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return c.json(
			{ error: 'unauthorized', message: 'Missing or invalid authorization header' },
			401,
		);
	}

	const token = authHeader.substring(7);

	// Get the singleton AuthState Durable Object
	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	// Choose validation endpoint based on token prefix
	let response: Response;
	if (token.startsWith('wst_')) {
		// API token auth
		response = await authState.fetch(
			new Request('http://internal/validate-api-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token }),
			}),
		);
	} else {
		// Session token auth (existing behavior)
		response = await authState.fetch(
			new Request('http://internal/validate-session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token }),
			}),
		);
	}

	if (!response.ok) {
		const message = token.startsWith('wst_')
			? 'Invalid or expired API token'
			: 'Invalid or expired session';
		return c.json({ error: 'unauthorized', message }, 401);
	}

	const auth = (await response.json()) as AuthContext;
	c.set('auth', auth);

	return next();
});
