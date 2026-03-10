import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Summary Route', () => {
	describe('GET /api/projects/:slug/summary (empty project)', () => {
		let testUser: Awaited<ReturnType<typeof createTestUser>>;
		let testProject: Awaited<ReturnType<typeof createTestProject>>;

		beforeAll(async () => {
			testUser = await createTestUser({
				email: `summary-empty-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Summary Empty Test User',
			});
			testProject = await createTestProject(testUser.token!, {
				name: 'Summary Empty Test Project',
			});
		});

		it('should return zeros and empty arrays for a project with no events', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/summary`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issuesByStatus: Record<string, number>;
				events24h: number;
				events7d: number;
				trend: Array<{ bucket: string; count: number }>;
				topIssues: Array<unknown>;
				totalUsers: number;
			};

			expect(data.issuesByStatus).toEqual({});
			expect(data.events24h).toBe(0);
			expect(data.events7d).toBe(0);
			expect(data.trend).toEqual([]);
			expect(data.topIssues).toEqual([]);
			expect(data.totalUsers).toBe(0);
		});
	});

	describe('GET /api/projects/:slug/summary (with events)', () => {
		let testUser: Awaited<ReturnType<typeof createTestUser>>;
		let testProject: Awaited<ReturnType<typeof createTestProject>>;

		beforeAll(async () => {
			testUser = await createTestUser({
				email: `summary-events-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Summary Events Test User',
			});
			testProject = await createTestProject(testUser.token!, {
				name: 'Summary Events Test Project',
			});

			// Ingest several events across different issues
			await sendTestEvent(testProject.id, testProject.publicKey, {
				exception: {
					type: 'TypeError',
					value: 'Cannot read property "foo" of undefined',
					stacktrace: {
						frames: [{ filename: 'app.js', function: 'handleClick', lineno: 42, in_app: true }],
					},
				},
				user: { id: 'user-1', email: 'user1@example.com' },
			});

			// Send same error again to bump count
			await sendTestEvent(testProject.id, testProject.publicKey, {
				exception: {
					type: 'TypeError',
					value: 'Cannot read property "foo" of undefined',
					stacktrace: {
						frames: [{ filename: 'app.js', function: 'handleClick', lineno: 42, in_app: true }],
					},
				},
				user: { id: 'user-2', email: 'user2@example.com' },
			});

			// Send a different error
			await sendTestEvent(testProject.id, testProject.publicKey, {
				exception: {
					type: 'ReferenceError',
					value: 'x is not defined',
					stacktrace: {
						frames: [{ filename: 'index.js', function: 'init', lineno: 10, in_app: true }],
					},
				},
				user: { id: 'user-1', email: 'user1@example.com' },
			});
		});

		it('should return correct issue counts by status', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/summary`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issuesByStatus: Record<string, number>;
			};

			expect(data.issuesByStatus).toBeDefined();
			expect(data.issuesByStatus.unresolved).toBe(2);
		});

		it('should return correct event counts for time windows', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/summary`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				events24h: number;
				events7d: number;
			};

			// All 3 events were just sent, so they should be within both windows
			expect(data.events24h).toBe(3);
			expect(data.events7d).toBe(3);
		});

		it('should return trend data with hourly buckets', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/summary`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				trend: Array<{ bucket: string; count: number }>;
			};

			expect(data.trend).toBeDefined();
			expect(Array.isArray(data.trend)).toBe(true);
			expect(data.trend.length).toBeGreaterThan(0);

			// Each trend entry should have bucket and count
			for (const entry of data.trend) {
				expect(entry.bucket).toBeDefined();
				expect(typeof entry.count).toBe('number');
				expect(entry.count).toBeGreaterThan(0);
			}

			// Total count across all buckets should equal 3
			const totalCount = data.trend.reduce((sum, entry) => sum + entry.count, 0);
			expect(totalCount).toBe(3);
		});

		it('should return top unresolved issues sorted by count descending', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/summary`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				topIssues: Array<{
					id: string;
					title: string;
					count: number;
					status: string;
				}>;
			};

			expect(data.topIssues).toBeDefined();
			expect(data.topIssues.length).toBe(2);

			// Should be sorted by count descending
			expect(data.topIssues[0].count).toBeGreaterThanOrEqual(data.topIssues[1].count);

			// First issue should be the TypeError with count 2
			expect(data.topIssues[0].title).toContain('TypeError');
			expect(data.topIssues[0].count).toBe(2);

			// All should be unresolved
			for (const issue of data.topIssues) {
				expect(issue.status).toBe('unresolved');
			}
		});

		it('should return total unique users count', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/summary`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				totalUsers: number;
			};

			// We sent events with user-1 (twice, across two issues) and user-2
			expect(data.totalUsers).toBe(2);
		});

		it('should exclude resolved issues from top issues', async () => {
			// Resolve one of the issues
			const listResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues`,
			);
			const listData = (await listResponse.json()) as {
				issues: Array<{ id: string; title: string }>;
			};

			const referenceError = listData.issues.find((i) => i.title.includes('ReferenceError'));
			expect(referenceError).toBeDefined();

			// Resolve it
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${referenceError!.id}`,
				{
					method: 'PUT',
					body: JSON.stringify({ status: 'resolved' }),
				},
			);

			// Now get summary
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/summary`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issuesByStatus: Record<string, number>;
				topIssues: Array<{ id: string; title: string; status: string }>;
			};

			// Should now have 1 unresolved and 1 resolved
			expect(data.issuesByStatus.unresolved).toBe(1);
			expect(data.issuesByStatus.resolved).toBe(1);

			// Top issues should only contain unresolved
			expect(data.topIssues.length).toBe(1);
			expect(data.topIssues[0].title).toContain('TypeError');
		});
	});

	describe('GET /api/projects/:slug/summary (auth)', () => {
		it('should reject unauthenticated requests', async () => {
			const user = await createTestUser({
				email: `summary-auth-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Summary Auth Test User',
			});
			const project = await createTestProject(user.token!, {
				name: 'Summary Auth Test Project',
			});

			const response = await SELF.fetch(`http://localhost/api/projects/${project.slug}/summary`);

			expect(response.status).toBe(401);
		});

		it('should return 404 for non-existent project', async () => {
			const user = await createTestUser({
				email: `summary-404-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Summary 404 Test User',
			});

			const response = await authFetch(
				user.token!,
				'http://localhost/api/projects/non-existent-slug/summary',
			);

			expect(response.status).toBe(404);
		});
	});
});
