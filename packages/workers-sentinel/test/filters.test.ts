import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Inbound Filters', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `filters-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Filters Test User',
		});
		testProject = await createTestProject(testUser.token!, {
			name: 'Filters Test Project',
		});
	});

	describe('Filter CRUD', () => {
		it('should create a filter with valid type and pattern', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'message',
						pattern: 'ResizeObserver loop',
						description: 'Browser noise',
					}),
				},
			);

			expect(response.status).toBe(201);
			const data = (await response.json()) as {
				filter: { id: string; filterType: string; pattern: string; enabled: boolean };
			};
			expect(data.filter.id).toBeDefined();
			expect(data.filter.filterType).toBe('message');
			expect(data.filter.pattern).toBe('ResizeObserver loop');
			expect(data.filter.enabled).toBe(true);
		});

		it('should reject a filter with invalid type', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'invalid_type',
						pattern: 'test',
					}),
				},
			);

			expect(response.status).toBe(400);
		});

		it('should reject a filter with empty pattern', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'message',
						pattern: '',
					}),
				},
			);

			expect(response.status).toBe(400);
		});

		it('should list all filters', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				filters: Array<{ id: string }>;
			};
			expect(data.filters.length).toBeGreaterThan(0);
		});

		it('should update filter enabled field', async () => {
			// Create a filter to update
			const createResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'error_type',
						pattern: 'ChunkLoadError',
					}),
				},
			);
			const created = (await createResponse.json()) as {
				filter: { id: string; enabled: boolean };
			};

			// Disable it
			const updateResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters/${created.filter.id}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ enabled: false }),
				},
			);

			expect(updateResponse.status).toBe(200);
			const updated = (await updateResponse.json()) as {
				filter: { id: string; enabled: boolean };
			};
			expect(updated.filter.enabled).toBe(false);
		});

		it('should update filter pattern', async () => {
			const createResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'message',
						pattern: 'old pattern',
					}),
				},
			);
			const created = (await createResponse.json()) as {
				filter: { id: string };
			};

			const updateResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters/${created.filter.id}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ pattern: 'new pattern' }),
				},
			);

			expect(updateResponse.status).toBe(200);
			const updated = (await updateResponse.json()) as {
				filter: { pattern: string };
			};
			expect(updated.filter.pattern).toBe('new pattern');
		});

		it('should delete a filter', async () => {
			const createResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'environment',
						pattern: 'staging',
					}),
				},
			);
			const created = (await createResponse.json()) as {
				filter: { id: string };
			};

			const deleteResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters/${created.filter.id}`,
				{ method: 'DELETE' },
			);

			expect(deleteResponse.status).toBe(200);
			const data = (await deleteResponse.json()) as { success: boolean };
			expect(data.success).toBe(true);

			// Verify it's gone
			const listResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/filters`,
			);
			const listData = (await listResponse.json()) as {
				filters: Array<{ id: string }>;
			};
			expect(listData.filters.find((f) => f.id === created.filter.id)).toBeUndefined();
		});
	});

	describe('Filter evaluation during ingestion', () => {
		let filterUser: Awaited<ReturnType<typeof createTestUser>>;
		let filterProject: Awaited<ReturnType<typeof createTestProject>>;

		beforeAll(async () => {
			filterUser = await createTestUser({
				email: `filter-eval-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Filter Eval User',
			});
			filterProject = await createTestProject(filterUser.token!, {
				name: 'Filter Eval Project',
			});
		});

		it('should drop events matching a message filter', async () => {
			// Create a message filter
			await authFetch(
				filterUser.token!,
				`http://localhost/api/projects/${filterProject.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'message',
						pattern: 'ResizeObserver loop',
					}),
				},
			);

			// Send an event that matches the filter
			const result = await sendTestEvent(filterProject.id, filterProject.publicKey, {
				exception: {
					type: 'Error',
					value: 'ResizeObserver loop completed with undelivered notifications.',
				},
			});

			// The event should still return an id (SDK sees 200)
			expect(result).toBeDefined();

			// Verify no issue was created for this event
			const issuesResponse = await authFetch(
				filterUser.token!,
				`http://localhost/api/projects/${filterProject.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ title: string }>;
			};

			const matchingIssues = issuesData.issues.filter((i) => i.title.includes('ResizeObserver'));
			expect(matchingIssues.length).toBe(0);
		});

		it('should increment dropped_count on matching filter', async () => {
			const listResponse = await authFetch(
				filterUser.token!,
				`http://localhost/api/projects/${filterProject.slug}/filters`,
			);
			const listData = (await listResponse.json()) as {
				filters: Array<{ id: string; pattern: string; droppedCount: number }>;
			};

			const resizeFilter = listData.filters.find((f) => f.pattern === 'ResizeObserver loop');
			expect(resizeFilter).toBeDefined();
			expect(resizeFilter!.droppedCount).toBeGreaterThanOrEqual(1);
		});

		it('should not drop events that do not match any filter', async () => {
			// Send an event that does NOT match the existing filter
			await sendTestEvent(filterProject.id, filterProject.publicKey, {
				exception: {
					type: 'TypeError',
					value: 'Cannot read property of undefined',
				},
			});

			// Verify the issue WAS created
			const issuesResponse = await authFetch(
				filterUser.token!,
				`http://localhost/api/projects/${filterProject.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ title: string }>;
			};

			const matchingIssues = issuesData.issues.filter((i) => i.title.includes('TypeError'));
			expect(matchingIssues.length).toBe(1);
		});

		it('should not drop events when filter is disabled', async () => {
			// Create a new project for isolation
			const user = await createTestUser({
				email: `filter-disabled-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Disabled Filter User',
			});
			const project = await createTestProject(user.token!, {
				name: 'Disabled Filter Project',
			});

			// Create and then disable a filter
			const createResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'message',
						pattern: 'specific error',
					}),
				},
			);
			const created = (await createResponse.json()) as {
				filter: { id: string };
			};

			await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/filters/${created.filter.id}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ enabled: false }),
				},
			);

			// Send matching event
			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'Error',
					value: 'This is a specific error that should not be filtered',
				},
			});

			// Verify the issue WAS created (filter was disabled)
			const issuesResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ title: string }>;
			};

			expect(issuesData.issues.length).toBeGreaterThan(0);
		});

		it('should match error_type filter correctly', async () => {
			const user = await createTestUser({
				email: `filter-errtype-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Error Type Filter User',
			});
			const project = await createTestProject(user.token!, {
				name: 'Error Type Filter Project',
			});

			// Create error_type filter
			await authFetch(user.token!, `http://localhost/api/projects/${project.slug}/filters`, {
				method: 'POST',
				body: JSON.stringify({
					filterType: 'error_type',
					pattern: 'ChunkLoadError',
				}),
			});

			// Send matching event
			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'ChunkLoadError',
					value: 'Loading chunk 5 failed',
				},
			});

			// Should be filtered
			const issuesResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ title: string }>;
			};

			const matching = issuesData.issues.filter((i) => i.title.includes('ChunkLoadError'));
			expect(matching.length).toBe(0);
		});

		it('should match environment filter case-insensitively', async () => {
			const user = await createTestUser({
				email: `filter-env-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Env Filter User',
			});
			const project = await createTestProject(user.token!, {
				name: 'Env Filter Project',
			});

			// Create environment filter
			await authFetch(user.token!, `http://localhost/api/projects/${project.slug}/filters`, {
				method: 'POST',
				body: JSON.stringify({
					filterType: 'environment',
					pattern: 'staging',
				}),
			});

			// Send event with uppercase environment
			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'Error',
					value: 'Staging error',
				},
				environment: 'Staging',
			});

			// Should be filtered (case-insensitive match)
			const issuesResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ title: string }>;
			};

			expect(issuesData.issues.length).toBe(0);
		});

		it('should match release filter exactly', async () => {
			const user = await createTestUser({
				email: `filter-release-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Release Filter User',
			});
			const project = await createTestProject(user.token!, {
				name: 'Release Filter Project',
			});

			// Create release filter
			await authFetch(user.token!, `http://localhost/api/projects/${project.slug}/filters`, {
				method: 'POST',
				body: JSON.stringify({
					filterType: 'release',
					pattern: '1.0.0-beta.1',
				}),
			});

			// Send event with matching release
			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'Error',
					value: 'Beta release error',
				},
				release: '1.0.0-beta.1',
			});

			// Should be filtered
			const issuesResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ title: string }>;
			};

			expect(issuesData.issues.length).toBe(0);

			// Send event with different release — should NOT be filtered
			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'Error',
					value: 'Stable release error',
				},
				release: '1.0.0',
			});

			const issuesResponse2 = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const issuesData2 = (await issuesResponse2.json()) as {
				issues: Array<{ title: string }>;
			};

			expect(issuesData2.issues.length).toBe(1);
		});

		it('should not crash when event has no user and ip_address filter exists', async () => {
			const user = await createTestUser({
				email: `filter-nouser-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'No User Filter User',
			});
			const project = await createTestProject(user.token!, {
				name: 'No User Filter Project',
			});

			// Create ip_address filter
			await authFetch(user.token!, `http://localhost/api/projects/${project.slug}/filters`, {
				method: 'POST',
				body: JSON.stringify({
					filterType: 'ip_address',
					pattern: '192.168.1.1',
				}),
			});

			// Send event without user info - should not crash
			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'Error',
					value: 'No user error',
				},
			});

			// Should be stored (no user to match IP against)
			const issuesResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ title: string }>;
			};

			expect(issuesData.issues.length).toBe(1);
		});
	});

	describe('Filter limits and edge cases', () => {
		it('should enforce 100-filter limit per project', async () => {
			const user = await createTestUser({
				email: `filter-limit-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Limit Test User',
			});
			const project = await createTestProject(user.token!, {
				name: 'Limit Test Project',
			});

			// Create 100 filters
			for (let i = 0; i < 100; i++) {
				const response = await authFetch(
					user.token!,
					`http://localhost/api/projects/${project.slug}/filters`,
					{
						method: 'POST',
						body: JSON.stringify({
							filterType: 'message',
							pattern: `limit-test-pattern-${i}`,
						}),
					},
				);
				expect(response.status).toBe(201);
			}

			// 101st should fail
			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/filters`,
				{
					method: 'POST',
					body: JSON.stringify({
						filterType: 'message',
						pattern: 'one-too-many',
					}),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('limit_reached');
		});

		it('should return 404 when updating a non-existent filter', async () => {
			const user = await createTestUser({
				email: `filter-update-404-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: '404 Update User',
			});
			const project = await createTestProject(user.token!, {
				name: '404 Update Project',
			});

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/filters/non-existent-id`,
				{
					method: 'PATCH',
					body: JSON.stringify({ enabled: false }),
				},
			);

			expect(response.status).toBe(404);
		});

		it('should return 404 when deleting a non-existent filter', async () => {
			const user = await createTestUser({
				email: `filter-delete-404-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: '404 Delete User',
			});
			const project = await createTestProject(user.token!, {
				name: '404 Delete Project',
			});

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/filters/non-existent-id`,
				{ method: 'DELETE' },
			);

			expect(response.status).toBe(404);
		});
	});
});
