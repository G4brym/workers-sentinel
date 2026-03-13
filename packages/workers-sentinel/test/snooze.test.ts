import { env, runDurableObjectAlarm, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Issue Snooze', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;
	let testIssueId: string;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `snooze-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Snooze Test User',
		});
		testProject = await createTestProject(testUser.token!, { name: 'Snooze Test Project' });

		// Create a test event to generate an issue
		await sendTestEvent(testProject.id, testProject.publicKey, {
			exception: {
				type: 'TypeError',
				value: 'Cannot read property "bar" of null',
				stacktrace: {
					frames: [{ filename: 'snooze.js', function: 'testSnooze', lineno: 10, in_app: true }],
				},
			},
		});

		// Get the issue ID
		const listResponse = await authFetch(
			testUser.token!,
			`http://localhost/api/projects/${testProject.slug}/issues`,
		);
		const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
		testIssueId = listData.issues[0].id;
	});

	describe('POST /api/projects/:slug/issues/:issueId/snooze', () => {
		it('should snooze an issue with preset duration', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'POST',
					body: JSON.stringify({ duration: '1d' }),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issue: { id: string; snoozedUntil: string | null };
			};

			expect(data.issue).toBeDefined();
			expect(data.issue.snoozedUntil).toBeDefined();
			expect(data.issue.snoozedUntil).not.toBeNull();

			// Verify it's approximately 24 hours from now
			const snoozedUntil = new Date(data.issue.snoozedUntil!);
			const expectedTime = Date.now() + 24 * 60 * 60 * 1000;
			expect(Math.abs(snoozedUntil.getTime() - expectedTime)).toBeLessThan(5000);
		});

		it('should reject invalid duration', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'POST',
					body: JSON.stringify({ duration: 'invalid-date' }),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('invalid_duration');
		});

		it('should reject past timestamp', async () => {
			const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'POST',
					body: JSON.stringify({ duration: pastDate }),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('invalid_duration');
		});

		it('should accept a valid ISO 8601 future timestamp', async () => {
			const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'POST',
					body: JSON.stringify({ duration: futureDate }),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issue: { snoozedUntil: string | null };
			};
			expect(data.issue.snoozedUntil).toBeDefined();
		});
	});

	describe('Snoozed issues hidden from default list', () => {
		it('should hide snoozed issues from the default issues list', async () => {
			// Snooze the issue
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'POST',
					body: JSON.stringify({ duration: '1d' }),
				},
			);

			// Query the default issues list
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?status=unresolved`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { issues: Array<{ id: string }> };

			// The snoozed issue should not appear
			const found = data.issues.find((i) => i.id === testIssueId);
			expect(found).toBeUndefined();
		});
	});

	describe('Snoozed issues visible with snoozed filter', () => {
		it('should show snoozed issues when filtering by snoozed status', async () => {
			// Ensure the issue is snoozed
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'POST',
					body: JSON.stringify({ duration: '1d' }),
				},
			);

			// Query with snoozed filter
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?status=snoozed`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issues: Array<{ id: string; snoozedUntil: string | null }>;
			};

			const found = data.issues.find((i) => i.id === testIssueId);
			expect(found).toBeDefined();
			expect(found!.snoozedUntil).not.toBeNull();
		});
	});

	describe('DELETE /api/projects/:slug/issues/:issueId/snooze', () => {
		it('should unsnooze an issue', async () => {
			// Snooze first
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'POST',
					body: JSON.stringify({ duration: '1d' }),
				},
			);

			// Unsnooze
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'DELETE',
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issue: { id: string; snoozedUntil: string | null };
			};

			expect(data.issue.snoozedUntil).toBeNull();

			// Verify the issue appears in the default list again
			const listResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?status=unresolved`,
			);
			const listData = (await listResponse.json()) as { issues: Array<{ id: string }> };
			const found = listData.issues.find((i) => i.id === testIssueId);
			expect(found).toBeDefined();
		});
	});

	describe('Snooze non-existent issue', () => {
		it('should return 404 when snoozing a non-existent issue', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/non-existent-id/snooze`,
				{
					method: 'POST',
					body: JSON.stringify({ duration: '1d' }),
				},
			);

			expect(response.status).toBe(404);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('issue_not_found');
		});
	});

	describe('Unauthenticated requests', () => {
		it('should reject unauthenticated snooze request', async () => {
			const response = await SELF.fetch(
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ duration: '1d' }),
				},
			);

			expect(response.status).toBe(401);
		});

		it('should reject unauthenticated unsnooze request', async () => {
			const response = await SELF.fetch(
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}/snooze`,
				{
					method: 'DELETE',
				},
			);

			expect(response.status).toBe(401);
		});
	});

	describe('Alarm handler', () => {
		it('should clear snoozedUntil for expired issues when alarm fires', async () => {
			// Set a past snooze time directly via the DO (bypassing route validation)
			const projectStateId = env.PROJECT_STATE.idFromName(testProject.id);
			const projectState = env.PROJECT_STATE.get(projectStateId);

			const pastTime = new Date(Date.now() - 60 * 1000).toISOString();
			await projectState.fetch(
				new Request('http://internal/issue/snooze', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ issueId: testIssueId, duration: pastTime }),
				}),
			);

			// Verify snoozedUntil is set (even though expired, it's still non-null)
			const beforeResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}`,
			);
			const beforeData = (await beforeResponse.json()) as {
				issue: { id: string; snoozedUntil: string | null };
			};
			expect(beforeData.issue.snoozedUntil).not.toBeNull();

			// Trigger the alarm — should clear expired snoozedUntil values
			await runDurableObjectAlarm(projectState);

			// Verify snoozedUntil is now NULL
			const afterResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues/${testIssueId}`,
			);
			const afterData = (await afterResponse.json()) as {
				issue: { id: string; snoozedUntil: string | null };
			};
			expect(afterData.issue.snoozedUntil).toBeNull();
		});
	});
});
