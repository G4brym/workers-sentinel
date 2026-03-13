<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '../api/client';
import { useProjectsStore } from '../stores/projects';

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
const projectsStore = useProjectsStore();
const slug = computed(() => route.params.slug as string);
const currentProject = computed(() => projectsStore.projects.find((p) => p.slug === slug.value));
const isCloudflareWorkers = computed(() => currentProject.value?.platform === 'cloudflare-workers');

interface TagFacet {
	key: string;
	issueCount: number;
	eventCount: number;
	topValues: Array<{ value: string; issueCount: number; eventCount: number }>;
}

const issues = ref<Issue[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const statusFilter = ref<string>('unresolved');
const environmentFilter = ref<string>('');
const environments = ref<Array<{ name: string; issueCount: number }>>([]);
const hasMore = ref(false);
const nextCursor = ref<string | undefined>();
const dsn = ref<string>('');
const tagFacets = ref<TagFacet[]>([]);
const selectedTags = ref<string[]>([]);
const selectedIds = ref<Set<string>>(new Set());
const bulkLoading = ref(false);

const allSelected = computed(
	() => issues.value.length > 0 && issues.value.every((i) => selectedIds.value.has(i.id)),
);
const someSelected = computed(() => selectedIds.value.size > 0);

function toggleSelect(id: string) {
	const next = new Set(selectedIds.value);
	if (next.has(id)) {
		next.delete(id);
	} else {
		next.add(id);
	}
	selectedIds.value = next;
}

function toggleSelectAll() {
	if (allSelected.value) {
		selectedIds.value = new Set();
	} else {
		selectedIds.value = new Set(issues.value.map((i) => i.id));
	}
}

function clearSelection() {
	selectedIds.value = new Set();
}

async function bulkUpdateStatus(newStatus: string) {
	if (selectedIds.value.size === 0) return;
	bulkLoading.value = true;

	try {
		await api.patch(`/api/projects/${slug.value}/issues/bulk`, {
			issueIds: Array.from(selectedIds.value),
			status: newStatus,
		});
		for (const issue of issues.value) {
			if (selectedIds.value.has(issue.id)) {
				issue.status = newStatus;
			}
		}
		if (statusFilter.value && statusFilter.value !== newStatus) {
			issues.value = issues.value.filter((i) => !selectedIds.value.has(i.id));
		}
		clearSelection();
	} catch (err) {
		console.error('Bulk update failed:', err);
	} finally {
		bulkLoading.value = false;
	}
}

async function bulkDelete() {
	if (selectedIds.value.size === 0) return;
	if (!confirm(`Delete ${selectedIds.value.size} issue(s)? This cannot be undone.`)) return;
	bulkLoading.value = true;

	try {
		await api.patch(`/api/projects/${slug.value}/issues/bulk`, {
			issueIds: Array.from(selectedIds.value),
			action: 'delete',
		});
		issues.value = issues.value.filter((i) => !selectedIds.value.has(i.id));
		clearSelection();
	} catch (err) {
		console.error('Bulk delete failed:', err);
	} finally {
		bulkLoading.value = false;
	}
}

async function loadIssues(append = false) {
	if (!append) {
		loading.value = true;
		clearSelection();
	}
	error.value = null;

	try {
		const params = new URLSearchParams();
		if (statusFilter.value) {
			params.set('status', statusFilter.value);
		}
		if (environmentFilter.value) {
			params.set('environment', environmentFilter.value);
		}
		if (append && nextCursor.value) {
			params.set('cursor', nextCursor.value);
		}
		for (const tag of selectedTags.value) {
			params.append('tag', tag);
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

		// Load DSN if no issues (for quickstart display)
		if (response.issues.length === 0 && !dsn.value) {
			loadDsn();
		}
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load issues';
	} finally {
		loading.value = false;
	}
}

async function loadTagFacets() {
	try {
		const response = await api.get<{ facets: TagFacet[] }>(
			`/api/projects/${slug.value}/tags?limit=10`,
		);
		tagFacets.value = response.facets;
	} catch {
		// Ignore - tag filters just won't appear
	}
}

function getSelectedTagValue(key: string): string {
	const tag = selectedTags.value.find((t) => t.startsWith(`${key}:`));
	return tag ? tag.slice(key.length + 1) : '';
}

function toggleTag(key: string, value: string) {
	if (value) {
		selectedTags.value = selectedTags.value.filter((t) => !t.startsWith(`${key}:`));
		selectedTags.value.push(`${key}:${value}`);
	} else {
		selectedTags.value = selectedTags.value.filter((t) => !t.startsWith(`${key}:`));
	}
	loadIssues();
}

function removeTag(tag: string) {
	selectedTags.value = selectedTags.value.filter((t) => t !== tag);
	loadIssues();
}

async function loadDsn() {
	try {
		const response = await api.get<{ dsn: string }>(`/api/projects/${slug.value}`);
		dsn.value = response.dsn;
	} catch {
		// Ignore - DSN will just show placeholder
	}
}

async function loadEnvironments() {
	try {
		const response = await api.get<{
			environments: Array<{ name: string; issueCount: number; lastSeen: string }>;
		}>(`/api/projects/${slug.value}/environments`);
		environments.value = response.environments;
	} catch {
		// Ignore - environment selector will just be empty
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

onMounted(() => {
	loadIssues();
	loadTagFacets();
	loadEnvironments();
});

watch(statusFilter, () => loadIssues());
watch(environmentFilter, () => loadIssues());
watch(slug, () => loadIssues());
</script>

<template>
	<div>
		<!-- Filters -->
		<div class="flex items-center space-x-4 mb-4">
			<select v-model="statusFilter" class="input w-auto">
				<option value="">All Issues</option>
				<option value="unresolved">Unresolved</option>
				<option value="resolved">Resolved</option>
				<option value="ignored">Ignored</option>
			</select>
			<select
				v-for="facet in tagFacets"
				:key="facet.key"
				class="input w-auto"
				:value="getSelectedTagValue(facet.key)"
				@change="toggleTag(facet.key, ($event.target as HTMLSelectElement).value)"
			>
				<option value="">{{ facet.key }}</option>
				<option v-for="tv in facet.topValues" :key="tv.value" :value="tv.value">
					{{ tv.value }} ({{ tv.issueCount }})
				</option>
			</select>
			<select v-if="environments.length > 0" v-model="environmentFilter" class="input w-auto">
				<option value="">All Environments</option>
				<option v-for="env in environments" :key="env.name" :value="env.name">
					{{ env.name }} ({{ env.issueCount }})
				</option>
			</select>
			<label
				v-if="issues.length > 0"
				class="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer"
			>
				<input
					type="checkbox"
					:checked="allSelected"
					:indeterminate="someSelected && !allSelected"
					class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
					@change="toggleSelectAll"
				/>
				<span>Select all</span>
			</label>
		</div>

		<!-- Active tag filters -->
		<div v-if="selectedTags.length > 0" class="flex items-center flex-wrap gap-2 mb-4">
			<span
				v-for="tag in selectedTags"
				:key="tag"
				class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300"
			>
				{{ tag }}
				<button
					class="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-primary-200 dark:hover:bg-primary-800"
					@click="removeTag(tag)"
				>
					&times;
				</button>
			</span>
		</div>

		<!-- Bulk action bar -->
		<div
			v-if="someSelected"
			class="mb-4 flex items-center justify-between bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg px-4 py-3"
		>
			<span class="text-sm font-medium text-primary-700 dark:text-primary-300">
				{{ selectedIds.size }} issue{{ selectedIds.size !== 1 ? 's' : '' }} selected
			</span>
			<div class="flex items-center space-x-2">
				<button
					class="btn btn-secondary text-sm"
					:disabled="bulkLoading"
					@click="bulkUpdateStatus('resolved')"
				>
					Resolve
				</button>
				<button
					class="btn btn-secondary text-sm"
					:disabled="bulkLoading"
					@click="bulkUpdateStatus('ignored')"
				>
					Ignore
				</button>
				<button
					class="btn btn-secondary text-sm"
					:disabled="bulkLoading"
					@click="bulkUpdateStatus('unresolved')"
				>
					Reopen
				</button>
				<button
					class="btn btn-danger text-sm"
					:disabled="bulkLoading"
					@click="bulkDelete"
				>
					Delete
				</button>
				<button
					class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 ml-2"
					@click="clearSelection"
				>
					Clear
				</button>
			</div>
		</div>

		<!-- Loading -->
		<div v-if="loading && issues.length === 0" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
			<p class="mt-4 text-gray-500">Loading issues...</p>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<!-- Empty state with quickstart -->
		<div v-else-if="issues.length === 0" class="max-w-2xl mx-auto">
			<div class="text-center py-8">
				<svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<h3 class="mt-2 text-lg font-medium text-gray-900 dark:text-white">No issues yet</h3>
				<p class="mt-1 text-sm text-gray-500">
					Configure your SDK to start capturing errors.
				</p>
			</div>

			<!-- Quickstart guide -->
			<div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 mt-6">
				<h3 class="font-medium text-gray-900 dark:text-white mb-4">
					{{ isCloudflareWorkers ? 'Quick Setup (Cloudflare Workers)' : 'Quick Setup' }}
				</h3>

				<!-- Cloudflare Workers setup -->
				<template v-if="isCloudflareWorkers">
					<p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
						1. Install the SDK:
					</p>
					<pre class="text-sm bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto mb-4"><code>npm install @sentry/cloudflare --save</code></pre>

					<p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
						2. Add a service binding to Sentinel and the compatibility flag in <code class="text-xs bg-gray-200 dark:bg-gray-600 px-1 rounded">wrangler.jsonc</code>:
					</p>
					<pre class="text-sm bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto mb-4"><code>{
  "compatibility_flags": ["nodejs_als"],
  "services": [
    { "binding": "SENTINEL", "service": "workers-sentinel", "entrypoint": "SentinelRpc" }
  ]
}</code></pre>

					<p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
						3. Initialize Sentry with the RPC transport:
					</p>
					<pre class="text-sm bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto"><code>import * as Sentry from "@sentry/cloudflare";
import { waitUntil } from "cloudflare:workers";

const DSN = "{{ dsn }}";

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: DSN,
    transport: () => ({
      send: async (envelope) => {
        const rpcPromise = env.SENTINEL.captureEnvelope(DSN, envelope);
        waitUntil(rpcPromise);
        const result = await rpcPromise;
        return { statusCode: result.status };
      },
      flush: async () => true,
    }),
  }),
  {
    async fetch(request, env, ctx) {
      return new Response("Hello World!");
    },
  }
);</code></pre>
					<p class="text-xs text-gray-500 dark:text-gray-400 mt-3">
						Using a service binding with RPC routes requests internally within Cloudflare's network, avoiding external HTTP roundtrips and reducing latency.
					</p>
				</template>

				<!-- Default JavaScript setup -->
				<template v-else>
					<pre class="text-sm bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto"><code>import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: '{{ dsn }}',
});</code></pre>
				</template>
			</div>
		</div>

		<!-- Issues list -->
		<div v-else class="card divide-y divide-gray-200 dark:divide-gray-700">
			<div
				v-for="issue in issues"
				:key="issue.id"
				class="flex items-start p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
			>
				<div class="flex items-center pt-1 pr-3">
					<input
						type="checkbox"
						:checked="selectedIds.has(issue.id)"
						class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
						@change="toggleSelect(issue.id)"
					/>
				</div>
				<RouterLink
					:to="`/projects/${slug}/issues/${issue.id}`"
					class="flex-1 min-w-0"
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
