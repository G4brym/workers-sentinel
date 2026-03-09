<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '../api/client';

interface Release {
	version: string;
	firstSeen: string;
	lastSeen: string;
	eventCount: number;
	issueCount: number;
	newIssueCount: number;
}

const route = useRoute();
const slug = computed(() => route.params.slug as string);

const releases = ref<Release[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const hasMore = ref(false);
const nextCursor = ref<string | undefined>();

async function loadReleases(append = false) {
	if (!append) {
		loading.value = true;
	}
	error.value = null;

	try {
		const params = new URLSearchParams();
		if (append && nextCursor.value) {
			params.set('cursor', nextCursor.value);
		}

		const response = await api.get<{
			releases: Release[];
			hasMore: boolean;
			nextCursor?: string;
		}>(`/api/projects/${slug.value}/releases?${params}`);

		if (append) {
			releases.value = [...releases.value, ...response.releases];
		} else {
			releases.value = response.releases;
		}
		hasMore.value = response.hasMore;
		nextCursor.value = response.nextCursor;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load releases';
	} finally {
		loading.value = false;
	}
}

function formatTimeAgo(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

	if (seconds < 60) return 'just now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
	return date.toLocaleDateString();
}

onMounted(() => loadReleases());
watch(slug, () => loadReleases());
</script>

<template>
	<div>
		<!-- Loading -->
		<div v-if="loading && releases.length === 0" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
			<p class="mt-4 text-gray-500">Loading releases...</p>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<!-- Empty state -->
		<div v-else-if="releases.length === 0" class="text-center py-12">
			<svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
				/>
			</svg>
			<h3 class="mt-2 text-lg font-medium text-gray-900 dark:text-white">No releases yet</h3>
			<p class="mt-1 text-sm text-gray-500">
				Releases will appear here once you configure the <code class="text-xs bg-gray-200 dark:bg-gray-600 px-1 rounded">release</code> option in your Sentry SDK.
			</p>
		</div>

		<!-- Releases list -->
		<div v-else class="card divide-y divide-gray-200 dark:divide-gray-700">
			<RouterLink
				v-for="release in releases"
				:key="release.version"
				:to="`/projects/${slug}/releases/${encodeURIComponent(release.version)}`"
				class="block p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
			>
				<div class="flex items-start justify-between">
					<div class="flex-1 min-w-0">
						<h3 class="text-sm font-medium text-gray-900 dark:text-white font-mono">
							{{ release.version }}
						</h3>
						<p class="mt-1 text-xs text-gray-500">
							First seen {{ formatTimeAgo(release.firstSeen) }}
							&middot;
							Last seen {{ formatTimeAgo(release.lastSeen) }}
						</p>
					</div>

					<div class="ml-4 flex items-center space-x-4 text-sm">
						<div class="text-right">
							<span class="font-medium text-gray-900 dark:text-white">{{ release.eventCount.toLocaleString() }}</span>
							<span class="text-gray-500 ml-1">events</span>
						</div>
						<div class="text-right">
							<span class="font-medium text-gray-900 dark:text-white">{{ release.issueCount.toLocaleString() }}</span>
							<span class="text-gray-500 ml-1">issues</span>
						</div>
						<div v-if="release.newIssueCount > 0" class="text-right">
							<span class="badge badge-warning">{{ release.newIssueCount }} new</span>
						</div>
					</div>
				</div>
			</RouterLink>
		</div>

		<!-- Load more -->
		<div v-if="hasMore" class="mt-4 text-center">
			<button
				class="btn btn-secondary"
				:disabled="loading"
				@click="loadReleases(true)"
			>
				<span v-if="loading">Loading...</span>
				<span v-else>Load More</span>
			</button>
		</div>
	</div>
</template>
