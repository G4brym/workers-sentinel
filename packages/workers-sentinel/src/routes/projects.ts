import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { buildWebhookPayload } from '../lib/webhook';
import type { AuthContext, Env } from '../types';

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

	return c.json({ ...data, dsn }, response.status as ContentfulStatusCode);
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
		return c.json(error, response.status as ContentfulStatusCode);
	}

	const data = (await response.json()) as { project: { id: string; publicKey: string } };

	// Generate DSN
	const host = new URL(c.req.url).host;
	const dsn = `https://${data.project.publicKey}@${host}/${data.project.id}`;

	return c.json({ ...data, dsn });
});

// Get project settings
projectRoutes.get('/:slug/settings', async (c) => {
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

	const { project } = (await response.json()) as { project: { id: string } };

	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const settingsResponse = await projectState.fetch(
		new Request('http://internal/settings'),
	);

	const data = await settingsResponse.json();
	return c.json(data);
});

// Update a project
projectRoutes.patch('/:slug', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const slug = c.req.param('slug');
	const body = await c.req.json<{ webhookUrl?: string | null; maxEventsPerHour?: number; retentionDays?: number }>();

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	// Get project first
	const getResponse = await authState.fetch(
		new Request('http://internal/get-project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slug, userId: auth.user.id }),
		}),
	);

	if (!getResponse.ok) {
		const error = await getResponse.json();
		return c.json(error, getResponse.status as ContentfulStatusCode);
	}

	const projectData = (await getResponse.json()) as { project: { id: string } };

	const result: Record<string, unknown> = {};

	// Update webhook URL in AuthState if provided
	if (body.webhookUrl !== undefined) {
		const updateResponse = await authState.fetch(
			new Request('http://internal/update-project', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId: projectData.project.id,
					userId: auth.user.id,
					webhookUrl: body.webhookUrl,
				}),
			}),
		);

		const data = (await updateResponse.json()) as Record<string, unknown>;
		if (!updateResponse.ok) {
			return c.json(data, updateResponse.status as ContentfulStatusCode);
		}

		Object.assign(result, data);
	}

	// Update rate limit config in ProjectState if provided
	if (body.maxEventsPerHour !== undefined) {
		const projectStateId = c.env.PROJECT_STATE.idFromName(projectData.project.id);
		const projectState = c.env.PROJECT_STATE.get(projectStateId);

		const configResponse = await projectState.fetch(
			new Request('http://internal/config/update', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ maxEventsPerHour: body.maxEventsPerHour }),
			}),
		);

		const data = (await configResponse.json()) as Record<string, unknown>;
		if (!configResponse.ok) {
			return c.json(data, configResponse.status as ContentfulStatusCode);
		}

		Object.assign(result, data);
	}


	// Update retention settings in ProjectState if provided
	if (body.retentionDays !== undefined) {
		const projectStateId = c.env.PROJECT_STATE.idFromName(projectData.project.id);
		const projectState = c.env.PROJECT_STATE.get(projectStateId);

		const settingsResponse = await projectState.fetch(
			new Request('http://internal/settings/update', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ retentionDays: body.retentionDays }),
			}),
		);

		const settingsData = (await settingsResponse.json()) as Record<string, unknown>;
		if (!settingsResponse.ok) {
			return c.json(settingsData, settingsResponse.status as ContentfulStatusCode);
		}

		Object.assign(result, settingsData);
	}

	return c.json(Object.keys(result).length > 0 ? result : { success: true });
});

// Get rate limit status for a project
projectRoutes.get('/:slug/rate-limit', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const slug = c.req.param('slug');
	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const getResponse = await authState.fetch(
		new Request('http://internal/get-project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slug, userId: auth.user.id }),
		}),
	);

	if (!getResponse.ok) {
		const error = await getResponse.json();
		return c.json(error, getResponse.status as ContentfulStatusCode);
	}

	const projectData = (await getResponse.json()) as { project: { id: string } };
	const projectStateId = c.env.PROJECT_STATE.idFromName(projectData.project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	const response = await projectState.fetch(new Request('http://internal/rate-limit-status'));
	return c.json(await response.json());
});

// Test webhook
projectRoutes.post('/:slug/test-webhook', async (c) => {
	const auth = c.get('auth');
	if (!auth) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const slug = c.req.param('slug');

	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const getResponse = await authState.fetch(
		new Request('http://internal/get-project', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slug, userId: auth.user.id }),
		}),
	);

	if (!getResponse.ok) {
		const error = await getResponse.json();
		return c.json(error, getResponse.status as ContentfulStatusCode);
	}

	const projectData = (await getResponse.json()) as {
		project: { id: string; name: string; slug: string; webhookUrl?: string | null };
	};
	const project = projectData.project;

	if (!project.webhookUrl) {
		return c.json({ error: 'no_webhook', message: 'No webhook URL configured' }, 400);
	}

	const payload = buildWebhookPayload(
		{ id: project.id, name: project.name, slug: project.slug },
		{ id: 'test-issue-id', title: 'Test Issue', level: 'info', culprit: null },
	);

	try {
		const response = await fetch(project.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		const body = await response.text();
		if (!response.ok) {
			return c.json(
				{ error: 'webhook_failed', message: `Webhook returned ${response.status}`, body },
				502,
			);
		}
		return c.json({ success: true });
	} catch (err) {
		return c.json(
			{ error: 'webhook_error', message: err instanceof Error ? err.message : 'Failed to reach webhook URL' },
			502,
		);
	}
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
		return c.json(error, getResponse.status as ContentfulStatusCode);
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
	return c.json(data, deleteResponse.status as ContentfulStatusCode);
});
