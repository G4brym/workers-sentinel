<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const name = ref('');
const email = ref('');
const password = ref('');

async function handleSubmit() {
	const success = await authStore.register(email.value, password.value, name.value);
	if (success) {
		router.push('/');
	}
}
</script>

<template>
	<div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
		<div class="max-w-md w-full space-y-8">
			<div>
				<div class="mx-auto w-12 h-12 bg-primary-500 rounded-xl flex items-center justify-center">
					<span class="text-2xl font-bold text-white">S</span>
				</div>
				<h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
					Create your account
				</h2>
				<p class="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
					Already have an account?
					<RouterLink to="/login" class="font-medium text-primary-600 hover:text-primary-500">
						Sign in
					</RouterLink>
				</p>
			</div>

			<form class="mt-8 space-y-6" @submit.prevent="handleSubmit">
				<div v-if="authStore.error" class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg text-sm">
					{{ authStore.error }}
				</div>

				<div class="space-y-4">
					<div>
						<label for="name" class="label">Name</label>
						<input
							id="name"
							v-model="name"
							type="text"
							autocomplete="name"
							required
							class="input"
							placeholder="John Doe"
						/>
					</div>

					<div>
						<label for="email" class="label">Email address</label>
						<input
							id="email"
							v-model="email"
							type="email"
							autocomplete="email"
							required
							class="input"
							placeholder="you@example.com"
						/>
					</div>

					<div>
						<label for="password" class="label">Password</label>
						<input
							id="password"
							v-model="password"
							type="password"
							autocomplete="new-password"
							required
							minlength="8"
							class="input"
							placeholder="••••••••"
						/>
						<p class="mt-1 text-xs text-gray-500">At least 8 characters</p>
					</div>
				</div>

				<button type="submit" :disabled="authStore.loading" class="btn btn-primary w-full">
					<span v-if="authStore.loading">Creating account...</span>
					<span v-else>Create account</span>
				</button>
			</form>
		</div>
	</div>
</template>
