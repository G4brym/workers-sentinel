<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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

interface StackFrame {
	filename?: string;
	function?: string;
	lineno?: number;
	colno?: number;
	context_line?: string;
	pre_context?: string[];
	post_context?: string[];
	in_app?: boolean;
}

interface Event {
	event_id: string;
	timestamp: string;
	level: string;
	platform: string;
	environment?: string;
	release?: string;
	tags?: Record<string, string>;
	user?: {
		id?: string;
		email?: string;
		ip_address?: string;
	};
	exception?: {
		values: Array<{
			type: string;
			value: string;
			stacktrace?: {
				frames: StackFrame[];
			};
		}>;
	};
	breadcrumbs?: Array<{
		type?: string;
		category?: string;
		message?: string;
		level?: string;
		timestamp?: string;
	}>;
}

const route = useRoute();
const slug = computed(() => route.params.slug as string);
const issueId = computed(() => route.params.issueId as string);

const issue = ref<Issue | null>(null);
const events = ref<Event[]>([]);
const selectedEvent = ref<Event | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const expandedFrames = ref<Set<number>>(new Set());

async function loadIssue() {
	loading.value = true;
	error.value = null;

	try {
		const [issueResponse, eventsResponse] = await Promise.all([
			api.get<{ issue: Issue }>(`/api/projects/${slug.value}/issues/${issueId.value}`),
			api.get<{ events: Event[] }>(
				`/api/projects/${slug.value}/issues/${issueId.value}/events?limit=10`,
			),
		]);

		issue.value = issueResponse.issue;
		events.value = eventsResponse.events;
		selectedEvent.value = eventsResponse.events[0] || null;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load issue';
	} finally {
		loading.value = false;
	}
}

async function updateStatus(newStatus: string) {
	if (!issue.value) return;

	try {
		await api.patch(`/api/projects/${slug.value}/issues/${issueId.value}`, { status: newStatus });
		issue.value.status = newStatus;
	} catch (err) {
		console.error('Failed to update status:', err);
	}
}

function formatTime(dateString: string): string {
	return new Date(dateString).toLocaleString();
}

function toggleFrame(index: number) {
	if (expandedFrames.value.has(index)) {
		expandedFrames.value.delete(index);
	} else {
		expandedFrames.value.add(index);
	}
}

function getStackFrames(): StackFrame[] {
	const exc = selectedEvent.value?.exception?.values?.[0];
	if (!exc?.stacktrace?.frames) return [];
	return [...exc.stacktrace.frames].reverse();
}

function getLevelClass(level: string): string {
	switch (level) {
		case 'fatal':
		case 'error':
			return 'text-error-600 dark:text-error-400';
		case 'warning':
			return 'text-warning-600 dark:text-warning-400';
		default:
			return 'text-primary-600 dark:text-primary-400';
	}
}

onMounted(() => loadIssue());
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

		<!-- Issue detail -->
		<div v-else-if="issue && selectedEvent">
			<!-- Header -->
			<div class="mb-6">
				<div class="flex items-center space-x-2 text-sm text-gray-500 mb-2">
					<RouterLink :to="`/projects/${slug}/issues`" class="hover:text-gray-700">
						Issues
					</RouterLink>
					<span>/</span>
					<span>{{ issue.metadata.type }}</span>
				</div>

				<h1 class="text-xl font-bold text-gray-900 dark:text-white mb-2">
					<span :class="getLevelClass(issue.level)">{{ issue.metadata.type }}:</span>
					{{ issue.metadata.value }}
				</h1>

				<p v-if="issue.culprit" class="text-sm text-gray-500">{{ issue.culprit }}</p>
			</div>

			<!-- Actions and stats -->
			<div class="flex items-center justify-between mb-6">
				<div class="flex items-center space-x-4">
					<button
						v-if="issue.status !== 'resolved'"
						class="btn btn-secondary"
						@click="updateStatus('resolved')"
					>
						Resolve
					</button>
					<button
						v-if="issue.status !== 'ignored'"
						class="btn btn-secondary"
						@click="updateStatus('ignored')"
					>
						Ignore
					</button>
					<button
						v-if="issue.status !== 'unresolved'"
						class="btn btn-secondary"
						@click="updateStatus('unresolved')"
					>
						Reopen
					</button>
				</div>

				<div class="flex items-center space-x-6 text-sm text-gray-500">
					<div>
						<span class="font-medium text-gray-900 dark:text-white">{{ issue.count.toLocaleString() }}</span>
						events
					</div>
					<div v-if="issue.userCount > 0">
						<span class="font-medium text-gray-900 dark:text-white">{{ issue.userCount.toLocaleString() }}</span>
						users
					</div>
					<div>
						First seen <span class="font-medium text-gray-900 dark:text-white">{{ formatTime(issue.firstSeen) }}</span>
					</div>
				</div>
			</div>

			<!-- Event selector -->
			<div v-if="events.length > 1" class="mb-4">
				<label class="label">Event</label>
				<select
					class="input w-auto"
					:value="selectedEvent.event_id"
					@change="selectedEvent = events.find(e => e.event_id === ($event.target as HTMLSelectElement).value) || null"
				>
					<option v-for="event in events" :key="event.event_id" :value="event.event_id">
						{{ formatTime(event.timestamp) }}
						<span v-if="event.environment"> - {{ event.environment }}</span>
					</option>
				</select>
			</div>

			<!-- Event details -->
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<!-- Stack trace -->
				<div class="lg:col-span-2 space-y-4">
					<!-- Exception -->
					<div class="card">
						<div class="p-4 border-b border-gray-200 dark:border-gray-700">
							<h2 class="font-semibold text-gray-900 dark:text-white">Stack Trace</h2>
						</div>

						<div v-if="getStackFrames().length === 0" class="p-4 text-gray-500">
							No stack trace available
						</div>

						<div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
							<div
								v-for="(frame, index) in getStackFrames()"
								:key="index"
								class="group"
							>
								<button
									class="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
									@click="toggleFrame(index)"
								>
									<div class="flex items-start justify-between">
										<div class="flex-1 min-w-0">
											<div class="flex items-center space-x-2">
												<span
													v-if="frame.in_app !== false"
													class="w-2 h-2 bg-primary-500 rounded-full"
													title="In-app frame"
												></span>
												<span
													v-else
													class="w-2 h-2 bg-gray-300 rounded-full"
													title="System frame"
												></span>
												<code class="text-sm font-medium text-gray-900 dark:text-white truncate">
													{{ frame.function || '(anonymous)' }}
												</code>
											</div>
											<p class="text-xs text-gray-500 mt-1 truncate">
												{{ frame.filename }}
												<span v-if="frame.lineno">:{{ frame.lineno }}</span>
												<span v-if="frame.colno">:{{ frame.colno }}</span>
											</p>
										</div>
										<svg
											class="w-5 h-5 text-gray-400 transition-transform"
											:class="{ 'rotate-180': expandedFrames.has(index) }"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
										</svg>
									</div>
								</button>

								<!-- Context -->
								<div v-if="expandedFrames.has(index) && (frame.context_line || frame.pre_context || frame.post_context)" class="bg-gray-900 p-4">
									<pre class="text-xs font-mono overflow-x-auto"><template v-if="frame.pre_context"><code v-for="(line, i) in frame.pre_context" :key="'pre-'+i" class="block text-gray-500">{{ (frame.lineno || 0) - frame.pre_context.length + i }} {{ line }}</code></template><code v-if="frame.context_line" class="block text-white bg-error-900/50 -mx-4 px-4">{{ frame.lineno }} {{ frame.context_line }}</code><template v-if="frame.post_context"><code v-for="(line, i) in frame.post_context" :key="'post-'+i" class="block text-gray-500">{{ (frame.lineno || 0) + i + 1 }} {{ line }}</code></template></pre>
								</div>
							</div>
						</div>
					</div>

					<!-- Breadcrumbs -->
					<div v-if="selectedEvent.breadcrumbs?.length" class="card">
						<div class="p-4 border-b border-gray-200 dark:border-gray-700">
							<h2 class="font-semibold text-gray-900 dark:text-white">Breadcrumbs</h2>
						</div>
						<div class="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
							<div
								v-for="(crumb, index) in selectedEvent.breadcrumbs"
								:key="index"
								class="p-3 text-sm"
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center space-x-2">
										<span class="badge badge-info">{{ crumb.category || crumb.type || 'default' }}</span>
										<span class="text-gray-900 dark:text-white">{{ crumb.message }}</span>
									</div>
									<span v-if="crumb.timestamp" class="text-xs text-gray-400">
										{{ new Date(crumb.timestamp).toLocaleTimeString() }}
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Sidebar -->
				<div class="space-y-4">
					<!-- Event info -->
					<div class="card p-4">
						<h3 class="font-semibold text-gray-900 dark:text-white mb-3">Event Info</h3>
						<dl class="space-y-2 text-sm">
							<div>
								<dt class="text-gray-500">Event ID</dt>
								<dd class="text-gray-900 dark:text-white font-mono text-xs">{{ selectedEvent.event_id }}</dd>
							</div>
							<div>
								<dt class="text-gray-500">Timestamp</dt>
								<dd class="text-gray-900 dark:text-white">{{ formatTime(selectedEvent.timestamp) }}</dd>
							</div>
							<div v-if="selectedEvent.environment">
								<dt class="text-gray-500">Environment</dt>
								<dd class="text-gray-900 dark:text-white">{{ selectedEvent.environment }}</dd>
							</div>
							<div v-if="selectedEvent.release">
								<dt class="text-gray-500">Release</dt>
								<dd class="text-gray-900 dark:text-white font-mono text-xs">{{ selectedEvent.release }}</dd>
							</div>
						</dl>
					</div>

					<!-- User -->
					<div v-if="selectedEvent.user" class="card p-4">
						<h3 class="font-semibold text-gray-900 dark:text-white mb-3">User</h3>
						<dl class="space-y-2 text-sm">
							<div v-if="selectedEvent.user.id">
								<dt class="text-gray-500">ID</dt>
								<dd class="text-gray-900 dark:text-white font-mono text-xs">{{ selectedEvent.user.id }}</dd>
							</div>
							<div v-if="selectedEvent.user.email">
								<dt class="text-gray-500">Email</dt>
								<dd class="text-gray-900 dark:text-white">{{ selectedEvent.user.email }}</dd>
							</div>
							<div v-if="selectedEvent.user.ip_address">
								<dt class="text-gray-500">IP Address</dt>
								<dd class="text-gray-900 dark:text-white font-mono">{{ selectedEvent.user.ip_address }}</dd>
							</div>
						</dl>
					</div>

					<!-- Tags -->
					<div v-if="selectedEvent.tags && Object.keys(selectedEvent.tags).length > 0" class="card p-4">
						<h3 class="font-semibold text-gray-900 dark:text-white mb-3">Tags</h3>
						<div class="flex flex-wrap gap-2">
							<span
								v-for="(value, key) in selectedEvent.tags"
								:key="key"
								class="inline-flex items-center px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs"
							>
								<span class="text-gray-500">{{ key }}:</span>
								<span class="ml-1 text-gray-900 dark:text-white">{{ value }}</span>
							</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
