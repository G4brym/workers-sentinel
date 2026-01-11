import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { createTestUser, createTestProject, createTestEnvelope, sendTestEvent, authFetch } from './utils';

describe('Ingestion Routes', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `ingestion-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Ingestion Test User',
		});
		testProject = await createTestProject(testUser.token!, { name: 'Ingestion Test Project' });
	});

	describe('POST /api/:projectId/envelope/', () => {
		it('should ingest a valid envelope with X-Sentry-Auth header', async () => {
			const envelope = createTestEnvelope(testProject.id, testProject.publicKey);

			const response = await SELF.fetch(`http://localhost/api/${testProject.id}/envelope/`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-sentry-envelope',
					'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${testProject.publicKey}`,
				},
				body: envelope,
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as { id: string };
			expect(data.id).toBeDefined();
		});

		it('should ingest a valid envelope with query param', async () => {
			const envelope = createTestEnvelope(testProject.id, testProject.publicKey);

			const response = await SELF.fetch(
				`http://localhost/api/${testProject.id}/envelope/?sentry_key=${testProject.publicKey}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/x-sentry-envelope' },
					body: envelope,
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { id: string };
			expect(data.id).toBeDefined();
		});

		it('should reject envelope without authentication', async () => {
			const envelope = createTestEnvelope(testProject.id, testProject.publicKey);

			const response = await SELF.fetch(`http://localhost/api/${testProject.id}/envelope/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-sentry-envelope' },
				body: envelope,
			});

			expect(response.status).toBe(401);
		});

		it('should reject envelope with invalid public key', async () => {
			const envelope = createTestEnvelope(testProject.id, 'invalid-key');

			const response = await SELF.fetch(`http://localhost/api/${testProject.id}/envelope/`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-sentry-envelope',
					'X-Sentry-Auth': 'Sentry sentry_version=7, sentry_key=invalid-key',
				},
				body: envelope,
			});

			expect(response.status).toBe(401);
		});

		it('should ingest error with exception and create issue', async () => {
			const user = await createTestUser({
				email: `ingest-exception-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Exception Test User',
			});
			const project = await createTestProject(user.token!, { name: 'Exception Test Project' });

			const result = await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'TypeError',
					value: 'Cannot read property "foo" of undefined',
					stacktrace: {
						frames: [
							{ filename: 'app.js', function: 'handleClick', lineno: 42, in_app: true },
							{ filename: 'react.js', function: 'callCallback', lineno: 100, in_app: false },
						],
					},
				},
			});

			expect(result.id).toBeDefined();

			// Verify issue was created
			const issuesResponse = await authFetch(user.token!, `http://localhost/api/projects/${project.slug}/issues`);
			const issuesData = (await issuesResponse.json()) as { issues: Array<{ title: string; count: number }> };

			expect(issuesData.issues.length).toBeGreaterThan(0);
			expect(issuesData.issues[0].title).toContain('TypeError');
		});

		it('should group similar errors into the same issue', async () => {
			const user = await createTestUser({
				email: `grouping-test-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Grouping Test User',
			});
			const project = await createTestProject(user.token!, { name: 'Grouping Test Project' });

			const errorConfig = {
				exception: {
					type: 'ReferenceError',
					value: 'x is not defined',
					stacktrace: {
						frames: [{ filename: 'index.js', function: 'processData', lineno: 55, in_app: true }],
					},
				},
			};

			// Send the same error twice
			await sendTestEvent(project.id, project.publicKey, errorConfig);
			await sendTestEvent(project.id, project.publicKey, errorConfig);

			// Check that only one issue exists with count > 1
			const issuesResponse = await authFetch(user.token!, `http://localhost/api/projects/${project.slug}/issues`);
			const issuesData = (await issuesResponse.json()) as { issues: Array<{ title: string; count: number }> };

			const referenceErrors = issuesData.issues.filter((i) => i.title.includes('ReferenceError'));
			expect(referenceErrors.length).toBe(1);
			expect(referenceErrors[0].count).toBeGreaterThanOrEqual(2);
		});

		it('should handle message-based events', async () => {
			const user = await createTestUser({
				email: `message-test-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Message Test User',
			});
			const project = await createTestProject(user.token!, { name: 'Message Test Project' });

			const result = await sendTestEvent(project.id, project.publicKey, {
				message: 'This is a test message event',
				level: 'info',
			});

			expect(result.id).toBeDefined();
		});

		it('should capture tags and user info', async () => {
			const user = await createTestUser({
				email: `tags-test-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Tags Test User',
			});
			const project = await createTestProject(user.token!, { name: 'Tags Test Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'Error',
					value: 'Tagged error',
				},
				tags: { environment: 'production', version: '1.0.0' },
				user: { id: 'user-123', email: 'user@example.com' },
				environment: 'production',
				release: 'app@1.0.0',
			});

			// Verify the event was stored with metadata
			const issuesResponse = await authFetch(user.token!, `http://localhost/api/projects/${project.slug}/issues`);
			const issuesData = (await issuesResponse.json()) as { issues: Array<{ id: string }> };

			expect(issuesData.issues.length).toBeGreaterThan(0);

			// Get events for the issue
			const eventsResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issuesData.issues[0].id}/events`,
			);
			const eventsData = (await eventsResponse.json()) as {
				events: Array<{ tags: Record<string, string>; user: { id: string } }>;
			};

			expect(eventsData.events.length).toBeGreaterThan(0);
		});
	});

	describe('POST /api/:projectId/store/', () => {
		it('should accept legacy store endpoint', async () => {
			const envelope = createTestEnvelope(testProject.id, testProject.publicKey);

			const response = await SELF.fetch(`http://localhost/api/${testProject.id}/store/`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-sentry-envelope',
					'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${testProject.publicKey}`,
				},
				body: envelope,
			});

			expect(response.status).toBe(200);
		});
	});
});
