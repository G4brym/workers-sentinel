import { env, SELF } from 'cloudflare:test';

export interface TestUser {
	email: string;
	password: string;
	name: string;
	token?: string;
}

export interface TestProject {
	id: string;
	name: string;
	slug: string;
	publicKey: string;
	dsn: string;
}

/**
 * Create a test user and return the user data with token
 */
export async function createTestUser(
	user: Omit<TestUser, 'token'> = {
		email: `test-${Date.now()}@example.com`,
		password: 'testpassword123',
		name: 'Test User',
	},
	retries = 3,
): Promise<TestUser & { id: string }> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const response = await SELF.fetch('http://localhost/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(user),
			});

			if (!response.ok) {
				const text = await response.text();
				// Check if this is a DO reset error - retry if so
				if (text.includes('invalidating this Durable Object') && attempt < retries - 1) {
					await new Promise((r) => setTimeout(r, 100));
					continue;
				}
				try {
					const error = JSON.parse(text);
					throw new Error(`Failed to create user: ${JSON.stringify(error)}`);
				} catch {
					throw new Error(`Failed to create user: ${text}`);
				}
			}

			const data = (await response.json()) as { user: { id: string }; token: string };
			return {
				...user,
				id: data.user.id,
				token: data.token,
			};
		} catch (e) {
			lastError = e as Error;
			if (attempt < retries - 1) {
				await new Promise((r) => setTimeout(r, 100));
			}
		}
	}

	throw lastError || new Error('Failed to create user after retries');
}

/**
 * Login as an existing user
 */
export async function loginUser(email: string, password: string): Promise<string> {
	const response = await SELF.fetch('http://localhost/api/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to login: ${JSON.stringify(error)}`);
	}

	const data = (await response.json()) as { token: string };
	return data.token;
}

/**
 * Create a test project
 */
export async function createTestProject(
	token: string,
	project: { name: string; platform?: string } = {
		name: `Test Project ${Date.now()}`,
		platform: 'javascript',
	},
): Promise<TestProject> {
	const response = await SELF.fetch('http://localhost/api/projects', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(project),
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to create project: ${JSON.stringify(error)}`);
	}

	const data = (await response.json()) as { project: TestProject; dsn: string };
	return {
		...data.project,
		dsn: data.dsn,
	};
}

/**
 * Create a Sentry envelope for testing ingestion
 */
export function createTestEnvelope(
	projectId: string,
	publicKey: string,
	event: {
		message?: string;
		level?: string;
		exception?: {
			type: string;
			value: string;
			stacktrace?: {
				frames: Array<{
					filename: string;
					function: string;
					lineno: number;
					in_app?: boolean;
				}>;
			};
		};
		tags?: Record<string, string>;
		user?: { id?: string; email?: string };
		environment?: string;
		release?: string;
	} = {},
): string {
	const eventId = crypto.randomUUID().replace(/-/g, '');
	const timestamp = new Date().toISOString();

	const envelopeHeader = {
		event_id: eventId,
		dsn: `https://${publicKey}@localhost/${projectId}`,
		sdk: { name: 'sentry.javascript.browser', version: '7.0.0' },
		sent_at: timestamp,
	};

	const itemHeader = {
		type: 'event',
	};

	const eventPayload: Record<string, unknown> = {
		event_id: eventId,
		timestamp,
		platform: 'javascript',
		level: event.level || 'error',
		...event,
	};

	if (event.exception) {
		eventPayload.exception = {
			values: [
				{
					type: event.exception.type,
					value: event.exception.value,
					stacktrace: event.exception.stacktrace || {
						frames: [
							{
								filename: 'app.js',
								function: 'handleError',
								lineno: 42,
								in_app: true,
							},
						],
					},
				},
			],
		};
	} else if (event.message) {
		eventPayload.message = event.message;
	} else {
		// Default error
		eventPayload.exception = {
			values: [
				{
					type: 'Error',
					value: 'Test error message',
					stacktrace: {
						frames: [
							{
								filename: 'test.js',
								function: 'testFunction',
								lineno: 10,
								in_app: true,
							},
						],
					},
				},
			],
		};
	}

	return [
		JSON.stringify(envelopeHeader),
		JSON.stringify(itemHeader),
		JSON.stringify(eventPayload),
	].join('\n');
}

/**
 * Send an event to the ingestion endpoint
 */
export async function sendTestEvent(
	projectId: string,
	publicKey: string,
	event?: Parameters<typeof createTestEnvelope>[2],
): Promise<{ id: string }> {
	const envelope = createTestEnvelope(projectId, publicKey, event);

	const response = await SELF.fetch(`http://localhost/api/${projectId}/envelope/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-sentry-envelope',
			'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}`,
		},
		body: envelope,
	});

	if (!response.ok) {
		const error = await response.json();
		throw new Error(`Failed to send event: ${JSON.stringify(error)}`);
	}

	return response.json() as Promise<{ id: string }>;
}

/**
 * Make an authenticated request
 */
export async function authFetch(
	token: string,
	url: string,
	options: RequestInit = {},
): Promise<Response> {
	return SELF.fetch(url, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
			...(options.headers || {}),
		},
	});
}

/**
 * Wait for a condition to be true (useful for async operations)
 */
export async function waitFor(
	condition: () => Promise<boolean>,
	timeout = 5000,
	interval = 100,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
	throw new Error('Timeout waiting for condition');
}
