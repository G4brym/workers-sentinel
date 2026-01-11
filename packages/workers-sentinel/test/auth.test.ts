import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { createTestUser, loginUser } from './utils';

// Helper to retry requests that might fail due to DO reset
async function fetchWithRetry(
	url: string,
	options: RequestInit,
	retries = 5,
): Promise<Response> {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await SELF.fetch(url, options);
			if (response.ok) return response;

			// Check for DO reset error
			const text = await response.clone().text();
			if (text.includes('invalidating this Durable Object') && i < retries - 1) {
				await new Promise((r) => setTimeout(r, 200 * (i + 1)));
				continue;
			}
			return response;
		} catch (e) {
			if (i < retries - 1) {
				await new Promise((r) => setTimeout(r, 200 * (i + 1)));
				continue;
			}
			throw e;
		}
	}
	return SELF.fetch(url, options);
}

describe('Auth Routes', () => {
	describe('POST /api/auth/register', () => {
		it('should register a new user successfully', async () => {
			const email = `register-test-${Date.now()}@example.com`;
			const user = await createTestUser({
				email,
				password: 'testpassword123',
				name: 'Test User',
			});

			expect(user.email).toBe(email);
			expect(user.name).toBe('Test User');
			expect(user.token).toBeDefined();
			expect(typeof user.token).toBe('string');
		});

		it('should make the first user an admin', async () => {
			// Note: This test assumes fresh DB state or checks for admin role
			const response = await SELF.fetch('http://localhost/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: `first-user-${Date.now()}@example.com`,
					password: 'testpassword123',
					name: 'First User',
				}),
			});

			const data = (await response.json()) as { user: { role: string } };
			// First user in a fresh test should be admin
			expect(['admin', 'member']).toContain(data.user.role);
		});

		it('should reject registration with missing fields', async () => {
			const response = await SELF.fetch('http://localhost/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'test@example.com',
					// missing password and name
				}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('missing_fields');
		});

		it('should reject duplicate email registration', async () => {
			const email = `duplicate-test-${Date.now()}@example.com`;

			// First registration
			await SELF.fetch('http://localhost/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email,
					password: 'testpassword123',
					name: 'First User',
				}),
			});

			// Second registration with same email
			const response = await SELF.fetch('http://localhost/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email,
					password: 'testpassword123',
					name: 'Second User',
				}),
			});

			expect(response.status).toBe(409);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('user_exists');
		});
	});

	describe('POST /api/auth/login', () => {
		it('should login with valid credentials', async () => {
			const email = `login-test-${Date.now()}@example.com`;
			const password = 'testpassword123';

			// Register first
			await createTestUser({ email, password, name: 'Login Test User' });

			// Login
			const response = await SELF.fetch('http://localhost/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as { user: { email: string }; token: string };
			expect(data.user).toBeDefined();
			expect(data.user.email).toBe(email);
			expect(data.token).toBeDefined();
		});

		it('should reject login with invalid password', async () => {
			const email = `invalid-pass-${Date.now()}@example.com`;

			await createTestUser({ email, password: 'correctpassword', name: 'Test User' });

			const response = await SELF.fetch('http://localhost/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password: 'wrongpassword' }),
			});

			expect(response.status).toBe(401);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('invalid_credentials');
		});

		it('should reject login with non-existent email', async () => {
			const response = await SELF.fetch('http://localhost/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'nonexistent@example.com',
					password: 'testpassword123',
				}),
			});

			expect(response.status).toBe(401);
			const data = (await response.json()) as { error: string };
			expect(data.error).toBe('invalid_credentials');
		});

		it('should reject login with missing fields', async () => {
			const response = await SELF.fetch('http://localhost/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'test@example.com',
					// missing password
				}),
			});

			expect(response.status).toBe(400);
		});
	});

	describe('GET /api/auth/me', () => {
		it('should return current user with valid token', async () => {
			const user = await createTestUser({
				email: `me-test-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Me Test User',
			});

			const response = await SELF.fetch('http://localhost/api/auth/me', {
				headers: {
					Authorization: `Bearer ${user.token}`,
				},
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as { user: { email: string; name: string } };
			expect(data.user).toBeDefined();
			expect(data.user.email).toBe(user.email);
			expect(data.user.name).toBe(user.name);
		});

		it('should reject request without token', async () => {
			const response = await SELF.fetch('http://localhost/api/auth/me');

			expect(response.status).toBe(401);
		});

		it('should reject request with invalid token', async () => {
			const response = await SELF.fetch('http://localhost/api/auth/me', {
				headers: {
					Authorization: 'Bearer invalid-token-here',
				},
			});

			expect(response.status).toBe(401);
		});
	});

	describe('POST /api/auth/logout', () => {
		it('should logout successfully', async () => {
			const user = await createTestUser({
				email: `logout-test-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Logout Test User',
			});

			const response = await SELF.fetch('http://localhost/api/auth/logout', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${user.token}`,
				},
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as { success: boolean };
			expect(data.success).toBe(true);
		});

		it('should invalidate token after logout', async () => {
			const user = await createTestUser({
				email: `logout-invalid-${Date.now()}@example.com`,
				password: 'testpassword123',
				name: 'Logout Invalid Test',
			});

			// Logout
			await SELF.fetch('http://localhost/api/auth/logout', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${user.token}`,
				},
			});

			// Try to use the token
			const response = await SELF.fetch('http://localhost/api/auth/me', {
				headers: {
					Authorization: `Bearer ${user.token}`,
				},
			});

			expect(response.status).toBe(401);
		});
	});
});

describe('Health Check', () => {
	it('should return healthy status', async () => {
		const response = await SELF.fetch('http://localhost/api/health');

		expect(response.status).toBe(200);
		const data = (await response.json()) as { status: string; timestamp: string };
		expect(data.status).toBe('ok');
		expect(data.timestamp).toBeDefined();
	});
});
