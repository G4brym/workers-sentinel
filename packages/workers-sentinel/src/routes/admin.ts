import { Hono } from 'hono';
import type { AuthContext, Env } from '../types';

type Variables = {
	auth?: AuthContext;
};

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// List all registered users (admin only)
// GET /api/admin/users
adminRoutes.get('/users', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	if (auth.user.role !== 'admin') {
		return c.json({ error: 'forbidden', message: 'Only admins can list users' }, 403);
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/list-users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ requestingUserRole: auth.user.role }),
		}),
	);

	const data = await response.json();
	return c.json(data);
});
