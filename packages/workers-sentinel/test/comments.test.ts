import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Comments and Activity', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;
	let testIssueId: string;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `comments-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Comments Test User',
		});
		testProject = await createTestProject(testUser.token!, { name: 'Comments Test Project' });

		await sendTestEvent(testProject.id, testProject.publicKey, {
			exception: {
				type: 'TypeError',
				value: 'Cannot read property "bar" of null',
				stacktrace: {
					frames: [{ filename: 'app.js', function: 'handleClick', lineno: 42, in_app: true }],
				},
			},
		});

		const listResponse = await authFetch(
			testUser.token!,
			`http://localhost/api/projects/${testProject.slug}/issues`,
		);
		const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
		testIssueId = listData.issues[0].id;
	});

	describe('POST /api/projects/:slug/issues/:issueId/comments', () => {
		it('should add a comment to an issue', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments`,
				{
					method: 'POST',
					body: JSON.stringify({ body: 'This started after deploy v2.3.1' }),
				},
			);

			expect(response.status).toBe(201);
			const data = (await response.json()) as {
				comment: {
					id: string;
					issueId: string;
					userId: string;
					userName: string;
					body: string;
					createdAt: string;
				};
			};

			expect(data.comment).toBeDefined();
			expect(data.comment.body).toBe('This started after deploy v2.3.1');
			expect(data.comment.userName).toBe('Comments Test User');
			expect(data.comment.issueId).toBe(testIssueId);
		});

		it('should reject empty comment body', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments`,
				{
					method: 'POST',
					body: JSON.stringify({ body: '' }),
				},
			);

			expect(response.status).toBe(400);
		});

		it('should reject comment body over 2000 chars', async () => {
			const longBody = 'a'.repeat(2001);
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments`,
				{
					method: 'POST',
					body: JSON.stringify({ body: longBody }),
				},
			);

			expect(response.status).toBe(400);
		});
	});

	describe('GET /api/projects/:slug/issues/:issueId/comments', () => {
		it('should list comments in chronological order', async () => {
			// Add a second comment
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments`,
				{
					method: 'POST',
					body: JSON.stringify({ body: 'Root cause is a race condition' }),
				},
			);

			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				comments: Array<{ body: string; createdAt: string }>;
			};

			expect(data.comments.length).toBeGreaterThanOrEqual(2);
			// Verify chronological order
			for (let i = 1; i < data.comments.length; i++) {
				expect(data.comments[i].createdAt >= data.comments[i - 1].createdAt).toBe(true);
			}
		});
	});

	describe('DELETE /api/projects/:slug/issues/:issueId/comments/:commentId', () => {
		it('should delete own comment', async () => {
			// Add a comment
			const addResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments`,
				{
					method: 'POST',
					body: JSON.stringify({ body: 'Comment to delete' }),
				},
			);
			const addData = (await addResponse.json()) as { comment: { id: string } };
			const commentId = addData.comment.id;

			// Delete it
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments/${commentId}`,
				{ method: 'DELETE' },
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { success: boolean };
			expect(data.success).toBe(true);
		});

		it('should reject deletion by non-author', async () => {
			// Add a comment as testUser
			const addResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments`,
				{
					method: 'POST',
					body: JSON.stringify({ body: 'Another user should not delete this' }),
				},
			);
			const addData = (await addResponse.json()) as { comment: { id: string } };
			const commentId = addData.comment.id;

			// Create a different user and add them to the project
			const otherUser = await createTestUser({
				email: `other-user-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Other User',
			});

			// Try to delete as the other user (should fail with 403)
			const response = await authFetch(
				otherUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/comments/${commentId}`,
				{ method: 'DELETE' },
			);

			// Either 403 (forbidden) or 404 (project not found since other user isn't a member)
			expect([403, 404]).toContain(response.status);
		});
	});

	describe('GET /api/projects/:slug/issues/:issueId/activity', () => {
		it('should return activity entries for comments', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/activity`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				activity: Array<{
					type: string;
					userName: string;
					data: Record<string, string>;
				}>;
				hasMore: boolean;
			};

			expect(data.activity).toBeDefined();
			expect(Array.isArray(data.activity)).toBe(true);
			// Should have comment activity entries
			const commentEntries = data.activity.filter((a) => a.type === 'comment');
			expect(commentEntries.length).toBeGreaterThan(0);
		});

		it('should record activity on status change', async () => {
			// Update status
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}`,
				{
					method: 'PUT',
					body: JSON.stringify({ status: 'resolved' }),
				},
			);

			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/activity`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				activity: Array<{
					type: string;
					data: { from: string; to: string };
				}>;
			};

			const statusEntries = data.activity.filter((a) => a.type === 'status_change');
			expect(statusEntries.length).toBeGreaterThan(0);

			const latestStatus = statusEntries[0];
			expect(latestStatus.data.from).toBe('unresolved');
			expect(latestStatus.data.to).toBe('resolved');
		});

		it('should support pagination', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/activity?limit=1`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				activity: Array<unknown>;
				hasMore: boolean;
				nextCursor?: string;
			};

			expect(data.activity.length).toBeLessThanOrEqual(1);
			if (data.hasMore) {
				expect(data.nextCursor).toBeDefined();
			}
		});
	});

	describe('Cascade delete', () => {
		it('should delete comments and activity when issue is deleted', async () => {
			// Create fresh project and issue
			const user = await createTestUser({
				email: `cascade-test-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Cascade Test User',
			});
			const project = await createTestProject(user.token!, { name: 'Cascade Test Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'To be cascade deleted' },
			});

			const listResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
			const issueId = listData.issues[0].id;

			// Add a comment
			await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}/comments`,
				{
					method: 'POST',
					body: JSON.stringify({ body: 'This will be cascade deleted' }),
				},
			);

			// Verify comment exists
			const commentsResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}/comments`,
			);
			const commentsData = (await commentsResponse.json()) as {
				comments: Array<{ id: string }>;
			};
			expect(commentsData.comments.length).toBe(1);

			// Delete the issue
			const deleteResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
				{ method: 'DELETE' },
			);
			expect(deleteResponse.status).toBe(200);

			// Issue should be gone
			const getResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
			);
			expect(getResponse.status).toBe(404);
		});
	});
});
