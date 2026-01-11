import { createMiddleware } from 'hono/factory';
import type { Env, AuthContext } from '../types';

type Variables = {
	auth?: AuthContext;
};

export const authMiddleware = createMiddleware<{
	Bindings: Env;
	Variables: Variables;
}>(async (c, next) => {
	const authHeader = c.req.header('Authorization');

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return c.json({ error: 'unauthorized', message: 'Missing or invalid authorization header' }, 401);
	}

	const token = authHeader.substring(7);

	// Get the singleton AuthState Durable Object
	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	// Validate session
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

	const auth = (await response.json()) as AuthContext;
	c.set('auth', auth);

	return next();
});
