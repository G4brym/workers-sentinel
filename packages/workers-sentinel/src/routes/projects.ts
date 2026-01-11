import { Hono } from 'hono';
import type { Env, AuthContext } from '../types';

type Variables = {
	auth?: AuthContext;
};

export const projectRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// List all projects for the current user
projectRoutes.get('/', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/list-projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: auth.user.id }),
		}),
	);

	const data = await response.json();
	return c.json(data);
});

// Create a new project
projectRoutes.post('/', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const body = await c.req.json<{ name: string; platform?: string }>();

	if (!body.name) {
		return c.json({ error: 'missing_fields', message: 'Name is required' }, 400);
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/create-project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: body.name,
				platform: body.platform,
				userId: auth.user.id,
			}),
		}),
	);

	const data = (await response.json()) as { project: { id: string; publicKey: string } };

	// Generate DSN
	const host = new URL(c.req.url).host;
	const dsn = `https://${data.project.publicKey}@${host}/${data.project.id}`;

	return c.json({ ...data, dsn }, response.status as 200 | 400);
});

// Get a specific project by slug
projectRoutes.get('/:slug', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const slug = c.req.param('slug');

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/get-project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slug, userId: auth.user.id }),
		}),
	);

	if (!response.ok) {
		const error = await response.json();
		return c.json(error, response.status as 404);
	}

	const data = (await response.json()) as { project: { id: string; publicKey: string } };

	// Generate DSN
	const host = new URL(c.req.url).host;
	const dsn = `https://${data.project.publicKey}@${host}/${data.project.id}`;

	return c.json({ ...data, dsn });
});

// Update a project
projectRoutes.patch('/:slug', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	// For now, we don't support updates
	return c.json({ error: 'not_implemented' }, 501);
});

// Delete a project
projectRoutes.delete('/:slug', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const slug = c.req.param('slug');

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	// First get the project to get its ID
	const getResponse = await authState.fetch(
		new Request('http://internal/get-project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slug, userId: auth.user.id }),
		}),
	);

	if (!getResponse.ok) {
		const error = await getResponse.json();
		return c.json(error, getResponse.status as 404);
	}

	const projectData = (await getResponse.json()) as { project: { id: string } };

	// Delete the project
	const deleteResponse = await authState.fetch(
		new Request('http://internal/delete-project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				projectId: projectData.project.id,
				userId: auth.user.id,
			}),
		}),
	);

	const data = await deleteResponse.json();
	return c.json(data, deleteResponse.status as 200 | 403);
});
