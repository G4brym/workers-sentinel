<script setup lang="ts">
import { computed, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useProjectsStore } from '../stores/projects';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const projectsStore = useProjectsStore();

const currentSlug = computed(() => route.params.slug as string | undefined);
const currentProject = computed(() =>
	projectsStore.projects.find((p) => p.slug === currentSlug.value),
);

async function logout() {
	await authStore.logout();
	projectsStore.reset();
	router.push('/login');
}

watch(
	() => authStore.isAuthenticated,
	(isAuth) => {
		if (isAuth && !projectsStore.initialized) {
			projectsStore.loadProjects();
		}
	},
	{ immediate: true },
);
</script>

<template>
	<div class="flex h-screen">
		<!-- Sidebar -->
		<aside class="w-64 bg-gray-900 text-white flex flex-col">
			<!-- Logo -->
			<div class="p-4 border-b border-gray-800">
				<RouterLink to="/" class="flex items-center space-x-2">
					<div class="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
						<span class="text-lg font-bold">S</span>
					</div>
					<span class="font-semibold">Sentinel</span>
				</RouterLink>
			</div>

			<!-- Projects -->
			<nav class="flex-1 overflow-y-auto p-4">
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Projects</h2>
					<RouterLink to="/projects/new" class="text-gray-400 hover:text-white">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
						</svg>
					</RouterLink>
				</div>

				<div v-if="projectsStore.loading" class="text-gray-400 text-sm">Loading...</div>

				<ul v-else class="space-y-1">
					<li v-for="project in projectsStore.projects" :key="project.id">
						<RouterLink
							:to="`/projects/${project.slug}/issues`"
							class="flex items-center px-3 py-2 rounded-lg text-sm"
							:class="
								currentSlug === project.slug
									? 'bg-gray-800 text-white'
									: 'text-gray-300 hover:bg-gray-800 hover:text-white'
							"
						>
							<span class="truncate">{{ project.name }}</span>
						</RouterLink>
					</li>
				</ul>

				<RouterLink
					v-if="!projectsStore.loading && projectsStore.projects.length === 0"
					to="/projects/new"
					class="block text-center py-8 text-gray-400 hover:text-white"
				>
					Create your first project
				</RouterLink>
			</nav>

			<!-- User -->
			<div class="p-4 border-t border-gray-800">
				<div class="flex items-center justify-between">
					<div class="flex items-center min-w-0">
						<div
							class="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-sm font-medium"
						>
							{{ authStore.user?.name?.charAt(0).toUpperCase() }}
						</div>
						<div class="ml-3 min-w-0">
							<p class="text-sm font-medium truncate">{{ authStore.user?.name }}</p>
							<p class="text-xs text-gray-400 truncate">{{ authStore.user?.email }}</p>
						</div>
					</div>
					<button @click="logout" class="text-gray-400 hover:text-white" title="Logout">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
							/>
						</svg>
					</button>
				</div>
			</div>
		</aside>

		<!-- Main content -->
		<main class="flex-1 overflow-y-auto">
			<!-- Header -->
			<header v-if="currentProject" class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center space-x-4">
						<h1 class="text-xl font-semibold text-gray-900 dark:text-white">
							{{ currentProject.name }}
						</h1>
						<span class="badge badge-info">{{ currentProject.platform }}</span>
					</div>
					<div class="flex items-center space-x-2">
						<RouterLink
							:to="`/projects/${currentProject.slug}/issues`"
							class="px-3 py-1.5 text-sm rounded-lg"
							:class="
								route.name === 'issues'
									? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
									: 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
							"
						>
							Issues
						</RouterLink>
						<RouterLink
							:to="`/projects/${currentProject.slug}/settings`"
							class="px-3 py-1.5 text-sm rounded-lg"
							:class="
								route.name === 'project-settings'
									? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
									: 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
							"
						>
							Settings
						</RouterLink>
					</div>
				</div>
			</header>

			<div class="p-6">
				<RouterView />
			</div>
		</main>
	</div>
</template>
