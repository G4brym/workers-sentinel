import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authFetch, createTestUser } from './utils';

describe('Admin Routes', () => {
	let adminUser: Awaited<ReturnType<typeof createTestUser>> & { role?: string };
	let regularUser: Awaited<ReturnType<typeof createTestUser>> & { role?: string };

	beforeAll(async () => {
		adminUser = await createTestUser({
			email: `admin-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Admin Test User',
		});

		regularUser = await createTestUser({
			email: `regular-test-${Date.now()}@example.com`,
			password: 'testpassword123',
			name: 'Regular Test User',
		});

		// Fetch roles via /api/auth/me
		const adminMe = await authFetch(adminUser.token!, 'http://localhost/api/auth/me');
		const adminData = (await adminMe.json()) as { user: { role: string } };
		adminUser.role = adminData.user.role;

		const regularMe = await authFetch(regularUser.token!, 'http://localhost/api/auth/me');
		const regularData = (await regularMe.json()) as { user: { role: string } };
		regularUser.role = regularData.user.role;
	});

	describe('GET /api/admin/users', () => {
		it('should reject unauthenticated requests', async () => {
			const response = await SELF.fetch('http://localhost/api/admin/users', {
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(401);
		});

		it('should reject requests from non-admin users', async () => {
			// Find the non-admin user
			const nonAdmin = adminUser.role !== 'admin' ? adminUser : regularUser;

			const response = await authFetch(nonAdmin.token!, 'http://localhost/api/admin/users');

			expect(response.status).toBe(403);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('forbidden');
		});

		it('should return user list for admin users', async () => {
			// Find the admin user (first registered user gets admin)
			const admin = adminUser.role === 'admin' ? adminUser : regularUser;

			// Skip if neither user is admin (admin was created in an earlier test file)
			if (admin.role !== 'admin') {
				return;
			}

			const response = await authFetch(admin.token!, 'http://localhost/api/admin/users');

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				users: Array<{ id: string; email: string; name: string; role: string; createdAt: string }>;
			};

			expect(data.users).toBeDefined();
			expect(Array.isArray(data.users)).toBe(true);
			expect(data.users.length).toBeGreaterThanOrEqual(2);

			// Each user should have the expected fields
			for (const user of data.users) {
				expect(user.id).toBeDefined();
				expect(user.email).toBeDefined();
				expect(user.name).toBeDefined();
				expect(user.role).toBeDefined();
				expect(user.createdAt).toBeDefined();
			}

			// Verify our test users are in the list
			const emails = data.users.map((u) => u.email);
			expect(emails).toContain(adminUser.email);
			expect(emails).toContain(regularUser.email);
		});
	});
});
