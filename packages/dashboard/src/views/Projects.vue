<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../api/client';

interface Project {
	id: string;
	name: string;
	slug: string;
	platform: string;
	createdAt: string;
}

const projects = ref<Project[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
	try {
		const response = await api.get<{ projects: Project[] }>('/api/projects');
		projects.value = response.projects;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load projects';
	} finally {
		loading.value = false;
	}
});

function formatDate(dateString: string): string {
	return new Date(dateString).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}
</script>

<template>
	<div>
		<div class="flex items-center justify-between mb-6">
			<h1 class="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
			<RouterLink to="/projects/new" class="btn btn-primary">
				<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
				</svg>
				New Project
			</RouterLink>
		</div>

		<div v-if="loading" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
			<p class="mt-4 text-gray-500">Loading projects...</p>
		</div>

		<div v-else-if="error" class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<div v-else-if="projects.length === 0" class="text-center py-12">
			<svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
				/>
			</svg>
			<h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-white">No projects</h3>
			<p class="mt-1 text-sm text-gray-500">Get started by creating a new project.</p>
			<div class="mt-6">
				<RouterLink to="/projects/new" class="btn btn-primary">
					<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
					</svg>
					New Project
				</RouterLink>
			</div>
		</div>

		<div v-else class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			<RouterLink
				v-for="project in projects"
				:key="project.id"
				:to="`/projects/${project.slug}/issues`"
				class="card p-6 hover:shadow-md transition-shadow"
			>
				<div class="flex items-start justify-between">
					<div>
						<h3 class="font-semibold text-gray-900 dark:text-white">{{ project.name }}</h3>
						<p class="text-sm text-gray-500 mt-1">{{ project.slug }}</p>
					</div>
					<span class="badge badge-info">{{ project.platform }}</span>
				</div>
				<p class="text-xs text-gray-400 mt-4">Created {{ formatDate(project.createdAt) }}</p>
			</RouterLink>
		</div>
	</div>
</template>
