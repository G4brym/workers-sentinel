<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { useProjectsStore } from '../stores/projects';

interface Project {
	id: string;
	name: string;
	slug: string;
	platform: string;
	publicKey: string;
	createdAt: string;
}

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const slug = computed(() => route.params.slug as string);

const project = ref<Project | null>(null);
const dsn = ref<string>('');
const loading = ref(true);
const error = ref<string | null>(null);
const deleting = ref(false);
const showDeleteConfirm = ref(false);

async function loadProject() {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.get<{ project: Project; dsn: string }>(
			`/api/projects/${slug.value}`,
		);
		project.value = response.project;
		dsn.value = response.dsn;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load project';
	} finally {
		loading.value = false;
	}
}

async function deleteProject() {
	if (!project.value) return;

	deleting.value = true;
	try {
		await api.delete(`/api/projects/${slug.value}`);
		// Remove project from store so sidebar updates
		projectsStore.removeProject(slug.value);
		router.push('/projects');
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to delete project';
		deleting.value = false;
	}
}

function copyDsn() {
	navigator.clipboard.writeText(dsn.value);
}

function formatDate(dateString: string): string {
	return new Date(dateString).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

onMounted(() => loadProject());
</script>

<template>
	<div class="max-w-2xl">
		<!-- Loading -->
		<div v-if="loading" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<!-- Settings -->
		<div v-else-if="project" class="space-y-6">
			<h1 class="text-2xl font-bold text-gray-900 dark:text-white">Project Settings</h1>

			<!-- DSN -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Client Keys (DSN)</h2>
				<p class="text-sm text-gray-500 mb-4">
					Use this DSN to configure your Sentry SDK.
				</p>

				<div class="flex items-center space-x-2">
					<code class="flex-1 bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-lg text-sm font-mono break-all text-gray-900 dark:text-gray-100">
						{{ dsn }}
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
			</div>

			<!-- Project info -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Project Information</h2>

				<dl class="space-y-4">
					<div>
						<dt class="text-sm text-gray-500">Name</dt>
						<dd class="text-gray-900 dark:text-white">{{ project.name }}</dd>
					</div>
					<div>
						<dt class="text-sm text-gray-500">Slug</dt>
						<dd class="text-gray-900 dark:text-white font-mono">{{ project.slug }}</dd>
					</div>
					<div>
						<dt class="text-sm text-gray-500">Platform</dt>
						<dd class="text-gray-900 dark:text-white">{{ project.platform }}</dd>
					</div>
					<div>
						<dt class="text-sm text-gray-500">Created</dt>
						<dd class="text-gray-900 dark:text-white">{{ formatDate(project.createdAt) }}</dd>
					</div>
					<div>
						<dt class="text-sm text-gray-500">Project ID</dt>
						<dd class="text-gray-900 dark:text-white font-mono text-sm">{{ project.id }}</dd>
					</div>
				</dl>
			</div>

			<!-- Danger zone -->
			<div class="card border-error-200 dark:border-error-800">
				<div class="p-6 border-b border-error-200 dark:border-error-800">
					<h2 class="text-lg font-semibold text-error-600 dark:text-error-400">Danger Zone</h2>
				</div>
				<div class="p-6">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-sm font-medium text-gray-900 dark:text-white">Delete this project</h3>
							<p class="text-sm text-gray-500">
								Once you delete a project, there is no going back. All data will be permanently deleted.
							</p>
						</div>
						<button
							class="btn btn-danger"
							@click="showDeleteConfirm = true"
						>
							Delete Project
						</button>
					</div>
				</div>
			</div>

			<!-- Delete confirmation modal -->
			<div
				v-if="showDeleteConfirm"
				class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
				@click.self="showDeleteConfirm = false"
			>
				<div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4">
					<h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
						Delete "{{ project.name }}"?
					</h3>
					<p class="text-sm text-gray-500 mb-6">
						This action cannot be undone. All issues, events, and settings for this project will be permanently deleted.
					</p>
					<div class="flex justify-end space-x-3">
						<button
							class="btn btn-secondary"
							@click="showDeleteConfirm = false"
						>
							Cancel
						</button>
						<button
							class="btn btn-danger"
							:disabled="deleting"
							@click="deleteProject"
						>
							<span v-if="deleting">Deleting...</span>
							<span v-else>Delete Project</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
