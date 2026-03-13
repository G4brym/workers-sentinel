import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	authFetch,
	createTestProject,
	createTestUser,
	sendTestEvent,
} from './utils';

describe('Retention & Alarm Cleanup', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `retention-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Retention Test User',
		});
	});

	describe('alarm() handler', () => {
		it('should not delete recent events when retention is set', async () => {
			const project = await createTestProject(testUser.token!, {
				name: `Alarm Recent ${Date.now()}`,
			});

			// Ingest some events
			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'Retention test error 1' },
				user: { id: 'user-1', email: 'user1@example.com' },
			});
			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'Retention test error 1' },
				user: { id: 'user-2', email: 'user2@example.com' },
			});

			// Set retention to 90 days
			const patchResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ retentionDays: 90 }),
				},
			);
			expect(patchResponse.status).toBe(200);

			// Trigger alarm via test helper
			const stub = env.PROJECT_STATE.get(
				env.PROJECT_STATE.idFromName(project.id),
			);
			const ran = await runDurableObjectAlarm(stub);
			expect(ran).toBe(true);

			// Verify events still exist (they are recent, well within 90-day retention)
			const issuesResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			expect(issuesResponse.status).toBe(200);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ count: number; userCount: number }>;
			};
			expect(issuesData.issues.length).toBeGreaterThan(0);
			expect(issuesData.issues[0].count).toBeGreaterThanOrEqual(2);
		});

		it('should skip cleanup when retention is disabled (0)', async () => {
			const project = await createTestProject(testUser.token!, {
				name: `Alarm Disabled ${Date.now()}`,
			});

			// Ingest an event
			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'No retention test' },
			});

			// Set retention to 0 (keep forever)
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ retentionDays: 0 }),
				},
			);

			// Trigger alarm — should be a no-op since retention is disabled
			const stub = env.PROJECT_STATE.get(
				env.PROJECT_STATE.idFromName(project.id),
			);
			const ran = await runDurableObjectAlarm(stub);
			// Alarm may not be scheduled since retention is 0, so ran could be false
			// Either way, events should still exist

			// Verify events still exist
			const issuesResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<{ count: number }>;
			};
			expect(issuesData.issues.length).toBeGreaterThan(0);
		});

		it('should handle alarm on project with no events', async () => {
			const project = await createTestProject(testUser.token!, {
				name: `Alarm Empty ${Date.now()}`,
			});

			// Set retention to 30 days (schedules alarm)
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ retentionDays: 30 }),
				},
			);

			// Trigger alarm — should run without error on empty project
			const stub = env.PROJECT_STATE.get(
				env.PROJECT_STATE.idFromName(project.id),
			);
			const ran = await runDurableObjectAlarm(stub);
			expect(ran).toBe(true);

			// Verify project is still accessible
			const issuesResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}/issues`,
			);
			expect(issuesResponse.status).toBe(200);
			const issuesData = (await issuesResponse.json()) as {
				issues: Array<unknown>;
			};
			expect(issuesData.issues.length).toBe(0);
		});

		it('should reschedule alarm after cleanup', async () => {
			const project = await createTestProject(testUser.token!, {
				name: `Alarm Reschedule ${Date.now()}`,
			});

			// Set retention to 7 days
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ retentionDays: 7 }),
				},
			);

			const stub = env.PROJECT_STATE.get(
				env.PROJECT_STATE.idFromName(project.id),
			);

			// Trigger alarm
			const ran = await runDurableObjectAlarm(stub);
			expect(ran).toBe(true);

			// Triggering alarm again should work (it was rescheduled)
			const ranAgain = await runDurableObjectAlarm(stub);
			expect(ranAgain).toBe(true);
		});
	});

	describe('validation', () => {
		it('should reject non-integer retention values', async () => {
			const project = await createTestProject(testUser.token!, {
				name: `Validation Float ${Date.now()}`,
			});

			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ retentionDays: 3.5 }),
				},
			);
			expect(response.status).toBe(400);
		});

		it('should reject Infinity retention value', async () => {
			const project = await createTestProject(testUser.token!, {
				name: `Validation Infinity ${Date.now()}`,
			});

			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${project.slug}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ retentionDays: Infinity }),
				},
			);
			// Infinity is not serializable in JSON, so this becomes null
			expect(response.status).toBe(400);
		});
	});
});
