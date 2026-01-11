import { Hono, Context } from 'hono';
import type { Env, Project } from '../types';
import {
	parseEnvelope,
	extractKeyFromAuthHeader,
	extractEvents,
	maybeDecompress,
} from '../lib/envelope-parser';

export const ingestionRoutes = new Hono<{ Bindings: Env }>();

// Main envelope ingestion endpoint
// POST /api/{project_id}/envelope/
ingestionRoutes.post('/:projectId/envelope', handleIngestion);
ingestionRoutes.post('/:projectId/envelope/', handleIngestion);

// Legacy store endpoint (for older SDKs)
// POST /api/{project_id}/store/
ingestionRoutes.post('/:projectId/store', handleIngestion);
ingestionRoutes.post('/:projectId/store/', handleIngestion);

async function handleIngestion(c: Context<{ Bindings: Env }>): Promise<Response> {
	const projectId = c.req.param('projectId');

	// Extract public key from various sources
	let publicKey: string | null = null;

	// 1. Query parameter: ?sentry_key=xxx
	const sentryKeyParam = c.req.query('sentry_key');
	if (sentryKeyParam) {
		publicKey = sentryKeyParam;
	}

	// 2. X-Sentry-Auth header: Sentry sentry_version=7, sentry_key=xxx, ...
	if (!publicKey) {
		const authHeader = c.req.header('X-Sentry-Auth');
		if (authHeader) {
			publicKey = extractKeyFromAuthHeader(authHeader);
		}
	}

	// 3. Authorization header (basic auth style)
	if (!publicKey) {
		const authHeader = c.req.header('Authorization');
		if (authHeader?.startsWith('Basic ')) {
			try {
				const decoded = atob(authHeader.substring(6));
				publicKey = decoded.split(':')[0];
			} catch {
				// Invalid base64
			}
		}
	}

	if (!publicKey) {
		return c.json({ error: 'missing_auth', message: 'No authentication provided' }, 401);
	}

	// Validate the public key against the project
	const authStateId = c.env.AUTH_STATE.idFromName('global');
	const authState = c.env.AUTH_STATE.get(authStateId);

	const projectResponse = await authState.fetch(
		new Request('http://internal/get-project-by-key', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ publicKey }),
		}),
	);

	if (!projectResponse.ok) {
		return c.json({ error: 'invalid_auth', message: 'Invalid DSN' }, 401);
	}

	const projectData = (await projectResponse.json()) as { project: Project };
	const project = projectData.project;

	// Verify project ID matches (if provided in URL)
	if (projectId && projectId !== project.id) {
		return c.json({ error: 'project_mismatch', message: 'Project ID does not match DSN' }, 400);
	}

	// Parse the request body
	const contentEncoding = c.req.header('Content-Encoding') ?? null;
	const contentType = c.req.header('Content-Type') || '';
	const bodyBuffer = await c.req.arrayBuffer();

	let bodyText: string;
	try {
		bodyText = await maybeDecompress(bodyBuffer, contentEncoding);
	} catch {
		return c.json({ error: 'decompression_failed', message: 'Failed to decompress body' }, 400);
	}

	// Parse envelope or raw event
	let events;
	try {
		if (contentType.includes('application/json') && !bodyText.includes('\n{')) {
			// Raw JSON event (legacy store endpoint)
			const event = JSON.parse(bodyText);
			events = [event];
		} else {
			// Envelope format
			const envelope = parseEnvelope(bodyText);
			events = extractEvents(envelope);
		}
	} catch (error) {
		console.error('Parse error:', error);
		return c.json({ error: 'parse_failed', message: 'Failed to parse envelope' }, 400);
	}

	if (events.length === 0) {
		return c.json({ id: null, message: 'No events in envelope' });
	}

	// Get the ProjectState Durable Object for this project
	const projectStateId = c.env.PROJECT_STATE.idFromName(project.id);
	const projectState = c.env.PROJECT_STATE.get(projectStateId);

	// Ingest each event
	const results = [];
	for (const event of events) {
		try {
			const response = await projectState.fetch(
				new Request('http://internal/ingest', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(event),
				}),
			);

			if (response.ok) {
				const result = await response.json();
				results.push(result);
			} else {
				console.error('Ingest error:', await response.text());
			}
		} catch (error) {
			console.error('Ingest error:', error);
		}
	}

	// Return the first event ID (standard Sentry response)
	const firstResult = results[0] as { eventId: string } | undefined;
	return c.json({ id: firstResult?.eventId || events[0]?.event_id || null });
}

// Security endpoint - returns project configuration
// GET /api/{project_id}/security/
ingestionRoutes.get('/:projectId/security', async (c) => {
	// Return CORS headers for browser SDKs
	return c.json({
		allowedDomains: ['*'],
		scrubData: true,
	});
});
