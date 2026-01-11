import { Hono, Context } from 'hono';
import type { Env, AuthContext, Project } from '../types';

type Variables = {
	auth?: AuthContext;
};

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const eventRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

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

// List events for an issue
// GET /api/projects/:slug/issues/:issueId/events
eventRoutes.get('/:slug/issues/:issueId/events', async (c) => {
	const slug = c.req.param('slug');
	const issueId = c.req.param('issueId');

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
		new Request('http://internal/issue/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				issueId,
				cursor,
				limit: limit ? parseInt(limit, 10) : undefined,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data);
});

// Get a specific event
// GET /api/projects/:slug/events/:eventId
eventRoutes.get('/:slug/events/:eventId', async (c) => {
	const slug = c.req.param('slug');
	const eventId = c.req.param('eventId');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/event', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ eventId }),
		}),
	);

	if (!response.ok) {
		const error = await response.json();
		return c.json(error, response.status as 404);
	}

	const data = await response.json();
	return c.json(data);
});

// Get latest events for a project
// GET /api/projects/:slug/events/latest
eventRoutes.get('/:slug/events/latest', async (c) => {
	const slug = c.req.param('slug');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const limit = c.req.query('limit');

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/events/latest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				limit: limit ? parseInt(limit, 10) : undefined,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data);
});
