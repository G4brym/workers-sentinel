import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api/client';

export interface User {
	id: string;
	email: string;
	name: string;
	role: 'admin' | 'member';
	createdAt: string;
	updatedAt: string;
}

interface AuthResponse {
	user: User;
	token: string;
}

interface MeResponse {
	user: User;
}

export const useAuthStore = defineStore('auth', () => {
	const user = ref<User | null>(null);
	const token = ref<string | null>(localStorage.getItem('token'));
	const initialized = ref(false);
	const loading = ref(false);
	const error = ref<string | null>(null);

	const isAuthenticated = computed(() => !!user.value && !!token.value);
	const isAdmin = computed(() => user.value?.role === 'admin');

	async function checkAuth() {
		if (!token.value) {
			initialized.value = true;
			return;
		}

		try {
			const response = await api.get<MeResponse>('/api/auth/me');
			user.value = response.user;
		} catch {
			// Token is invalid, clear it
			logout();
		} finally {
			initialized.value = true;
		}
	}

	async function register(email: string, password: string, name: string) {
		loading.value = true;
		error.value = null;

		try {
			const response = await api.post<AuthResponse>('/api/auth/register', {
				email,
				password,
				name,
			});
			user.value = response.user;
			token.value = response.token;
			localStorage.setItem('token', response.token);
			return true;
		} catch (err) {
			error.value = err instanceof Error ? err.message : 'Registration failed';
			return false;
		} finally {
			loading.value = false;
		}
	}

	async function login(email: string, password: string) {
		loading.value = true;
		error.value = null;

		try {
			const response = await api.post<AuthResponse>('/api/auth/login', { email, password });
			user.value = response.user;
			token.value = response.token;
			localStorage.setItem('token', response.token);
			return true;
		} catch (err) {
			error.value = err instanceof Error ? err.message : 'Login failed';
			return false;
		} finally {
			loading.value = false;
		}
	}

	async function logout() {
		try {
			await api.post('/api/auth/logout', {});
		} catch {
			// Ignore errors
		}

		user.value = null;
		token.value = null;
		localStorage.removeItem('token');
	}

	return {
		user,
		token,
		initialized,
		loading,
		error,
		isAuthenticated,
		isAdmin,
		checkAuth,
		register,
		login,
		logout,
	};
});
