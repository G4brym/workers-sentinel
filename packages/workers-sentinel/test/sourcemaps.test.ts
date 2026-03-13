import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser } from './utils';

const VALID_SOURCE_MAP = JSON.stringify({
	version: 3,
	sources: ['src/app.ts'],
	names: ['handleClick', 'console', 'log'],
	mappings: 'AAAA,SAASA,aACPC,QAAQC,IAAI',
	file: 'main.js',
});

describe('Source Maps', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;
	let testProject: Awaited<ReturnType<typeof createTestProject>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `sourcemaps-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Source Maps Test User',
		});
		testProject = await createTestProject(testUser.token!, {
			name: 'Source Maps Test Project',
		});
	});

	describe('POST /api/projects/:slug/sourcemaps', () => {
		it('should upload a valid source map', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
				{
					method: 'POST',
					body: JSON.stringify({
						release: 'app@1.0.0',
						fileUrl: 'https://example.com/assets/main.js',
						content: VALID_SOURCE_MAP,
					}),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				sourceMap: { id: string; release: string; fileUrl: string; size: number };
			};
			expect(data.sourceMap).toBeDefined();
			expect(data.sourceMap.release).toBe('app@1.0.0');
			expect(data.sourceMap.fileUrl).toBe('https://example.com/assets/main.js');
			expect(data.sourceMap.size).toBeGreaterThan(0);
		});

		it('should replace existing source map for same release+fileUrl', async () => {
			const updatedMap = JSON.stringify({
				version: 3,
				sources: ['updated.ts'],
				names: [],
				mappings: '',
			});

			// Upload first
			await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
				{
					method: 'POST',
					body: JSON.stringify({
						release: 'app@2.0.0',
						fileUrl: 'https://example.com/assets/bundle.js',
						content: VALID_SOURCE_MAP,
					}),
				},
			);

			// Upload replacement
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
				{
					method: 'POST',
					body: JSON.stringify({
						release: 'app@2.0.0',
						fileUrl: 'https://example.com/assets/bundle.js',
						content: updatedMap,
					}),
				},
			);

			expect(response.status).toBe(200);

			// List and verify only one entry for this release+fileUrl
			const listResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps?release=app@2.0.0`,
			);
			const listData = (await listResponse.json()) as {
				sourceMaps: Array<{ fileUrl: string }>;
			};
			const matching = listData.sourceMaps.filter(
				(sm) => sm.fileUrl === 'https://example.com/assets/bundle.js',
			);
			expect(matching.length).toBe(1);
		});

		it('should reject empty release', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
				{
					method: 'POST',
					body: JSON.stringify({
						release: '',
						fileUrl: 'https://example.com/main.js',
						content: VALID_SOURCE_MAP,
					}),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('invalid_release');
		});

		it('should reject invalid JSON content', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
				{
					method: 'POST',
					body: JSON.stringify({
						release: 'app@1.0.0',
						fileUrl: 'https://example.com/main.js',
						content: 'not valid json {{{',
					}),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('invalid_source_map_json');
		});

		it('should reject oversized content', async () => {
			const largeContent = JSON.stringify({ data: 'x'.repeat(5_300_000) });

			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
				{
					method: 'POST',
					body: JSON.stringify({
						release: 'app@1.0.0',
						fileUrl: 'https://example.com/main.js',
						content: largeContent,
					}),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('content_too_large');
		});
	});

	describe('GET /api/projects/:slug/sourcemaps', () => {
		it('should list source maps', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				sourceMaps: Array<{ id: string; release: string; fileUrl: string }>;
			};
			expect(data.sourceMaps).toBeDefined();
			expect(Array.isArray(data.sourceMaps)).toBe(true);
			expect(data.sourceMaps.length).toBeGreaterThanOrEqual(1);
		});

		it('should filter source maps by release', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps?release=app@1.0.0`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				sourceMaps: Array<{ release: string }>;
			};
			for (const sm of data.sourceMaps) {
				expect(sm.release).toBe('app@1.0.0');
			}
		});
	});

	describe('GET /api/projects/:slug/sourcemaps/resolve', () => {
		it('should get source map content by release and fileUrl', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps/resolve?release=${encodeURIComponent('app@1.0.0')}&fileUrl=${encodeURIComponent('https://example.com/assets/main.js')}`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				sourceMap: { id: string; release: string; fileUrl: string };
				content: string;
			};
			expect(data.sourceMap).toBeDefined();
			expect(data.content).toBeDefined();
			expect(JSON.parse(data.content).version).toBe(3);
		});

		it('should return 404 for non-existent source map', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps/resolve?release=nonexistent@0.0.0&fileUrl=nope.js`,
			);

			expect(response.status).toBe(404);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('source_map_not_found');
		});

		it('should return 400 when missing parameters', async () => {
			const response = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps/resolve`,
			);

			expect(response.status).toBe(400);
		});
	});

	describe('DELETE /api/projects/:slug/sourcemaps/:id', () => {
		it('should delete a source map', async () => {
			// Upload one to delete
			const uploadResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
				{
					method: 'POST',
					body: JSON.stringify({
						release: 'app@delete-test',
						fileUrl: 'https://example.com/delete-me.js',
						content: VALID_SOURCE_MAP,
					}),
				},
			);

			const uploadData = (await uploadResponse.json()) as {
				sourceMap: { id: string };
			};

			// Delete it
			const deleteResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps/${uploadData.sourceMap.id}`,
				{ method: 'DELETE' },
			);

			expect(deleteResponse.status).toBe(200);
			const deleteData = (await deleteResponse.json()) as { success: boolean };
			expect(deleteData.success).toBe(true);

			// Verify it's gone
			const resolveResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps/resolve?release=app@delete-test&fileUrl=${encodeURIComponent('https://example.com/delete-me.js')}`,
			);
			expect(resolveResponse.status).toBe(404);
		});
	});

	describe('Source map with special characters in release', () => {
		it('should handle release with special characters', async () => {
			const release = 'my-app@1.0.0+build.123';

			const uploadResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
				{
					method: 'POST',
					body: JSON.stringify({
						release,
						fileUrl: 'https://example.com/special.js',
						content: VALID_SOURCE_MAP,
					}),
				},
			);

			expect(uploadResponse.status).toBe(200);

			// Verify it can be listed
			const listResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps?release=${encodeURIComponent(release)}`,
			);
			const listData = (await listResponse.json()) as {
				sourceMaps: Array<{ release: string }>;
			};
			expect(listData.sourceMaps.length).toBeGreaterThanOrEqual(1);
			expect(listData.sourceMaps[0].release).toBe(release);

			// Verify it can be resolved
			const resolveResponse = await authFetch(
				testUser.token!,
				`http://localhost/api/projects/${testProject.slug}/sourcemaps/resolve?release=${encodeURIComponent(release)}&fileUrl=${encodeURIComponent('https://example.com/special.js')}`,
			);
			expect(resolveResponse.status).toBe(200);
		});
	});

	describe('Authentication', () => {
		it('should reject unauthenticated requests', async () => {
			const response = await SELF.fetch(
				`http://localhost/api/projects/${testProject.slug}/sourcemaps`,
			);

			expect(response.status).toBe(401);
		});
	});
});
