import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Release Tracking', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `release-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Release Test User',
		});
		testProject = await createTestProject(testUser.token!, { name: 'Release Test Project' });
	});

	describe('Release creation during ingestion', () => {
		it('should create a release when event has release field', async () => {
			const user = await createTestUser({
				email: `release-create-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Release Create Test',
			});
			const project = await createTestProject(user.token!, { name: 'Release Create Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'test release creation' },
				release: 'app@1.0.0',
			});

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/releases`,
			);
			const data = (await response.json()) as {
				releases: Array<{ version: string; eventCount: number; issueCount: number }>;
			};

			expect(response.status).toBe(200);
			expect(data.releases.length).toBe(1);
			expect(data.releases[0].version).toBe('app@1.0.0');
			expect(data.releases[0].eventCount).toBe(1);
			expect(data.releases[0].issueCount).toBe(1);
		});

		it('should increment event_count for multiple events in same release', async () => {
			const user = await createTestUser({
				email: `release-multi-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Release Multi Test',
			});
			const project = await createTestProject(user.token!, { name: 'Release Multi Project' });

			const errorConfig = {
				exception: {
					type: 'TypeError',
					value: 'same error for counting',
					stacktrace: {
						frames: [
							{ filename: 'app.js', function: 'handler', lineno: 10, in_app: true as const },
						],
					},
				},
				release: 'app@2.0.0',
			};

			await sendTestEvent(project.id, project.publicKey, errorConfig);
			await sendTestEvent(project.id, project.publicKey, errorConfig);
			await sendTestEvent(project.id, project.publicKey, errorConfig);

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/releases`,
			);
			const data = (await response.json()) as {
				releases: Array<{ version: string; eventCount: number; issueCount: number }>;
			};

			expect(data.releases.length).toBe(1);
			expect(data.releases[0].eventCount).toBe(3);
			expect(data.releases[0].issueCount).toBe(1);
		});

		it('should track multiple releases ordered by last_seen DESC', async () => {
			const user = await createTestUser({
				email: `release-order-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Release Order Test',
			});
			const project = await createTestProject(user.token!, { name: 'Release Order Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'old release error' },
				release: 'app@1.0.0',
			});

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'new release error' },
				release: 'app@1.1.0',
			});

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/releases`,
			);
			const data = (await response.json()) as {
				releases: Array<{ version: string }>;
			};

			expect(data.releases.length).toBe(2);
			// Most recent release should be first
			expect(data.releases[0].version).toBe('app@1.1.0');
			expect(data.releases[1].version).toBe('app@1.0.0');
		});
	});

	describe('Release detail with issues', () => {
		it('should return issues associated with a release', async () => {
			const user = await createTestUser({
				email: `release-detail-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Release Detail Test',
			});
			const project = await createTestProject(user.token!, { name: 'Release Detail Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'TypeError',
					value: 'first error in release',
					stacktrace: {
						frames: [{ filename: 'a.js', function: 'fn1', lineno: 1, in_app: true as const }],
					},
				},
				release: 'app@3.0.0',
			});

			await sendTestEvent(project.id, project.publicKey, {
				exception: {
					type: 'RangeError',
					value: 'second error in release',
					stacktrace: {
						frames: [{ filename: 'b.js', function: 'fn2', lineno: 2, in_app: true as const }],
					},
				},
				release: 'app@3.0.0',
			});

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/releases/${encodeURIComponent('app@3.0.0')}`,
			);
			const data = (await response.json()) as {
				release: { version: string; issueCount: number };
				issues: Array<{ title: string; releaseEventCount: number }>;
			};

			expect(response.status).toBe(200);
			expect(data.release.version).toBe('app@3.0.0');
			expect(data.release.issueCount).toBe(2);
			expect(data.issues.length).toBe(2);
		});
	});

	describe('New issue count tracking', () => {
		it('should track new_issue_count correctly across releases', async () => {
			const user = await createTestUser({
				email: `release-new-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Release New Test',
			});
			const project = await createTestProject(user.token!, { name: 'Release New Project' });

			const errorConfig = {
				exception: {
					type: 'Error',
					value: 'same error across releases',
					stacktrace: {
						frames: [
							{ filename: 'app.js', function: 'handler', lineno: 42, in_app: true as const },
						],
					},
				},
			};

			// First release introduces the error (new issue)
			await sendTestEvent(project.id, project.publicKey, {
				...errorConfig,
				release: 'app@4.0.0',
			});

			// Second release sees the same error (not a new issue)
			await sendTestEvent(project.id, project.publicKey, {
				...errorConfig,
				release: 'app@4.1.0',
			});

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/releases`,
			);
			const data = (await response.json()) as {
				releases: Array<{ version: string; newIssueCount: number }>;
			};

			const v400 = data.releases.find((r) => r.version === 'app@4.0.0');
			const v410 = data.releases.find((r) => r.version === 'app@4.1.0');

			expect(v400?.newIssueCount).toBe(1);
			expect(v410?.newIssueCount).toBe(0);
		});
	});

	describe('Regression detection', () => {
		it('should reopen resolved issues when they appear in new events with release', async () => {
			const user = await createTestUser({
				email: `release-regress-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Regression Test',
			});
			const project = await createTestProject(user.token!, { name: 'Regression Test Project' });

			const errorConfig = {
				exception: {
					type: 'Error',
					value: 'regression error test',
					stacktrace: {
						frames: [
							{ filename: 'app.js', function: 'regress', lineno: 99, in_app: true as const },
						],
					},
				},
			};

			// Send initial error
			await sendTestEvent(project.id, project.publicKey, {
				...errorConfig,
				release: 'app@5.0.0',
			});

			// Get the issue and resolve it
			const issuesResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ id: string; status: string }>;
			};
			const issueId = issuesData.issues[0].id;

			await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ status: 'resolved' }),
				},
			);

			// Verify it's resolved
			const resolvedResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
			);
			const resolvedData = (await resolvedResponse.json()) as {
				issue: { status: string };
			};
			expect(resolvedData.issue.status).toBe('resolved');

			// Send same error again with a new release (triggers regression)
			await sendTestEvent(project.id, project.publicKey, {
				...errorConfig,
				release: 'app@5.1.0',
			});

			// Verify the issue was reopened
			const reopenedResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/issues/${issueId}`,
			);
			const reopenedData = (await reopenedResponse.json()) as {
				issue: { status: string };
			};
			expect(reopenedData.issue.status).toBe('unresolved');
		});
	});

	describe('Events without release', () => {
		it('should not create release records for events without release field', async () => {
			const user = await createTestUser({
				email: `release-none-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'No Release Test',
			});
			const project = await createTestProject(user.token!, { name: 'No Release Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'no release field' },
			});

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/releases`,
			);
			const data = (await response.json()) as {
				releases: Array<{ version: string }>;
			};

			expect(data.releases.length).toBe(0);
		});
	});

	describe('URL-encoded release versions', () => {
		it('should handle release versions with special characters', async () => {
			const user = await createTestUser({
				email: `release-encode-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'URL Encode Test',
			});
			const project = await createTestProject(user.token!, { name: 'URL Encode Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'encoded release error' },
				release: 'my-app@1.0.0+build.123',
			});

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/releases/${encodeURIComponent('my-app@1.0.0+build.123')}`,
			);
			const data = (await response.json()) as {
				release: { version: string };
			};

			expect(response.status).toBe(200);
			expect(data.release.version).toBe('my-app@1.0.0+build.123');
		});
	});
});
