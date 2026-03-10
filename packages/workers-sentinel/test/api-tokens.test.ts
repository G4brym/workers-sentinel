import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { authFetch, createTestProject, createTestUser } from './utils';

describe('API Token Routes', () => {
	describe('POST /api/auth/tokens', () => {
		it('should create an API token', async () => {
			const user = await createTestUser({
				email: `token-create-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token Test User',
			});

			const response = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({ name: 'CI Token' }),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				token: { id: string; name: string; tokenPrefix: string };
				rawToken: string;
			};
			expect(data.rawToken).toBeDefined();
			expect(data.rawToken.startsWith('wst_')).toBe(true);
			expect(data.token.name).toBe('CI Token');
			expect(data.token.tokenPrefix).toBe(data.rawToken.slice(0, 12));
		});

		it('should reject creation without name', async () => {
			const user = await createTestUser({
				email: `token-noname-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token Test User',
			});

			const response = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({}),
			});

			expect(response.status).toBe(400);
		});
	});

	describe('GET /api/auth/tokens', () => {
		it('should list user tokens', async () => {
			const user = await createTestUser({
				email: `token-list-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token List User',
			});

			// Create 3 tokens
			for (let i = 0; i < 3; i++) {
				await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
					method: 'POST',
					body: JSON.stringify({ name: `Token ${i}` }),
				});
			}

			const response = await authFetch(user.token!, 'http://localhost/api/auth/tokens');

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				tokens: Array<{ id: string; name: string; tokenPrefix: string }>;
			};
			expect(data.tokens.length).toBe(3);
			// Should never expose raw tokens or hashes
			for (const token of data.tokens) {
				expect(token.tokenPrefix).toBeDefined();
				expect((token as Record<string, unknown>).token_hash).toBeUndefined();
			}
		});
	});

	describe('DELETE /api/auth/tokens/:tokenId', () => {
		it('should revoke a token', async () => {
			const user = await createTestUser({
				email: `token-revoke-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token Revoke User',
			});

			// Create a token
			const createResponse = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({ name: 'To Revoke' }),
			});
			const createData = (await createResponse.json()) as {
				token: { id: string };
			};

			// Revoke it
			const revokeResponse = await authFetch(
				user.token!,
				`http://localhost/api/auth/tokens/${createData.token.id}`,
				{ method: 'DELETE' },
			);
			expect(revokeResponse.status).toBe(200);

			// Verify it's gone
			const listResponse = await authFetch(user.token!, 'http://localhost/api/auth/tokens');
			const listData = (await listResponse.json()) as {
				tokens: Array<{ id: string }>;
			};
			expect(listData.tokens.length).toBe(0);
		});

		it('should not revoke another user token', async () => {
			const userA = await createTestUser({
				email: `token-revokeA-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'User A',
			});
			const userB = await createTestUser({
				email: `token-revokeB-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'User B',
			});

			// User A creates a token
			const createResponse = await authFetch(userA.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({ name: 'User A Token' }),
			});
			const createData = (await createResponse.json()) as {
				token: { id: string };
			};

			// User B tries to revoke it
			const revokeResponse = await authFetch(
				userB.token!,
				`http://localhost/api/auth/tokens/${createData.token.id}`,
				{ method: 'DELETE' },
			);
			expect(revokeResponse.status).toBe(404);
		});
	});

	describe('API token authentication', () => {
		it('should authenticate with API token on protected endpoints', async () => {
			const user = await createTestUser({
				email: `token-auth-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token Auth User',
			});

			// Create a project first (needed for protected endpoint test)
			await createTestProject(user.token!, {
				name: `Token Auth Project ${Date.now()}`,
				platform: 'javascript',
			});

			// Create an API token
			const createResponse = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({ name: 'Auth Test Token' }),
			});
			const createData = (await createResponse.json()) as { rawToken: string };

			// Use the API token to access a protected endpoint
			const projectsResponse = await SELF.fetch('http://localhost/api/projects', {
				headers: {
					Authorization: `Bearer ${createData.rawToken}`,
				},
			});

			expect(projectsResponse.status).toBe(200);
			const projectsData = (await projectsResponse.json()) as {
				projects: Array<{ slug: string }>;
			};
			expect(projectsData.projects.length).toBeGreaterThanOrEqual(1);
		});

		it('should reject expired API token', async () => {
			const user = await createTestUser({
				email: `token-expired-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token Expired User',
			});

			// Create a token with past expiration
			const createResponse = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({
					name: 'Expired Token',
					expiresAt: new Date(Date.now() - 86400000).toISOString(), // yesterday
				}),
			});
			const createData = (await createResponse.json()) as { rawToken: string };

			// Try to use the expired token
			const response = await SELF.fetch('http://localhost/api/projects', {
				headers: {
					Authorization: `Bearer ${createData.rawToken}`,
				},
			});

			expect(response.status).toBe(401);
		});

		it('should reject revoked API token', async () => {
			const user = await createTestUser({
				email: `token-revoked-auth-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token Revoked Auth User',
			});

			// Create and revoke a token
			const createResponse = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({ name: 'Will Be Revoked' }),
			});
			const createData = (await createResponse.json()) as {
				token: { id: string };
				rawToken: string;
			};

			// Revoke it
			await authFetch(user.token!, `http://localhost/api/auth/tokens/${createData.token.id}`, {
				method: 'DELETE',
			});

			// Try to use the revoked token
			const response = await SELF.fetch('http://localhost/api/projects', {
				headers: {
					Authorization: `Bearer ${createData.rawToken}`,
				},
			});

			expect(response.status).toBe(401);
		});

		it('should update last_used_at when API token is used', async () => {
			const user = await createTestUser({
				email: `token-lastused-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token LastUsed User',
			});

			// Create token
			const createResponse = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({ name: 'LastUsed Test' }),
			});
			const createData = (await createResponse.json()) as { rawToken: string };

			// Use the token
			await SELF.fetch('http://localhost/api/projects', {
				headers: {
					Authorization: `Bearer ${createData.rawToken}`,
				},
			});

			// Check last_used_at is set
			const listResponse = await authFetch(user.token!, 'http://localhost/api/auth/tokens');
			const listData = (await listResponse.json()) as {
				tokens: Array<{ lastUsedAt: string | null }>;
			};
			expect(listData.tokens[0].lastUsedAt).not.toBeNull();
		});

		it('should still work with session tokens', async () => {
			const user = await createTestUser({
				email: `token-session-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Session Test User',
			});

			// Session auth should still work as before
			const response = await SELF.fetch('http://localhost/api/projects', {
				headers: {
					Authorization: `Bearer ${user.token}`,
				},
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Token limits', () => {
		it('should enforce max 10 tokens per user', async () => {
			const user = await createTestUser({
				email: `token-limit-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Token Limit User',
			});

			// Create 10 tokens
			for (let i = 0; i < 10; i++) {
				const resp = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
					method: 'POST',
					body: JSON.stringify({ name: `Token ${i}` }),
				});
				expect(resp.status).toBe(200);
			}

			// 11th should fail
			const response = await authFetch(user.token!, 'http://localhost/api/auth/tokens', {
				method: 'POST',
				body: JSON.stringify({ name: 'Token 11' }),
			});
			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('limit_exceeded');
		});
	});

	describe('Unauthenticated access', () => {
		it('should reject unauthenticated token creation', async () => {
			const response = await SELF.fetch('http://localhost/api/auth/tokens', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Should Fail' }),
			});

			expect(response.status).toBe(401);
		});

		it('should reject unauthenticated token listing', async () => {
			const response = await SELF.fetch('http://localhost/api/auth/tokens');
			expect(response.status).toBe(401);
		});
	});
});
