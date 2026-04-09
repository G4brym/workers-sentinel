<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';

interface InboundFilter {
	id: string;
	filterType: string;
	pattern: string;
	enabled: boolean;
	description: string | null;
	droppedCount: number;
	createdAt: string;
}

const route = useRoute();
const slug = computed(() => route.params.slug as string);

const filters = ref<InboundFilter[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const showCreateForm = ref(false);
const creating = ref(false);

const newFilter = ref({
	filterType: 'message',
	pattern: '',
	description: '',
});

const filterTypeLabels: Record<string, string> = {
	message: 'Error Message',
	error_type: 'Exception Type',
	ip_address: 'IP Address',
	release: 'Release',
	environment: 'Environment',
};

const totalDropped = computed(() => filters.value.reduce((sum, f) => sum + f.droppedCount, 0));

const suggestions = [
	{
		filterType: 'message',
		pattern: 'ResizeObserver loop',
		description: 'Browser ResizeObserver loop errors',
	},
	{
		filterType: 'message',
		pattern: 'Non-Error exception captured',
		description: 'Non-Error objects thrown as exceptions',
	},
	{
		filterType: 'error_type',
		pattern: 'ChunkLoadError',
		description: 'Webpack chunk loading failures',
	},
];

async function loadFilters() {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.get<{ filters: InboundFilter[] }>(
			`/api/projects/${slug.value}/filters`,
		);
		filters.value = response.filters;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load filters';
	} finally {
		loading.value = false;
	}
}

async function createFilter() {
	creating.value = true;
	error.value = null;

	try {
		await api.post(`/api/projects/${slug.value}/filters`, {
			filterType: newFilter.value.filterType,
			pattern: newFilter.value.pattern,
			description: newFilter.value.description || undefined,
		});
		newFilter.value = { filterType: 'message', pattern: '', description: '' };
		showCreateForm.value = false;
		await loadFilters();
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to create filter';
	} finally {
		creating.value = false;
	}
}

async function toggleFilter(id: string, enabled: boolean) {
	try {
		await api.patch(`/api/projects/${slug.value}/filters/${id}`, { enabled });
		const filter = filters.value.find((f) => f.id === id);
		if (filter) {
			filter.enabled = enabled;
		}
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to update filter';
	}
}

async function deleteFilter(id: string) {
	if (!confirm('Are you sure you want to delete this filter?')) return;

	try {
		await api.delete(`/api/projects/${slug.value}/filters/${id}`);
		filters.value = filters.value.filter((f) => f.id !== id);
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to delete filter';
	}
}

function applySuggestion(suggestion: (typeof suggestions)[0]) {
	newFilter.value.filterType = suggestion.filterType;
	newFilter.value.pattern = suggestion.pattern;
	newFilter.value.description = suggestion.description;
	showCreateForm.value = true;
}

function formatDate(dateString: string): string {
	return new Date(dateString).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

onMounted(() => loadFilters());
</script>

<template>
	<div class="max-w-3xl">
		<!-- Header -->
		<div class="flex items-center justify-between mb-6">
			<div>
				<h1 class="text-2xl font-bold text-gray-900 dark:text-white">Inbound Filters</h1>
				<p class="text-sm text-gray-500 mt-1">
					Drop noisy events before they are stored.
				</p>
			</div>
			<button
				v-if="!showCreateForm"
				class="btn btn-primary"
				@click="showCreateForm = true"
			>
				Create Filter
			</button>
		</div>

		<!-- Error -->
		<div
			v-if="error"
			class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg mb-4"
		>
			{{ error }}
		</div>

		<!-- Stats -->
		<div v-if="!loading && filters.length > 0" class="flex space-x-6 mb-6">
			<div class="text-sm text-gray-500">
				<span class="font-semibold text-gray-900 dark:text-white">{{ filters.length }}</span>
				{{ filters.length === 1 ? 'filter' : 'filters' }}
			</div>
			<div class="text-sm text-gray-500">
				<span class="font-semibold text-gray-900 dark:text-white">{{ totalDropped.toLocaleString() }}</span>
				events dropped
			</div>
		</div>

		<!-- Create form -->
		<div v-if="showCreateForm" class="card p-6 mb-6">
			<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">New Filter</h2>
			<form class="space-y-4" @submit.prevent="createFilter">
				<div>
					<label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
						Filter Type
					</label>
					<select
						v-model="newFilter.filterType"
						class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
					>
						<option value="message">Error Message</option>
						<option value="error_type">Exception Type</option>
						<option value="ip_address">IP Address</option>
						<option value="release">Release</option>
						<option value="environment">Environment</option>
					</select>
				</div>

				<div>
					<label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
						Pattern
					</label>
					<input
						v-model="newFilter.pattern"
						type="text"
						required
						maxlength="500"
						placeholder="e.g. ResizeObserver loop"
						class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
					/>
					<p class="text-xs text-gray-400 mt-1">
						<template v-if="newFilter.filterType === 'ip_address' || newFilter.filterType === 'release'">
							Exact match
						</template>
						<template v-else-if="newFilter.filterType === 'environment'">
							Case-insensitive exact match
						</template>
						<template v-else>
							Case-insensitive substring match
						</template>
					</p>
				</div>

				<div>
					<label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
						Description (optional)
					</label>
					<input
						v-model="newFilter.description"
						type="text"
						placeholder="Why this filter exists"
						class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
					/>
				</div>

				<div class="flex space-x-3">
					<button type="submit" class="btn btn-primary" :disabled="creating || !newFilter.pattern">
						<span v-if="creating">Creating...</span>
						<span v-else>Create Filter</span>
					</button>
					<button
						type="button"
						class="btn btn-secondary"
						@click="showCreateForm = false; newFilter = { filterType: 'message', pattern: '', description: '' }"
					>
						Cancel
					</button>
				</div>
			</form>
		</div>

		<!-- Loading -->
		<div v-if="loading" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
		</div>

		<!-- Filter list -->
		<div v-else-if="filters.length > 0" class="space-y-3">
			<div v-for="filter in filters" :key="filter.id" class="card p-4">
				<div class="flex items-start justify-between">
					<div class="flex-1 min-w-0">
						<div class="flex items-center space-x-2 mb-1">
							<span class="badge badge-info text-xs">
								{{ filterTypeLabels[filter.filterType] || filter.filterType }}
							</span>
							<code class="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">
								{{ filter.pattern }}
							</code>
						</div>
						<div v-if="filter.description" class="text-sm text-gray-500 mb-1">
							{{ filter.description }}
						</div>
						<div class="flex items-center space-x-4 text-xs text-gray-400">
							<span>{{ filter.droppedCount.toLocaleString() }} dropped</span>
							<span>Created {{ formatDate(filter.createdAt) }}</span>
						</div>
					</div>
					<div class="flex items-center space-x-2 ml-4">
						<button
							class="px-2 py-1 text-xs rounded"
							:class="
								filter.enabled
									? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
									: 'bg-gray-100 dark:bg-gray-700 text-gray-500'
							"
							@click="toggleFilter(filter.id, !filter.enabled)"
						>
							{{ filter.enabled ? 'Enabled' : 'Disabled' }}
						</button>
						<button
							class="px-2 py-1 text-xs text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/20 rounded"
							@click="deleteFilter(filter.id)"
						>
							Delete
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- Empty state -->
		<div v-else-if="!showCreateForm" class="text-center py-12">
			<p class="text-gray-500 mb-6">No filters configured yet.</p>
			<div class="space-y-3 max-w-md mx-auto">
				<p class="text-sm font-medium text-gray-700 dark:text-gray-300">Common filters:</p>
				<div
					v-for="suggestion in suggestions"
					:key="suggestion.pattern"
					class="card p-3 flex items-center justify-between"
				>
					<div class="text-left">
						<div class="text-sm font-medium text-gray-900 dark:text-white">
							{{ suggestion.description }}
						</div>
						<code class="text-xs text-gray-500">{{ suggestion.pattern }}</code>
					</div>
					<button
						class="btn btn-secondary text-xs"
						@click="applySuggestion(suggestion)"
					>
						Add
					</button>
				</div>
			</div>
		</div>
	</div>
</template>
