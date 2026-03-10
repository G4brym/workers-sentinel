<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
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

interface SummaryData {
	issuesByStatus: Record<string, number>;
	events24h: number;
	events7d: number;
	trend: Array<{ bucket: string; count: number }>;
	topIssues: Issue[];
	totalUsers: number;
}

const route = useRoute();
const slug = computed(() => route.params.slug as string);

const summary = ref<SummaryData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const unresolvedCount = computed(() => summary.value?.issuesByStatus?.unresolved || 0);

const maxTrendCount = computed(() => {
	if (!summary.value?.trend.length) return 0;
	return Math.max(...summary.value.trend.map((t) => t.count));
});

async function loadSummary() {
	loading.value = true;
	error.value = null;

	try {
		summary.value = await api.get<SummaryData>(`/api/projects/${slug.value}/summary`);
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load summary';
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

onMounted(() => loadSummary());
watch(slug, () => loadSummary());
</script>

<template>
	<div>
		<!-- Loading -->
		<div v-if="loading" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
			<p class="mt-4 text-gray-500">Loading overview...</p>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<!-- Summary -->
		<div v-else-if="summary">
			<!-- Metric cards -->
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
				<div class="card p-4">
					<p class="text-2xl font-bold text-gray-900 dark:text-white">
						{{ unresolvedCount.toLocaleString() }}
					</p>
					<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Unresolved Issues</p>
				</div>
				<div class="card p-4">
					<p class="text-2xl font-bold text-gray-900 dark:text-white">
						{{ summary.events24h.toLocaleString() }}
					</p>
					<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Events (24h)</p>
				</div>
				<div class="card p-4">
					<p class="text-2xl font-bold text-gray-900 dark:text-white">
						{{ summary.events7d.toLocaleString() }}
					</p>
					<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Events (7d)</p>
				</div>
				<div class="card p-4">
					<p class="text-2xl font-bold text-gray-900 dark:text-white">
						{{ summary.totalUsers.toLocaleString() }}
					</p>
					<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Users Affected</p>
				</div>
			</div>

			<!-- Error trend chart -->
			<div class="card p-4 mb-6">
				<h2 class="text-sm font-medium text-gray-900 dark:text-white mb-4">Error Trend (7 days)</h2>

				<div v-if="summary.trend.length === 0" class="h-48 flex items-center justify-center text-gray-400 text-sm">
					No events recorded yet
				</div>

				<div v-else class="h-48 overflow-hidden">
					<svg class="w-full h-full" :viewBox="`0 0 ${summary.trend.length * 5 + 40} 200`" preserveAspectRatio="xMinYMin meet">
						<!-- Y-axis labels -->
						<text x="0" y="15" font-size="10" fill="currentColor" opacity="0.4">
							{{ maxTrendCount }}
						</text>
						<text x="0" y="185" font-size="10" fill="currentColor" opacity="0.4">0</text>

						<!-- Bars -->
						<g :transform="`translate(35, 0)`">
							<rect
								v-for="(point, index) in summary.trend"
								:key="point.bucket"
								:x="index * 5"
								:y="maxTrendCount > 0 ? 190 - (point.count / maxTrendCount) * 180 : 190"
								:width="4"
								:height="maxTrendCount > 0 ? Math.max((point.count / maxTrendCount) * 180, point.count > 0 ? 2 : 0) : 0"
								fill="#0ea5e9"
								opacity="0.8"
								rx="1"
							>
								<title>{{ new Date(point.bucket).toLocaleString() }}: {{ point.count }} events</title>
							</rect>
						</g>
					</svg>
				</div>
			</div>

			<!-- Top active issues -->
			<div class="card">
				<div class="p-4 border-b border-gray-200 dark:border-gray-700">
					<h2 class="text-sm font-medium text-gray-900 dark:text-white">Top Unresolved Issues</h2>
				</div>

				<div v-if="summary.topIssues.length === 0" class="p-8 text-center text-gray-400 text-sm">
					No unresolved issues
				</div>

				<div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
					<RouterLink
						v-for="issue in summary.topIssues"
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
										{{ issue.metadata.type || issue.title }}
									</h3>
								</div>
								<p class="mt-1 text-sm text-gray-600 dark:text-gray-300 truncate">
									{{ issue.metadata.value || issue.title }}
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
					</RouterLink>
				</div>
			</div>
		</div>
	</div>
</template>
