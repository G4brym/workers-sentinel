import { WorkerEntrypoint } from 'cloudflare:workers';
import { extractEvents } from './lib/envelope-parser';
import type { EnvelopeItem, Env, Project } from './types';

// Sentry envelope format: [header, ...items] where each item is [itemHeader, payload]
type SentryEnvelope = [Record<string, unknown>, Array<[Record<string, unknown>, unknown]>];

/**
 * RPC entrypoint for Workers Sentinel.
 *
 * Allows other Cloudflare Workers to send events via service binding RPC
 * instead of HTTP, reducing latency.
 *
 * Usage in target worker:
 *
 * ```typescript
 * // wrangler.jsonc
 * {
 *   "services": [{ "binding": "SENTINEL", "service": "workers-sentinel", "entrypoint": "SentinelRpc" }]
 * }
 *
 * // index.ts
 * import * as Sentry from "@sentry/cloudflare";
 * import { waitUntil } from "cloudflare:workers";
 *
 * const DSN = "https://<public_key>@sentinel/<project_id>";
 *
 * export default Sentry.withSentry(
 *   (env) => ({
 *     dsn: DSN,
 *     transport: () => ({
 *       send: async (envelope) => {
 *         const rpcPromise = env.SENTINEL.captureEnvelope(DSN, envelope);
 *         waitUntil(rpcPromise);
 *         const result = await rpcPromise;
 *         return { statusCode: result.status };
 *       },
 *       flush: async () => true,
 *     }),
 *   }),
 *   { async fetch(request, env, ctx) { ... } }
 * );
 * ```
 */
export class SentinelRpc extends WorkerEntrypoint<Env> {
	/**
	 * Capture a Sentry envelope.
	 *
	 * @param dsn - The full DSN string (e.g., "https://publicKey@host/projectId")
	 * @param envelope - The Sentry envelope object (not serialized)
	 * @returns Object with status code and optional event ID
	 */
	async captureEnvelope(
		dsn: string,
		envelope: SentryEnvelope,
	): Promise<{ status: number; eventId?: string }> {
		// Parse DSN to extract publicKey and projectId
		let publicKey: string;
		let projectId: string;
		try {
			const url = new URL(dsn);
			publicKey = url.username;
			projectId = url.pathname.split('/').filter(Boolean).pop() || '';
			if (!publicKey || !projectId) {
				return { status: 400 };
			}
		} catch {
			return { status: 400 };
		}

		// Convert Sentry envelope format to our ParsedEnvelope format
		const parsed = {
			header: envelope[0],
			items: (envelope[1] || []).map(([header, payload]) => ({
				type: (header as { type: string }).type as EnvelopeItem['type'],
				payload,
			})),
		};

		// Validate the public key against the project
		const authStateId = this.env.AUTH_STATE.idFromName('global');
		const authState = this.env.AUTH_STATE.get(authStateId);

		const projectResponse = await authState.fetch(
			new Request('http://internal/get-project-by-key', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ publicKey }),
			}),
		);

		if (!projectResponse.ok) {
			return { status: 401 };
		}

		const projectData = (await projectResponse.json()) as { project: Project };
		const project = projectData.project;

		// Verify project ID matches
		if (projectId !== project.id) {
			return { status: 400 };
		}

		// Extract events from envelope
		const events = extractEvents(parsed);

		if (events.length === 0) {
			return { status: 200 };
		}

		// Get the ProjectState Durable Object for this project
		const projectStateId = this.env.PROJECT_STATE.idFromName(project.id);
		const projectState = this.env.PROJECT_STATE.get(projectStateId);

		// Ingest each event
		let firstEventId: string | undefined;
		for (const event of events) {
			try {
				const response = await projectState.fetch(
					new Request('http://internal/ingest', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(event),
					}),
				);

				if (response.ok && !firstEventId) {
					const result = (await response.json()) as { eventId: string };
					firstEventId = result.eventId;
				}
			} catch {
				// Silently continue on ingest errors
			}
		}

		return { status: 200, eventId: firstEventId };
	}

	/**
	 * Handle fetch requests (fallback for non-RPC calls)
	 */
	async fetch(): Promise<Response> {
		return new Response('SentinelRpc: Use captureEnvelope() RPC method', { status: 400 });
	}
}
