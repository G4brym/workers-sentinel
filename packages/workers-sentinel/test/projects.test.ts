import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser } from './utils';

describe('Project Routes', () => {
	let testUser: Awaited<ReturnType<typeof createTestUser>>;

	beforeAll(async () => {
		testUser = await createTestUser({
			email: `project-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Project Test User',
		});
	});

	describe('POST /api/projects', () => {
		it('should create a new project', async () => {
			const response = await authFetch(testUser.token!, 'http://localhost/api/projects', {
				method: 'POST',
				body: JSON.stringify({
					name: 'Test Project',
					platform: 'javascript',
				}),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				project: { id: string; name: string; slug: string; platform: string; publicKey: string };
				dsn: string;
			};

			expect(data.project).toBeDefined();
			expect(data.project.name).toBe('Test Project');
			expect(data.project.slug).toBe('test-project');
			expect(data.project.platform).toBe('javascript');
			expect(data.project.publicKey).toBeDefined();
			expect(data.dsn).toBeDefined();
			expect(data.dsn).toContain(data.project.publicKey);
		});

		it('should create project with unique slug', async () => {
			// Create first project
			await authFetch(testUser.token!, 'http://localhost/api/projects', {
				method: 'POST',
				body: JSON.stringify({ name: 'Duplicate Name', platform: 'javascript' }),
			});

			// Create second project with same name
			const response = await authFetch(testUser.token!, 'http://localhost/api/projects', {
				method: 'POST',
				body: JSON.stringify({ name: 'Duplicate Name', platform: 'javascript' }),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as { project: { slug: string } };

			// Should have different slug (e.g., duplicate-name-1)
			expect(data.project.slug).toMatch(/duplicate-name-\d+/);
		});

		it('should reject project creation without name', async () => {
			const response = await authFetch(testUser.token!, 'http://localhost/api/projects', {
				method: 'POST',
				body: JSON.stringify({ platform: 'javascript' }),
			});

			expect(response.status).toBe(400);
		});

		it('should reject unauthenticated requests', async () => {
			const response = await SELF.fetch('http://localhost/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Test Project' }),
			});

			expect(response.status).toBe(401);
		});
	});

	describe('GET /api/projects', () => {
		it('should list user projects', async () => {
			const user = await createTestUser({
				email: `list-projects-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'List Projects User',
			});

			// Create some projects
			await createTestProject(user.token!, { name: 'Project A' });
			await createTestProject(user.token!, { name: 'Project B' });

			const response = await authFetch(user.token!, 'http://localhost/api/projects');

			expect(response.status).toBe(200);
			const data = (await response.json()) as { projects: Array<{ name: string }> };

			expect(data.projects).toBeDefined();
			expect(Array.isArray(data.projects)).toBe(true);
			expect(data.projects.length).toBeGreaterThanOrEqual(2);

			const names = data.projects.map((p) => p.name);
			expect(names).toContain('Project A');
			expect(names).toContain('Project B');
		});

		it('should return empty array for user with no projects', async () => {
			const user = await createTestUser({
				email: `no-projects-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'No Projects User',
			});

			const response = await authFetch(user.token!, 'http://localhost/api/projects');

			expect(response.status).toBe(200);
			const data = (await response.json()) as { projects: Array<unknown> };

			expect(data.projects).toBeDefined();
			expect(data.projects.length).toBe(0);
		});
	});

	describe('GET /api/projects/:slug', () => {
		it('should get project by slug', async () => {
			const user = await createTestUser({
				email: `get-project-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Get Project User',
			});

			const project = await createTestProject(user.token!, { name: 'Get Me Project' });

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				project: { id: string; name: string };
				dsn: string;
			};

			expect(data.project).toBeDefined();
			expect(data.project.id).toBe(project.id);
			expect(data.project.name).toBe('Get Me Project');
			expect(data.dsn).toBeDefined();
		});

		it('should return 404 for non-existent project', async () => {
			const response = await authFetch(
				testUser.token!,
				'http://localhost/api/projects/non-existent-slug',
			);

			expect(response.status).toBe(404);
		});

		it('should not allow access to other users projects', async () => {
			const user1 = await createTestUser({
				email: `user1-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'User 1',
			});

			const user2 = await createTestUser({
				email: `user2-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'User 2',
			});

			const project = await createTestProject(user1.token!, { name: 'User 1 Project' });

			// User 2 tries to access User 1's project
			const response = await authFetch(
				user2.token!,
				`http://localhost/api/projects/${project.slug}`,
			);

			expect(response.status).toBe(404);
		});
	});

	describe('DELETE /api/projects/:slug', () => {
		it('should delete project as owner', async () => {
			const user = await createTestUser({
				email: `delete-project-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Delete Project User',
			});

			const project = await createTestProject(user.token!, { name: 'Delete Me Project' });

			const response = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}`,
				{
					method: 'DELETE',
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { success: boolean };
			expect(data.success).toBe(true);

			// Verify project is deleted
			const getResponse = await authFetch(
				user.token!,
				`http://localhost/api/projects/${project.slug}`,
			);
			expect(getResponse.status).toBe(404);
		});

		it('should return 404 for non-existent project', async () => {
			const response = await authFetch(
				testUser.token!,
				'http://localhost/api/projects/non-existent-slug',
				{
					method: 'DELETE',
				},
			);

			expect(response.status).toBe(404);
		});
	});
});
