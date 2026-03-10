import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Rate Limiting', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `rate-limit-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Rate Limit Test User',
		});
		testProject = await createTestProject(testUser.token!, {
			name: `Rate Limit Test Project ${Date.now()}`,
		});
	});

	describe('Config CRUD', () => {
		it('should default to unlimited (0) rate limit', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/rate-limit`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				maxEventsPerHour: number;
				currentHourCount: number;
				isLimited: boolean;
			};
			expect(data.maxEventsPerHour).toBe(0);
			expect(data.isLimited).toBe(false);
		});

		it('should set maxEventsPerHour via PATCH /api/projects/:slug', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ maxEventsPerHour: 1000 }),
				},
			);

			expect(response.status).toBe(200);

			// Verify via rate-limit status
			const statusResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/rate-limit`,
			);
			const data = (await statusResponse.json()) as { maxEventsPerHour: number };
			expect(data.maxEventsPerHour).toBe(1000);
		});

		it('should reject negative maxEventsPerHour', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ maxEventsPerHour: -1 }),
				},
			);

			expect(response.status).toBe(400);
		});

		it('should require authentication for rate-limit endpoint', async () => {
			const response = await SELF.fetch(
				`http://localhost/api/projects/${testProject.slug}/rate-limit`,
			);
			expect(response.status).toBe(401);
		});
	});

	describe('Rate limit enforcement', () => {
		let limitedProject: Awaited<ReturnType<typeof createTestProject>>;

		beforeAll(async () => {
			limitedProject = await createTestProject(testUser.token!, {
				name: `Limited Project ${Date.now()}`,
			});

			// Set a low limit
			await authFetch(testUser.token!, `http://localhost/api/projects/${limitedProject.slug}`, {
				method: 'PATCH',
				body: JSON.stringify({ maxEventsPerHour: 3 }),
			});
		});

		it('should allow events within the limit', async () => {
			// Send 3 events (the limit)
			for (let i = 0; i < 3; i++) {
				const result = await sendTestEvent(limitedProject.id, limitedProject.publicKey, {
					exception: {
						type: 'RateLimitTestError',
						value: `Error ${i} - ${Date.now()}`,
						stacktrace: {
							frames: [
								{
									filename: `rate-limit-test-${i}.js`,
									function: `testFunc${i}`,
									lineno: i + 1,
									in_app: true,
								},
							],
						},
					},
				});
				expect(result.id).toBeTruthy();
			}
		});

		it('should return 429 when rate limit is exceeded', async () => {
			// The 4th event should be rate limited
			const envelope = `{"event_id":"${crypto.randomUUID().replace(/-/g, '')}","dsn":"https://${limitedProject.publicKey}@localhost/${limitedProject.id}","sdk":{"name":"sentry.javascript.browser","version":"7.0.0"},"sent_at":"${new Date().toISOString()}"}
{"type":"event"}
{"event_id":"${crypto.randomUUID().replace(/-/g, '')}","timestamp":"${new Date().toISOString()}","platform":"javascript","level":"error","exception":{"values":[{"type":"OverLimitError","value":"This should be rejected","stacktrace":{"frames":[{"filename":"overlimit.js","function":"boom","lineno":1,"in_app":true}]}}]}}`;

			const response = await SELF.fetch(`http://localhost/api/${limitedProject.id}/envelope/`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-sentry-envelope',
					'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${limitedProject.publicKey}`,
				},
				body: envelope,
			});

			expect(response.status).toBe(429);
			expect(response.headers.get('Retry-After')).toBeTruthy();
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('rate_limited');
		});

		it('should show rate limited status', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${limitedProject.slug}/rate-limit`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				maxEventsPerHour: number;
				currentHourCount: number;
				isLimited: boolean;
			};
			expect(data.maxEventsPerHour).toBe(3);
			expect(data.currentHourCount).toBeGreaterThanOrEqual(3);
			expect(data.isLimited).toBe(true);
		});
	});

	describe('Unlimited mode', () => {
		let unlimitedProject: Awaited<ReturnType<typeof createTestProject>>;

		beforeAll(async () => {
			unlimitedProject = await createTestProject(testUser.token!, {
				name: `Unlimited Project ${Date.now()}`,
			});
		});

		it('should allow unlimited events when maxEventsPerHour is 0 (default)', async () => {
			// Send several events — all should succeed
			for (let i = 0; i < 5; i++) {
				const result = await sendTestEvent(unlimitedProject.id, unlimitedProject.publicKey, {
					exception: {
						type: 'UnlimitedTestError',
						value: `Unlimited error ${i} - ${Date.now()}`,
						stacktrace: {
							frames: [
								{
									filename: `unlimited-test-${i}.js`,
									function: `unlimitedFunc${i}`,
									lineno: i + 1,
									in_app: true,
								},
							],
						},
					},
				});
				expect(result.id).toBeTruthy();
			}
		});

		it('should allow unlimited events after setting maxEventsPerHour to 0', async () => {
			// Set a limit first, then remove it
			await authFetch(testUser.token!, `http://localhost/api/projects/${unlimitedProject.slug}`, {
				method: 'PATCH',
				body: JSON.stringify({ maxEventsPerHour: 1000 }),
			});

			// Remove the limit
			await authFetch(testUser.token!, `http://localhost/api/projects/${unlimitedProject.slug}`, {
				method: 'PATCH',
				body: JSON.stringify({ maxEventsPerHour: 0 }),
			});

			// Verify it's unlimited
			const statusResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${unlimitedProject.slug}/rate-limit`,
			);
			const data = (await statusResponse.json()) as {
				maxEventsPerHour: number;
				isLimited: boolean;
			};
			expect(data.maxEventsPerHour).toBe(0);
			expect(data.isLimited).toBe(false);
		});
	});
});
