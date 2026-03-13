import { type Context, Hono } from 'hono';
import type { AuthContext, Env, Project } from '../types';

type Variables = {
	auth?: AuthContext;
};

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const sourcemapRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

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

// Upload a source map
// POST /api/projects/:slug/sourcemaps
sourcemapRoutes.post('/:slug/sourcemaps', async (c) => {
	const slug = c.req.param('slug');
	const projectResult = await getProjectWithAccess(c, slug);

	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;
	const body = await c.req.json<{ release: string; fileUrl: string; content: string }>();

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/sourcemaps/upload', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				release: body.release,
				fileUrl: body.fileUrl,
				content: body.content,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as 200 | 400);
});

// List source maps
// GET /api/projects/:slug/sourcemaps
sourcemapRoutes.get('/:slug/sourcemaps', async (c) => {
	const slug = c.req.param('slug');
	const projectResult = await getProjectWithAccess(c, slug);

	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;
	const release = c.req.query('release');

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/sourcemaps/list', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ release }),
		}),
	);

	const data = await response.json();
	return c.json(data);
});

// Get a source map by release + fileUrl for client-side resolution
// GET /api/projects/:slug/sourcemaps/resolve
sourcemapRoutes.get('/:slug/sourcemaps/resolve', async (c) => {
	const slug = c.req.param('slug');
	const projectResult = await getProjectWithAccess(c, slug);

	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;
	const release = c.req.query('release');
	const fileUrl = c.req.query('fileUrl');

	if (!release || !fileUrl) {
		return c.json({ error: 'missing_release_or_file_url' }, 400);
	}

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/sourcemaps/get', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ release, fileUrl }),
		}),
	);

	if (!response.ok) {
		const error = await response.json();
		return c.json(error, response.status as 404);
	}

	const data = await response.json();
	return c.json(data);
});

// Delete a source map
// DELETE /api/projects/:slug/sourcemaps/:id
sourcemapRoutes.delete('/:slug/sourcemaps/:id', async (c) => {
	const slug = c.req.param('slug');
	const id = c.req.param('id');

	const projectResult = await getProjectWithAccess(c, slug);
	if (projectResult instanceof Response) {
		return projectResult;
	}

	const { project } = projectResult;

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(
		new Request('http://internal/sourcemaps/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id }),
		}),
	);

	const data = await response.json();
	return c.json(data);
});
