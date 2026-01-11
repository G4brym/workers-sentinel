<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';

const router = useRouter();

const name = ref('');
const platform = ref('javascript');
const loading = ref(false);
const error = ref<string | null>(null);
const createdProject = ref<{
	project: { name: string; slug: string };
	dsn: string;
} | null>(null);

const platforms = [
	{ value: 'javascript', label: 'JavaScript' },
	{ value: 'node', label: 'Node.js' },
	{ value: 'python', label: 'Python' },
	{ value: 'go', label: 'Go' },
	{ value: 'rust', label: 'Rust' },
	{ value: 'java', label: 'Java' },
	{ value: 'php', label: 'PHP' },
	{ value: 'ruby', label: 'Ruby' },
	{ value: 'other', label: 'Other' },
];

async function handleSubmit() {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.post<{
			project: { name: string; slug: string };
			dsn: string;
		}>('/api/projects', {
			name: name.value,
			platform: platform.value,
		});
		createdProject.value = response;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to create project';
	} finally {
		loading.value = false;
	}
}

function copyDsn() {
	if (createdProject.value) {
		navigator.clipboard.writeText(createdProject.value.dsn);
	}
}

function goToProject() {
	if (createdProject.value) {
		router.push(`/projects/${createdProject.value.project.slug}/issues`);
	}
}
</script>

<template>
	<div class="max-w-2xl mx-auto">
		<h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">Create New Project</h1>

		<!-- Success state -->
		<div v-if="createdProject" class="card p-6">
			<div class="text-center mb-6">
				<div class="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
					<svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
				</div>
				<h2 class="text-xl font-semibold text-gray-900 dark:text-white">Project Created!</h2>
				<p class="text-gray-500 mt-1">{{ createdProject.project.name }}</p>
			</div>

			<div class="mb-6">
				<label class="label">Your DSN</label>
				<div class="flex items-center space-x-2">
					<code class="flex-1 bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-lg text-sm font-mono break-all">
						{{ createdProject.dsn }}
					</code>
					<button @click="copyDsn" class="btn btn-secondary" title="Copy to clipboard">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
							/>
						</svg>
					</button>
				</div>
				<p class="mt-2 text-sm text-gray-500">
					Use this DSN to configure your Sentry SDK.
				</p>
			</div>

			<div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6">
				<h3 class="font-medium text-gray-900 dark:text-white mb-2">Quick Setup (JavaScript)</h3>
				<pre class="text-sm bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto"><code>import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: '{{ createdProject.dsn }}',
});</code></pre>
			</div>

			<button @click="goToProject" class="btn btn-primary w-full">
				Go to Project
			</button>
		</div>

		<!-- Form -->
		<form v-else class="card p-6" @submit.prevent="handleSubmit">
			<div v-if="error" class="mb-4 bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg text-sm">
				{{ error }}
			</div>

			<div class="space-y-4">
				<div>
					<label for="name" class="label">Project Name</label>
					<input
						id="name"
						v-model="name"
						type="text"
						required
						class="input"
						placeholder="My Application"
					/>
				</div>

				<div>
					<label for="platform" class="label">Platform</label>
					<select id="platform" v-model="platform" class="input">
						<option v-for="p in platforms" :key="p.value" :value="p.value">
							{{ p.label }}
						</option>
					</select>
				</div>
			</div>

			<div class="mt-6 flex justify-end space-x-3">
				<button type="button" class="btn btn-secondary" @click="router.back()">
					Cancel
				</button>
				<button type="submit" :disabled="loading" class="btn btn-primary">
					<span v-if="loading">Creating...</span>
					<span v-else>Create Project</span>
				</button>
			</div>
		</form>
	</div>
</template>
