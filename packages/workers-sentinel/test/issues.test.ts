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

	describe('PATCH /api/projects/:slug/issues/bulk', () => {
		it('should bulk resolve multiple issues', async () => {
			const user = await createTestUser({
				email: `bulk-resolve-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Bulk Resolve User',
			});
			const project = await createTestProject(user.token!, { name: 'Bulk Resolve Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'Bulk error 1' },
			});
			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'TypeError', value: 'Bulk error 2' },
			});
			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'RangeError', value: 'Bulk error 3' },
			});

			const listResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const listData = (await listResponse.json()) as {
				issues: Array<{ id: string; status: string }>;
			};
			expect(listData.issues.length).toBe(3);

			const idsToResolve = [listData.issues[0].id, listData.issues[1].id];

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/bulk`,
				{
					method: 'PATCH',
					body: JSON.stringify({ issueIds: idsToResolve, status: 'resolved' }),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { success: boolean; affected: number };
			expect(data.success).toBe(true);
			expect(data.affected).toBe(2);

			// Verify the resolved issues
			for (const id of idsToResolve) {
				const issueResponse = await authFetch(
					user.token!,
					`http://localhost/api/projects/${project.slug}/issues/${id}`,
				);
				const issueData = (await issueResponse.json()) as {
					issue: { status: string };
				};
				expect(issueData.issue.status).toBe('resolved');
			}

			// Verify the third issue is still unresolved
			const thirdResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${listData.issues[2].id}`,
			);
			const thirdData = (await thirdResponse.json()) as {
				issue: { status: string };
			};
			expect(thirdData.issue.status).toBe('unresolved');
		});

		it('should bulk delete issues', async () => {
			const user = await createTestUser({
				email: `bulk-delete-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Bulk Delete User',
			});
			const project = await createTestProject(user.token!, { name: 'Bulk Delete Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'Delete me 1' },
			});
			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'TypeError', value: 'Delete me 2' },
			});

			const listResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const listData = (await listResponse.json()) as {
				issues: Array<{ id: string }>;
			};
			const idsToDelete = listData.issues.map((i) => i.id);

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/bulk`,
				{
					method: 'PATCH',
					body: JSON.stringify({ issueIds: idsToDelete, action: 'delete' }),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { success: boolean };
			expect(data.success).toBe(true);

			// Verify deletion
			for (const id of idsToDelete) {
				const getResponse = await authFetch(
					user.token!,
					`http://localhost/api/projects/${project.slug}/issues/${id}`,
				);
				expect(getResponse.status).toBe(404);
			}
		});

		it('should return 400 for empty issueIds array', async () => {
			const user = await createTestUser({
				email: `bulk-empty-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Bulk Empty User',
			});
			const project = await createTestProject(user.token!, { name: 'Bulk Empty Project' });

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/bulk`,
				{
					method: 'PATCH',
					body: JSON.stringify({ issueIds: [], status: 'resolved' }),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('missing_issue_ids');
		});

		it('should return 400 for invalid status', async () => {
			const user = await createTestUser({
				email: `bulk-invalid-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Bulk Invalid User',
			});
			const project = await createTestProject(user.token!, { name: 'Bulk Invalid Project' });

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/bulk`,
				{
					method: 'PATCH',
					body: JSON.stringify({ issueIds: ['some-id'], status: 'invalid' }),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('invalid_status');
		});

		it('should return 400 when too many issue IDs are provided', async () => {
			const user = await createTestUser({
				email: `bulk-limit-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Bulk Limit User',
			});
			const project = await createTestProject(user.token!, { name: 'Bulk Limit Project' });

			const tooManyIds = Array.from({ length: 101 }, (_, i) => `fake-id-${i}`);
			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/bulk`,
				{
					method: 'PATCH',
					body: JSON.stringify({ issueIds: tooManyIds, status: 'resolved' }),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('too_many_issues');
		});

		it('should return 400 when no action or status is provided', async () => {
			const user = await createTestUser({
				email: `bulk-noaction-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Bulk No Action User',
			});
			const project = await createTestProject(user.token!, { name: 'Bulk No Action Project' });

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/bulk`,
				{
					method: 'PATCH',
					body: JSON.stringify({ issueIds: ['some-id'] }),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('no_action');
		});

		it('should reject unauthenticated requests', async () => {
			const response = await SELF.fetch('http://localhost/api/projects/some-project/issues/bulk', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ issueIds: ['id1'], status: 'resolved' }),
			});

			expect(response.status).toBe(401);
		});

		it('should return 404 for non-existent project', async () => {
			const user = await createTestUser({
				email: `bulk-404-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Bulk 404 User',
			});

			const response = await authFetch(
				user.token!,
				'http://localhost/api/projects/non-existent-slug/issues/bulk',
				{
					method: 'PATCH',
					body: JSON.stringify({ issueIds: ['id1'], status: 'resolved' }),
				},
			);

			expect(response.status).toBe(404);
		});
	});

	describe('Environment filtering', () => {
		let envUser: Awaited<ReturnType<typeof createTestUser>>;
		let envProject: Awaited<ReturnType<typeof createTestProject>>;

		beforeAll(async () => {
			envUser = await createTestUser({
				email: `env-filter-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Env Filter User',
			});
			envProject = await createTestProject(envUser.token!, { name: 'Env Filter Project' });

			// Send events with different environments
			await sendTestEvent(envProject.id, envProject.publicKey, {
				exception: { type: 'Error', value: 'Prod error 1' },
				environment: 'production',
			});
			await sendTestEvent(envProject.id, envProject.publicKey, {
				exception: { type: 'TypeError', value: 'Staging error 1' },
				environment: 'staging',
			});
			await sendTestEvent(envProject.id, envProject.publicKey, {
				exception: {
					type: 'ReferenceError',
					value: 'No env error',
					stacktrace: {
						frames: [
							{ filename: 'noenv.js', function: 'test', lineno: 1, in_app: true },
						],
					},
				},
			});
		});

		it('should filter issues by environment', async () => {
			const response = await authFetch(
				envUser.token!,
				`http://localhost/api/projects/${envProject.slug}/issues?environment=production`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { issues: Array<{ id: string; title: string }> };

			expect(data.issues).toBeDefined();
			expect(data.issues.length).toBe(1);
		});

		it('should return all issues when no environment filter is set', async () => {
			const response = await authFetch(
				envUser.token!,
				`http://localhost/api/projects/${envProject.slug}/issues?status=`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { issues: Array<{ id: string }> };

			expect(data.issues.length).toBe(3);
		});

		it('should return empty list for non-existent environment', async () => {
			const response = await authFetch(
				envUser.token!,
				`http://localhost/api/projects/${envProject.slug}/issues?environment=nonexistent`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { issues: Array<{ id: string }> };

			expect(data.issues.length).toBe(0);
		});

		it('should list project environments', async () => {
			const response = await authFetch(
				envUser.token!,
				`http://localhost/api/projects/${envProject.slug}/environments`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				environments: Array<{ name: string; issueCount: number; lastSeen: string }>;
			};

			expect(data.environments).toBeDefined();
			expect(data.environments.length).toBe(2);

			const envNames = data.environments.map((e) => e.name).sort();
			expect(envNames).toEqual(['production', 'staging']);

			for (const env of data.environments) {
				expect(env.issueCount).toBe(1);
				expect(env.lastSeen).toBeDefined();
			}
		});

		it('should track environment counts correctly', async () => {
			// Send another event for the same issue in production
			await sendTestEvent(envProject.id, envProject.publicKey, {
				exception: { type: 'Error', value: 'Prod error 1' },
				environment: 'production',
			});

			const response = await authFetch(
				envUser.token!,
				`http://localhost/api/projects/${envProject.slug}/environments`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				environments: Array<{ name: string; issueCount: number }>;
			};

			const prodEnv = data.environments.find((e) => e.name === 'production');
			expect(prodEnv).toBeDefined();
			expect(prodEnv!.issueCount).toBe(1); // Still 1 issue, just more events
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
