import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AuthContext, Env } from '../types';

type Variables = {
	auth?: AuthContext;
};

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const memberRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper to get project and check member role
async function getProjectAndRole(
	c: AppContext,
	slug: string,
): Promise<{ projectId: string; role: string } | Response> {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	// Resolve slug to project
	const getResponse = await authState.fetch(
		new Request('http://internal/get-project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slug, userId: auth.user.id }),
		}),
	);

	if (!getResponse.ok) {
		return c.json({ error: 'project_not_found' }, 404);
	}

	const projectData = (await getResponse.json()) as { project: { id: string } };

	// Check access and get role
	const accessResponse = await authState.fetch(
		new Request('http://internal/check-access', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ projectId: projectData.project.id, userId: auth.user.id }),
		}),
	);

	const accessData = (await accessResponse.json()) as {
		hasAccess: boolean;
		role: string | null;
	};

	if (!accessData.hasAccess) {
		return c.json({ error: 'forbidden' }, 403);
	}

	return { projectId: projectData.project.id, role: accessData.role! };
}

// List all members of a project
// GET /api/projects/:slug/members
memberRoutes.get('/:slug/members', async (c) => {
	const slug = c.req.param('slug');
	const result = await getProjectAndRole(c, slug);

	if (result instanceof Response) {
		return result;
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/list-project-members', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ projectId: result.projectId }),
		}),
	);

	const data = await response.json();
	return c.json(data);
});

// Add a member to a project
// POST /api/projects/:slug/members
memberRoutes.post('/:slug/members', async (c) => {
	const slug = c.req.param('slug');
	const result = await getProjectAndRole(c, slug);

	if (result instanceof Response) {
		return result;
	}

	// Only owner or admin can add members
	if (result.role !== 'owner' && result.role !== 'admin') {
		return c.json({ error: 'forbidden', message: 'Only owner or admin can manage members' }, 403);
	}

	const body = await c.req.json<{ email: string; role: string }>();

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/add-project-member', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				projectId: result.projectId,
				email: body.email,
				role: body.role,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as ContentfulStatusCode);
});

// Update a member's role
// PATCH /api/projects/:slug/members/:userId
memberRoutes.patch('/:slug/members/:userId', async (c) => {
	const slug = c.req.param('slug');
	const userId = c.req.param('userId');
	const result = await getProjectAndRole(c, slug);

	if (result instanceof Response) {
		return result;
	}

	if (result.role !== 'owner' && result.role !== 'admin') {
		return c.json({ error: 'forbidden', message: 'Only owner or admin can manage members' }, 403);
	}

	const body = await c.req.json<{ role: string }>();

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/update-project-member', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				projectId: result.projectId,
				userId,
				role: body.role,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as ContentfulStatusCode);
});

// Remove a member from a project
// DELETE /api/projects/:slug/members/:userId
memberRoutes.delete('/:slug/members/:userId', async (c) => {
	const slug = c.req.param('slug');
	const userId = c.req.param('userId');
	const result = await getProjectAndRole(c, slug);

	if (result instanceof Response) {
		return result;
	}

	if (result.role !== 'owner' && result.role !== 'admin') {
		return c.json({ error: 'forbidden', message: 'Only owner or admin can manage members' }, 403);
	}

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const response = await authState.fetch(
		new Request('http://internal/remove-project-member', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				projectId: result.projectId,
				userId,
			}),
		}),
	);

	const data = await response.json();
	return c.json(data, response.status as ContentfulStatusCode);
});
