import { Hono, Context } from 'hono';
import type { Env, AuthContext, Project } from '../types';

type Variables = {
	auth?: AuthContext;
};

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const issueRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

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

// List issues for a project
// GET /api/projects/:slug/issues
issueRoutes.get('/:slug/issues', async (c) => {
	const slug = c.req.param('slug');
	const projectResult = await getProjectWithAccess(c, slug);

	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	// Get query parameters
	const status = c.req.query('status');
	const level = c.req.query('level');
	const environment = c.req.query('environment');
	const query = c.req.query('query');
	const sort = c.req.query('sort');
	const cursor = c.req.query('cursor');
	const limit = c.req.query('limit');

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/issues', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				status,
				level,
				environment,
				query,
				sort,
				cursor,
				limit: limit ? parseInt(limit, 10) : undefined,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data);
});

// Get a specific issue
// GET /api/projects/:slug/issues/:issueId
issueRoutes.get('/:slug/issues/:issueId', async (c) => {
	const slug = c.req.param('slug');
	const issueId = c.req.param('issueId');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/issue', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ issueId }),
		}),
	);

	if (!response.ok) {
		const error = await response.json();
		return c.json(error, response.status as 404);
	}

	const data = await response.json();
	return c.json(data);
});

// Update an issue (status, assignee)
// PUT/PATCH /api/projects/:slug/issues/:issueId
const updateIssueHandler = async (c: AppContext) => {
	const slug = c.req.param('slug');
	const issueId = c.req.param('issueId');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;
	const body = await c.req.json<{ status?: string; assignee?: string }>();

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/issue/update', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				issueId,
				status: body.status,
				assignee: body.assignee,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200 | 400);
};

issueRoutes.patch('/:slug/issues/:issueId', updateIssueHandler);
issueRoutes.put('/:slug/issues/:issueId', updateIssueHandler);

// Delete an issue
// DELETE /api/projects/:slug/issues/:issueId
issueRoutes.delete('/:slug/issues/:issueId', async (c) => {
	const slug = c.req.param('slug');
	const issueId = c.req.param('issueId');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/issue/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ issueId }),
		}),
	);

	const data = await response.json();
	return c.json(data);
});

// Get project stats
// GET /api/projects/:slug/stats
issueRoutes.get('/:slug/stats', async (c) => {
	const slug = c.req.param('slug');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const interval = c.req.query('interval') as '1h' | '1d' | '1w' | undefined;
	const start = c.req.query('start');
	const end = c.req.query('end');

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/stats', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ interval, start, end }),
		}),
	);

	const data = await response.json();
	return c.json(data);
});
