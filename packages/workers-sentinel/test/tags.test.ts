import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser, sendTestEvent } from './utils';

describe('Tag-based Search and Filtering', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `tags-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Tags Test User',
		});
		testProject = await createTestProject(testUser.token!, { name: 'Tags Test Project' });

		// Send events with different tags to create multiple issues
		await sendTestEvent(testProject.id, testProject.publicKey, {
			exception: {
				type: 'TypeError',
				value: 'Cannot read property "foo" of undefined',
				stacktrace: {
					frames: [{ filename: 'app.js', function: 'handleClick', lineno: 42, in_app: true }],
				},
			},
			tags: { browser: 'Chrome', os: 'Windows', environment: 'production' },
		});

		await sendTestEvent(testProject.id, testProject.publicKey, {
			exception: {
				type: 'ReferenceError',
				value: 'x is not defined',
				stacktrace: {
					frames: [{ filename: 'index.js', function: 'init', lineno: 10, in_app: true }],
				},
			},
			tags: { browser: 'Firefox', os: 'macOS', environment: 'production' },
		});

		await sendTestEvent(testProject.id, testProject.publicKey, {
			exception: {
				type: 'SyntaxError',
				value: 'Unexpected token',
				stacktrace: {
					frames: [{ filename: 'parser.js', function: 'parse', lineno: 5, in_app: true }],
				},
			},
			tags: { browser: 'Chrome', os: 'Linux', environment: 'staging' },
		});
	});

	describe('GET /api/projects/:slug/tags', () => {
		it('should return tag facets with top values', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/tags`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				facets: Array<{
					key: string;
					issueCount: number;
					eventCount: number;
					topValues: Array<{
						value: string;
						issueCount: number;
						eventCount: number;
					}>;
				}>;
			};

			expect(data.facets).toBeDefined();
			expect(Array.isArray(data.facets)).toBe(true);
			expect(data.facets.length).toBeGreaterThanOrEqual(3);

			// Check that browser, os, and environment are in the facets
			const keys = data.facets.map((f) => f.key);
			expect(keys).toContain('browser');
			expect(keys).toContain('os');
			expect(keys).toContain('environment');

			// Check browser facet has top values
			const browserFacet = data.facets.find((f) => f.key === 'browser');
			expect(browserFacet).toBeDefined();
			expect(browserFacet!.topValues.length).toBeGreaterThanOrEqual(2);
			const browserValues = browserFacet!.topValues.map((v) => v.value);
			expect(browserValues).toContain('Chrome');
			expect(browserValues).toContain('Firefox');
		});

		it('should respect limit parameter', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/tags?limit=1`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				facets: Array<{ key: string }>;
			};

			expect(data.facets.length).toBe(1);
		});
	});

	describe('GET /api/projects/:slug/tags/:key/values', () => {
		it('should return values for a specific tag key', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/tags/browser/values`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				key: string;
				values: Array<{
					value: string;
					issueCount: number;
					eventCount: number;
				}>;
			};

			expect(data.key).toBe('browser');
			expect(data.values.length).toBeGreaterThanOrEqual(2);
			const values = data.values.map((v) => v.value);
			expect(values).toContain('Chrome');
			expect(values).toContain('Firefox');
		});

		it('should support query parameter for partial matching', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/tags/browser/values?query=Chr`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				values: Array<{ value: string }>;
			};

			expect(data.values.length).toBe(1);
			expect(data.values[0].value).toBe('Chrome');
		});
	});

	describe('GET /api/projects/:slug/issues with tag filter', () => {
		it('should filter issues by a single tag', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?tag=browser:Chrome`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issues: Array<{ id: string; title: string }>;
			};

			// Chrome was used in TypeError and SyntaxError events
			expect(data.issues.length).toBe(2);
		});

		it('should filter issues by multiple tags (AND logic)', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?tag=browser:Chrome&tag=environment:production`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issues: Array<{ id: string; title: string }>;
			};

			// Only TypeError event has both browser:Chrome AND environment:production
			expect(data.issues.length).toBe(1);
		});

		it('should return empty results for non-matching tag', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?tag=browser:Safari`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issues: Array<{ id: string }>;
			};

			expect(data.issues.length).toBe(0);
		});

		it('should combine tag filter with status filter', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/issues?status=unresolved&tag=browser:Chrome`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				issues: Array<{ id: string; status: string }>;
			};

			// All returned issues should be unresolved and have Chrome tag
			for (const issue of data.issues) {
				expect(issue.status).toBe('unresolved');
			}
			expect(data.issues.length).toBe(2);
		});
	});

	describe('Tag extraction during ingestion', () => {
		it('should not fail when event has no tags', async () => {
			const user = await createTestUser({
				email: `tags-no-tags-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'No Tags User',
			});
			const project = await createTestProject(user.token!, { name: 'No Tags Project' });

			await sendTestEvent(project.id, project.publicKey, {
				exception: { type: 'Error', value: 'No tags here' },
			});

			// Verify no tag facets exist
			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}/tags`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { facets: Array<unknown> };
			expect(data.facets.length).toBe(0);
		});
	});
});
