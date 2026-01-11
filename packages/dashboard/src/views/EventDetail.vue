<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { api } from '../api/client';

const route = useRoute();
const slug = computed(() => route.params.slug as string);
const eventId = computed(() => route.params.eventId as string);

const event = ref<Record<string, unknown> | null>(null);
const issueId = ref<string | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function loadEvent() {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.get<{ event: Record<string, unknown>; issueId: string }>(
			`/api/projects/${slug.value}/events/${eventId.value}`,
		);
		event.value = response.event;
		issueId.value = response.issueId;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load event';
	} finally {
		loading.value = false;
	}
}

onMounted(() => loadEvent());
</script>

<template>
	<div>
		<!-- Loading -->
		<div v-if="loading" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="bg-error-50 text-error-700 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<!-- Event detail -->
		<div v-else-if="event">
			<div class="mb-6">
				<div class="flex items-center space-x-2 text-sm text-gray-500 mb-2">
					<RouterLink :to="`/projects/${slug}/issues`" class="hover:text-gray-700">Issues</RouterLink>
					<span>/</span>
					<RouterLink v-if="issueId" :to="`/projects/${slug}/issues/${issueId}`" class="hover:text-gray-700">
						Issue
					</RouterLink>
					<span>/</span>
					<span>Event</span>
				</div>

				<h1 class="text-xl font-bold text-gray-900 dark:text-white">
					Event {{ eventId }}
				</h1>
			</div>

			<div class="card p-4">
				<pre class="text-xs font-mono overflow-x-auto whitespace-pre-wrap">{{ JSON.stringify(event, null, 2) }}</pre>
			</div>
		</div>
	</div>
</template>
