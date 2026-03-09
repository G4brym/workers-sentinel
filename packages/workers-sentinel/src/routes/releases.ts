import { type Context, Hono } from 'hono';
import type { AuthContext, Env, Project } from '../types';

type Variables = {
	auth?: AuthContext;
};

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const releaseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

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

// List releases for a project
// GET /api/projects/:slug/releases
releaseRoutes.get('/:slug/releases', async (c) => {
	const slug = c.req.param('slug');
	const projectResult = await getProjectWithAccess(c, slug);

	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const cursor = c.req.query('cursor');
	const limit = c.req.query('limit');

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/releases', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				cursor,
				limit: limit ? parseInt(limit, 10) : undefined,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data);
});

// Get a specific release with its issues
// GET /api/projects/:slug/releases/:version
releaseRoutes.get('/:slug/releases/:version', async (c) => {
	const slug = c.req.param('slug');
	const version = decodeURIComponent(c.req.param('version'));

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/release', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ version }),
		}),
	);

	if (!response.ok) {
		const error = await response.json();
		return c.json(error, response.status as 404);
	}

	const data = await response.json();
	return c.json(data);
});
