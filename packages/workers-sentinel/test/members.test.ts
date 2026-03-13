import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser } from './utils';

describe('Project Members', () => {
	let owner: Awaited<ReturnType<typeof createTestUser>>;
	let otherUser: Awaited<ReturnType<typeof createTestUser>>;
	let project: Awaited<ReturnType<typeof createTestProject>>;

	beforeAll(async () => {
		owner = await createTestUser({
			email: `members-owner-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Members Owner',
		});

		otherUser = await createTestUser({
			email: `members-other-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Other User',
		});

		project = await createTestProject(owner.token!, { name: 'Members Test Project' });
	});

	describe('GET /api/projects/:slug/members', () => {
		it('should list the creator as owner after project creation', async () => {
			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${project.slug}/members`,
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				members: Array<{ userId: string; role: string; email: string; name: string }>;
			};

			expect(data.members).toBeDefined();
			expect(data.members.length).toBe(1);
			expect(data.members[0].userId).toBe(owner.id);
			expect(data.members[0].role).toBe('owner');
			expect(data.members[0].email).toBe(owner.email);
			expect(data.members[0].name).toBe(owner.name);
		});

		it('should reject unauthenticated requests', async () => {
			const response = await SELF.fetch(`http://localhost/api/projects/${project.slug}/members`, {
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(401);
		});
	});

	describe('POST /api/projects/:slug/members', () => {
		it('should add a user by email', async () => {
			const newUser = await createTestUser({
				email: `add-member-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'New Member',
			});

			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${project.slug}/members`,
				{
					method: 'POST',
					body: JSON.stringify({ email: newUser.email, role: 'member' }),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				member: { userId: string; email: string; name: string; role: string };
			};

			expect(data.member).toBeDefined();
			expect(data.member.userId).toBe(newUser.id);
			expect(data.member.email).toBe(newUser.email);
			expect(data.member.role).toBe('member');
		});

		it('should return 404 for non-existent email', async () => {
			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${project.slug}/members`,
				{
					method: 'POST',
					body: JSON.stringify({
						email: 'nonexistent@example.com',
						role: 'member',
					}),
				},
			);

			expect(response.status).toBe(404);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('user_not_found');
		});

		it('should return 409 for duplicate member', async () => {
			const dupUser = await createTestUser({
				email: `dup-member-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Dup Member',
			});

			// Add first time
			await authFetch(owner.token!, `http://localhost/api/projects/${project.slug}/members`, {
				method: 'POST',
				body: JSON.stringify({ email: dupUser.email, role: 'member' }),
			});

			// Add second time
			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${project.slug}/members`,
				{
					method: 'POST',
					body: JSON.stringify({ email: dupUser.email, role: 'member' }),
				},
			);

			expect(response.status).toBe(409);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('already_member');
		});

		it('should reject owner role', async () => {
			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${project.slug}/members`,
				{
					method: 'POST',
					body: JSON.stringify({ email: otherUser.email, role: 'owner' }),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('invalid_role');
		});

		it('should reject requests from non-owner/non-admin members', async () => {
			// Create a project and add otherUser as a regular member
			const proj2 = await createTestProject(owner.token!, {
				name: 'RBAC Members Project',
			});

			await authFetch(owner.token!, `http://localhost/api/projects/${proj2.slug}/members`, {
				method: 'POST',
				body: JSON.stringify({ email: otherUser.email, role: 'member' }),
			});

			const thirdUser = await createTestUser({
				email: `third-user-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Third User',
			});

			// otherUser (member role) tries to add thirdUser
			const response = await authFetch(
				otherUser.token!,
				`http://localhost/api/projects/${proj2.slug}/members`,
				{
					method: 'POST',
					body: JSON.stringify({ email: thirdUser.email, role: 'member' }),
				},
			);

			expect(response.status).toBe(403);
		});
	});

	describe('DELETE /api/projects/:slug/members/:userId', () => {
		it('should remove a non-owner member', async () => {
			const removeUser = await createTestUser({
				email: `remove-member-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Remove Me',
			});

			const proj = await createTestProject(owner.token!, { name: 'Remove Member Project' });

			// Add member
			await authFetch(owner.token!, `http://localhost/api/projects/${proj.slug}/members`, {
				method: 'POST',
				body: JSON.stringify({ email: removeUser.email, role: 'member' }),
			});

			// Remove member
			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${proj.slug}/members/${removeUser.id}`,
				{ method: 'DELETE' },
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { success: boolean };
			expect(data.success).toBe(true);

			// Verify removed
			const listResponse = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${proj.slug}/members`,
			);
			const listData = (await listResponse.json()) as {
				members: Array<{ userId: string }>;
			};
			const found = listData.members.find((m) => m.userId === removeUser.id);
			expect(found).toBeUndefined();
		});

		it('should return 400 when trying to remove the owner', async () => {
			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${project.slug}/members/${owner.id}`,
				{ method: 'DELETE' },
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('cannot_remove_owner');
		});
	});

	describe('PATCH /api/projects/:slug/members/:userId', () => {
		it('should change role from member to admin', async () => {
			const patchUser = await createTestUser({
				email: `patch-member-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Patch Me',
			});

			const proj = await createTestProject(owner.token!, { name: 'Patch Member Project' });

			await authFetch(owner.token!, `http://localhost/api/projects/${proj.slug}/members`, {
				method: 'POST',
				body: JSON.stringify({ email: patchUser.email, role: 'member' }),
			});

			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${proj.slug}/members/${patchUser.id}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ role: 'admin' }),
				},
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				member: { userId: string; role: string };
			};
			expect(data.member.role).toBe('admin');
		});

		it('should reject changing the owner role', async () => {
			const response = await authFetch(
				owner.token!,
				`http://localhost/api/projects/${project.slug}/members/${owner.id}`,
				{
					method: 'PATCH',
					body: JSON.stringify({ role: 'member' }),
				},
			);

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('cannot_modify_owner');
		});
	});

	describe('Member access', () => {
		it('should allow added member to see the project', async () => {
			const memberUser = await createTestUser({
				email: `access-member-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Access Member',
			});

			const proj = await createTestProject(owner.token!, { name: 'Access Test Project' });

			// Before adding: member cannot see the project
			const beforeResponse = await authFetch(
				memberUser.token!,
				`http://localhost/api/projects/${proj.slug}`,
			);
			expect(beforeResponse.status).toBe(404);

			// Add member
			await authFetch(owner.token!, `http://localhost/api/projects/${proj.slug}/members`, {
				method: 'POST',
				body: JSON.stringify({ email: memberUser.email, role: 'member' }),
			});

			// After adding: member can see the project
			const afterResponse = await authFetch(
				memberUser.token!,
				`http://localhost/api/projects/${proj.slug}`,
			);
			expect(afterResponse.status).toBe(200);
		});
	});
});
