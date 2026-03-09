<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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

interface ReleaseIssue {
	id: string;
	title: string;
	culprit: string | null;
	level: string;
	platform: string;
	firstSeen: string;
	lastSeen: string;
	count: number;
	userCount: number;
	status: string;
	metadata: {
		type: string;
		value: string;
	};
	firstSeenInRelease: string;
	releaseEventCount: number;
}

const route = useRoute();
const slug = computed(() => route.params.slug as string);
const version = computed(() => decodeURIComponent(route.params.version as string));

const release = ref<Release | null>(null);
const issues = ref<ReleaseIssue[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

async function loadRelease() {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.get<{
			release: Release;
			issues: ReleaseIssue[];
		}>(`/api/projects/${slug.value}/releases/${encodeURIComponent(version.value)}`);

		release.value = response.release;
		issues.value = response.issues;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load release';
	} finally {
		loading.value = false;
	}
}

function formatTime(dateString: string): string {
	return new Date(dateString).toLocaleString();
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

function getLevelBadgeClass(level: string): string {
	switch (level) {
		case 'fatal':
		case 'error':
			return 'badge-error';
		case 'warning':
			return 'badge-warning';
		default:
			return 'badge-info';
	}
}

onMounted(() => loadRelease());
</script>

<template>
	<div>
		<!-- Loading -->
		<div v-if="loading" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<!-- Release detail -->
		<div v-else-if="release">
			<!-- Breadcrumb -->
			<div class="flex items-center space-x-2 text-sm text-gray-500 mb-2">
				<RouterLink :to="`/projects/${slug}/releases`" class="hover:text-gray-700">
					Releases
				</RouterLink>
				<span>/</span>
				<span class="font-mono">{{ release.version }}</span>
			</div>

			<!-- Header -->
			<div class="mb-6">
				<h1 class="text-xl font-bold text-gray-900 dark:text-white font-mono mb-4">
					{{ release.version }}
				</h1>

				<div class="flex items-center space-x-6 text-sm text-gray-500">
					<div>
						<span class="font-medium text-gray-900 dark:text-white">{{ release.eventCount.toLocaleString() }}</span>
						events
					</div>
					<div>
						<span class="font-medium text-gray-900 dark:text-white">{{ release.issueCount.toLocaleString() }}</span>
						issues
					</div>
					<div v-if="release.newIssueCount > 0">
						<span class="badge badge-warning">{{ release.newIssueCount }} new issues</span>
					</div>
					<div>
						First seen <span class="font-medium text-gray-900 dark:text-white">{{ formatTime(release.firstSeen) }}</span>
					</div>
					<div>
						Last seen <span class="font-medium text-gray-900 dark:text-white">{{ formatTime(release.lastSeen) }}</span>
					</div>
				</div>
			</div>

			<!-- Issues list -->
			<div v-if="issues.length > 0" class="card divide-y divide-gray-200 dark:divide-gray-700">
				<div class="p-4 border-b border-gray-200 dark:border-gray-700">
					<h2 class="font-semibold text-gray-900 dark:text-white">Issues in this release</h2>
				</div>

				<RouterLink
					v-for="issue in issues"
					:key="issue.id"
					:to="`/projects/${slug}/issues/${issue.id}`"
					class="block p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
				>
					<div class="flex items-start justify-between">
						<div class="flex-1 min-w-0">
							<div class="flex items-center space-x-2">
								<span :class="['badge', getLevelBadgeClass(issue.level)]">
									{{ issue.level }}
								</span>
								<h3 class="text-sm font-medium text-gray-900 dark:text-white truncate">
									{{ issue.metadata.type }}
								</h3>
								<span
									v-if="issue.firstSeen === issue.firstSeenInRelease"
									class="badge badge-warning"
								>
									new
								</span>
							</div>
							<p class="mt-1 text-sm text-gray-600 dark:text-gray-300 truncate">
								{{ issue.metadata.value || issue.title }}
							</p>
							<p v-if="issue.culprit" class="mt-1 text-xs text-gray-400 truncate">
								{{ issue.culprit }}
							</p>
						</div>

						<div class="ml-4 flex flex-col items-end text-sm">
							<div class="flex items-center space-x-4 text-gray-500">
								<span title="Events in this release">{{ issue.releaseEventCount.toLocaleString() }} in release</span>
								<span title="Total events" class="text-gray-400">{{ issue.count.toLocaleString() }} total</span>
							</div>
							<p class="text-xs text-gray-400 mt-1">
								{{ formatTimeAgo(issue.firstSeenInRelease) }}
							</p>
						</div>
					</div>
				</RouterLink>
			</div>

			<!-- No issues -->
			<div v-else class="text-center py-8 text-gray-500">
				No issues found in this release.
			</div>
		</div>
	</div>
</template>
