<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { api } from '../api/client';

interface Issue {
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
}

const route = useRoute();
const slug = computed(() => route.params.slug as string);

const issues = ref<Issue[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const statusFilter = ref<string>('unresolved');
const hasMore = ref(false);
const nextCursor = ref<string | undefined>();

async function loadIssues(append = false) {
	if (!append) {
		loading.value = true;
	}
	error.value = null;

	try {
		const params = new URLSearchParams();
		if (statusFilter.value) {
			params.set('status', statusFilter.value);
		}
		if (append && nextCursor.value) {
			params.set('cursor', nextCursor.value);
		}

		const response = await api.get<{
			issues: Issue[];
			hasMore: boolean;
			nextCursor?: string;
		}>(`/api/projects/${slug.value}/issues?${params}`);

		if (append) {
			issues.value = [...issues.value, ...response.issues];
		} else {
			issues.value = response.issues;
		}
		hasMore.value = response.hasMore;
		nextCursor.value = response.nextCursor;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load issues';
	} finally {
		loading.value = false;
	}
}

async function updateStatus(issue: Issue, newStatus: string) {
	try {
		await api.patch(`/api/projects/${slug.value}/issues/${issue.id}`, { status: newStatus });
		issue.status = newStatus;
	} catch (err) {
		console.error('Failed to update status:', err);
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

onMounted(() => loadIssues());

watch(statusFilter, () => loadIssues());
watch(slug, () => loadIssues());
</script>

<template>
	<div>
		<!-- Filters -->
		<div class="flex items-center space-x-4 mb-6">
			<select v-model="statusFilter" class="input w-auto">
				<option value="">All Issues</option>
				<option value="unresolved">Unresolved</option>
				<option value="resolved">Resolved</option>
				<option value="ignored">Ignored</option>
			</select>
		</div>

		<!-- Loading -->
		<div v-if="loading && issues.length === 0" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
			<p class="mt-4 text-gray-500">Loading issues...</p>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="bg-error-50 text-error-700 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<!-- Empty state -->
		<div v-else-if="issues.length === 0" class="text-center py-12">
			<svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<h3 class="mt-2 text-sm font-medium text-gray-900 dark:text-white">No issues</h3>
			<p class="mt-1 text-sm text-gray-500">
				No {{ statusFilter || '' }} issues found. That's great!
			</p>
		</div>

		<!-- Issues list -->
		<div v-else class="card divide-y divide-gray-200 dark:divide-gray-700">
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
							<span title="Events">{{ issue.count.toLocaleString() }}</span>
							<span v-if="issue.userCount > 0" title="Users">
								{{ issue.userCount.toLocaleString() }} users
							</span>
						</div>
						<p class="text-xs text-gray-400 mt-1">
							{{ formatTimeAgo(issue.lastSeen) }}
						</p>
					</div>
				</div>

				<!-- Quick actions -->
				<div class="mt-3 flex items-center space-x-2" @click.prevent>
					<button
						v-if="issue.status !== 'resolved'"
						class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
						@click="updateStatus(issue, 'resolved')"
					>
						Resolve
					</button>
					<button
						v-if="issue.status !== 'ignored'"
						class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
						@click="updateStatus(issue, 'ignored')"
					>
						Ignore
					</button>
					<button
						v-if="issue.status !== 'unresolved'"
						class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
						@click="updateStatus(issue, 'unresolved')"
					>
						Reopen
					</button>
				</div>
			</RouterLink>
		</div>

		<!-- Load more -->
		<div v-if="hasMore" class="mt-4 text-center">
			<button
				class="btn btn-secondary"
				:disabled="loading"
				@click="loadIssues(true)"
			>
				<span v-if="loading">Loading...</span>
				<span v-else>Load More</span>
			</button>
		</div>
	</div>
</template>
