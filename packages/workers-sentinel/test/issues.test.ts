import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Issues Routes', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `issues-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Issues Test User',
		});
		testProject = await createTestProject(testUser.token!, { name: 'Issues Test Project' });

		// Create some test events to generate issues
		await sendTestEvent(testProject.id, testProject.publicKey, {
			exception: {
				type: 'TypeError',
				value: 'Cannot read property "foo" of undefined',
				stacktrace: {
					frames: [{ filename: 'app.js', function: 'handleClick', lineno: 42, in_app: true }],
				},
			},
		});

		await sendTestEvent(testProject.id, testProject.publicKey, {
			exception: {
				type: 'ReferenceError',
				value: 'x is not defined',
				stacktrace: {
					frames: [{ filename: 'index.js', function: 'init', lineno: 10, in_app: true }],
				},
			},
		});
	});

	describe('GET /api/projects/:slug/issues', () => {
		it('should list issues for a project', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issues: Array<{ id: string; title: string; count: number }>;
			};

			expect(data.issues).toBeDefined();
			expect(Array.isArray(data.issues)).toBe(true);
			expect(data.issues.length).toBeGreaterThanOrEqual(2);
		});

		it('should filter issues by status', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?status=unresolved`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { issues: Array<{ status: string }> };

			expect(data.issues).toBeDefined();
			// All returned issues should be unresolved
			for (const issue of data.issues) {
				expect(issue.status).toBe('unresolved');
			}
		});

		it('should paginate issues with limit and cursor', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?limit=1`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { issues: Array<unknown>; cursor?: string };

			expect(data.issues.length).toBeLessThanOrEqual(1);
		});

		it('should return 404 for non-existent project', async () => {
			const response = await authFetch(
				testUser.token!,
				'http://localhost/api/projects/non-existent-slug/issues',
			);

			expect(response.status).toBe(404);
		});

		it('should reject unauthenticated requests', async () => {
			const response = await SELF.fetch(`http://localhost/api/projects/${testProject.slug}/issues`);

			expect(response.status).toBe(401);
		});
	});

	describe('GET /api/projects/:slug/issues/:issueId', () => {
		it('should get a specific issue by ID', async () => {
			// First get the list of issues
			const listResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues`,
			);
			const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
			const issueId = listData.issues[0].id;

			// Get specific issue
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${issueId}`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issue: { id: string; title: string; count: number; status: string };
			};

			expect(data.issue).toBeDefined();
			expect(data.issue.id).toBe(issueId);
			expect(data.issue.title).toBeDefined();
			expect(data.issue.count).toBeGreaterThanOrEqual(1);
		});

		it('should return 404 for non-existent issue', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/non-existent-issue`,
			);

			expect(response.status).toBe(404);
		});
	});

	describe('PUT /api/projects/:slug/issues/:issueId', () => {
		it('should update issue status to resolved', async () => {
			// Create a fresh user and project for this test
			const user = await createTestUser({
				email: `update-issue-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Update Issue User',
			});
			const project = await createTestProject(user.token!, { name: 'Update Issue Project' });

			// Create an event
			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'Error',
					value: 'Test error for update',
				},
			});

			// Get the issue
			const listResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
			const issueId = listData.issues[0].id;

			// Update status
			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
				{
					method: 'PUT',
					body: JSON.stringify({ status: 'resolved' }),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { issue: { status: string } };
			expect(data.issue.status).toBe('resolved');

			// Verify the change persisted
			const getResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
			);
			const getData = (await getResponse.json()) as { issue: { status: string } };
			expect(getData.issue.status).toBe('resolved');
		});

		it('should update issue status to ignored', async () => {
			// Create a fresh user and project
			const user = await createTestUser({
				email: `ignore-issue-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Ignore Issue User',
			});
			const project = await createTestProject(user.token!, { name: 'Ignore Issue Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'To be ignored' },
			});

			const listResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
			const issueId = listData.issues[0].id;

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
				{
					method: 'PUT',
					body: JSON.stringify({ status: 'ignored' }),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { issue: { status: string } };
			expect(data.issue.status).toBe('ignored');
		});
	});

	describe('DELETE /api/projects/:slug/issues/:issueId', () => {
		it('should delete an issue', async () => {
			// Create fresh user and project
			const user = await createTestUser({
				email: `delete-issue-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Delete Issue User',
			});
			const project = await createTestProject(user.token!, { name: 'Delete Issue Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'To be deleted' },
			});

			const listResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
			const issueId = listData.issues[0].id;

			// Delete the issue
			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
				{
					method: 'DELETE',
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { success: boolean };
			expect(data.success).toBe(true);

			// Verify deletion
			const getResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
			);
			expect(getResponse.status).toBe(404);
		});
	});

	describe('GET /api/projects/:slug/issues/:issueId/events', () => {
		it('should list events for an issue', async () => {
			const listResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues`,
			);
			const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
			const issueId = listData.issues[0].id;

			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${issueId}/events`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { events: Array<{ id: string; timestamp: string }> };

			expect(data.events).toBeDefined();
			expect(Array.isArray(data.events)).toBe(true);
			expect(data.events.length).toBeGreaterThan(0);
		});
	});

	describe('GET /api/projects/:slug/events/:eventId', () => {
		it('should get a specific event by ID', async () => {
			// Get issues first
			const issuesResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as { issues: Array<{ id: string }> };
			const issueId = issuesData.issues[0].id;

			// Get events for the issue
			const eventsResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${issueId}/events`,
			);
			const eventsData = (await eventsResponse.json()) as { events: Array<{ event_id: string }> };
			const eventId = eventsData.events[0].event_id;

			// Get specific event
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/events/${eventId}`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { event: { event_id: string } };

			expect(data.event).toBeDefined();
			expect(data.event.event_id).toBe(eventId);
		});

		it('should return 404 for non-existent event', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/events/non-existent-event`,
			);

			expect(response.status).toBe(404);
		});
	});
});
