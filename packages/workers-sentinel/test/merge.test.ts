import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Issue Merge', () => {
	let token: string;
	let projectSlug: string;
	let projectId: string;
	let publicKey: string;

	beforeAll(async () => {
		const user = await createTestUser({
			email: `merge-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Merge Test User',
		});
		token = user.token!;
		const project = await createTestProject(token, { name: 'Merge Test Project' });
		projectSlug = project.slug;
		projectId = project.id;
		publicKey = project.publicKey;
	});

	async function getIssues() {
		const res = await authFetch(token, `http://localhost/api/projects/${projectSlug}/issues`);
		const data = (await res.json()) as {
			issues: Array<{ id: string; count: number; userCount: number }>;
		};
		return data.issues;
	}

	describe('POST /api/projects/:slug/issues/merge', () => {
		it('should merge two issues into the primary', async () => {
			// Create two distinct issues
			await sendTestEvent(projectId, publicKey, {
				exception: { type: 'MergeErrorA', value: 'First merge error A' },
			});
			await sendTestEvent(projectId, publicKey, {
				exception: { type: 'MergeErrorB', value: 'First merge error B' },
			});

			const issues = await getIssues();
			const issueA = issues.find((i) => i.id);
			const issueB = issues.find((i) => i.id !== issueA!.id);
			expect(issueA).toBeDefined();
			expect(issueB).toBeDefined();

			const primaryIssueId = issueA!.id;
			const secondaryIssueId = issueB!.id;

			const response = await authFetch(
				token,
				`http://localhost/api/projects/${projectSlug}/issues/merge`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						primaryIssueId,
						issueIds: [primaryIssueId, secondaryIssueId],
					}),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issue: { id: string; count: number };
				mergedCount: number;
			};
			expect(data.mergedCount).toBe(1);
			expect(data.issue).toBeDefined();
			expect(data.issue.id).toBe(primaryIssueId);
			expect(data.issue.count).toBeGreaterThanOrEqual(2);

			// Secondary issue should be gone
			const afterIssues = await getIssues();
			const secondaryGone = afterIssues.every((i) => i.id !== secondaryIssueId);
			expect(secondaryGone).toBe(true);

			// Primary issue should still exist
			const primaryStillExists = afterIssues.some((i) => i.id === primaryIssueId);
			expect(primaryStillExists).toBe(true);
		});

		it('should route new events with merged fingerprint to the primary issue', async () => {
			// Create a fresh project for this test to avoid pollution
			const user2 = await createTestUser({
				email: `merge-redirect-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Merge Redirect User',
			});
			const project2 = await createTestProject(user2.token!, { name: 'Merge Redirect Project' });

			// Create two distinct issues
			await sendTestEvent(project2.id, project2.publicKey, {
				exception: { type: 'RedirectErrorA', value: 'redirect A' },
			});
			await sendTestEvent(project2.id, project2.publicKey, {
				exception: { type: 'RedirectErrorB', value: 'redirect B' },
			});

			const res1 = await authFetch(
				user2.token!,
				`http://localhost/api/projects/${project2.slug}/issues`,
			);
			const listData = (await res1.json()) as { issues: Array<{ id: string; count: number }> };
			expect(listData.issues.length).toBe(2);

			const primary = listData.issues[0];
			const secondary = listData.issues[1];

			// Merge secondary into primary
			await authFetch(user2.token!, `http://localhost/api/projects/${project2.slug}/issues/merge`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					primaryIssueId: primary.id,
					issueIds: [primary.id, secondary.id],
				}),
			});

			// Send a new event matching the secondary's fingerprint
			await sendTestEvent(project2.id, project2.publicKey, {
				exception: { type: 'RedirectErrorB', value: 'redirect B' },
			});

			// Should still be only 1 issue (the primary), with count incremented
			const res2 = await authFetch(
				user2.token!,
				`http://localhost/api/projects/${project2.slug}/issues`,
			);
			const afterData = (await res2.json()) as { issues: Array<{ id: string; count: number }> };
			expect(afterData.issues.length).toBe(1);
			expect(afterData.issues[0].id).toBe(primary.id);
			expect(afterData.issues[0].count).toBeGreaterThan(primary.count);
		});

		it('should return 400 when fewer than 2 issueIds provided', async () => {
			const issues = await getIssues();
			if (issues.length === 0) return;

			const response = await authFetch(
				token,
				`http://localhost/api/projects/${projectSlug}/issues/merge`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						primaryIssueId: issues[0].id,
						issueIds: [issues[0].id],
					}),
				},
			);

			expect(response.status).toBe(400);
		});

		it('should return 400 when primaryIssueId is not in issueIds', async () => {
			const issues = await getIssues();
			if (issues.length < 2) return;

			const response = await authFetch(
				token,
				`http://localhost/api/projects/${projectSlug}/issues/merge`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						primaryIssueId: issues[0].id,
						issueIds: [issues[1].id, issues[0].id.replace(issues[0].id[0], 'x')],
					}),
				},
			);

			expect(response.status).toBe(400);
		});

		it('should return 404 for non-existent primary issue', async () => {
			const issues = await getIssues();
			if (issues.length === 0) return;

			const response = await authFetch(
				token,
				`http://localhost/api/projects/${projectSlug}/issues/merge`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						primaryIssueId: 'non-existent-id',
						issueIds: ['non-existent-id', issues[0].id],
					}),
				},
			);

			expect(response.status).toBe(404);
		});
	});
});
