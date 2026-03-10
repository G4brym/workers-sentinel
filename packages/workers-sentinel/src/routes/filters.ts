import { type Context, Hono } from 'hono';
import type { AuthContext, Env, Project } from '../types';

type Variables = {
	auth?: AuthContext;
};

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const filterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper to get project and verify access
async function getProjectWithAccess(
	c: AppContext,
	slug: string,
): Promise<{ project: Project } | Response> {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

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
		return c.json({ error: 'project_not_found' }, 404);
	}

	return response.json();
}

// List filters for a project
// GET /api/projects/:slug/filters
filterRoutes.get('/:slug/filters', async (c) => {
	const slug = c.req.param('slug');
	const projectResult = await getProjectWithAccess(c, slug);

	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/filters', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		}),
	);

	const data = await response.json();
	return c.json(data);
});

// Create a filter
// POST /api/projects/:slug/filters
filterRoutes.post('/:slug/filters', async (c) => {
	const slug = c.req.param('slug');
	const projectResult = await getProjectWithAccess(c, slug);

	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;
	const body = await c.req.json<{
		filterType: string;
		pattern: string;
		description?: string;
	}>();

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/filters/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filterType: body.filterType,
				pattern: body.pattern,
				description: body.description,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 201 | 400);
});

// Update a filter
// PATCH /api/projects/:slug/filters/:filterId
filterRoutes.patch('/:slug/filters/:filterId', async (c) => {
	const slug = c.req.param('slug');
	const filterId = c.req.param('filterId');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;
	const body = await c.req.json<{
		enabled?: boolean;
		pattern?: string;
		description?: string | null;
	}>();

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/filters/update', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filterId,
				enabled: body.enabled,
				pattern: body.pattern,
				description: body.description,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200 | 400 | 404);
});

// Delete a filter
// DELETE /api/projects/:slug/filters/:filterId
filterRoutes.delete('/:slug/filters/:filterId', async (c) => {
	const slug = c.req.param('slug');
	const filterId = c.req.param('filterId');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/filters/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ filterId }),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200 | 404);
});
