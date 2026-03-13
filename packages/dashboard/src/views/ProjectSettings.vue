<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProjectsStore } from '../stores/projects';

interface Project {
	id: string;
	name: string;
	slug: string;
	platform: string;
	publicKey: string;
	webhookUrl?: string | null;
	createdAt: string;
}

interface ProjectMember {
	userId: string;
	email: string;
	name: string;
	role: 'owner' | 'admin' | 'member';
	createdAt: string;
}

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const projectsStore = useProjectsStore();
const slug = computed(() => route.params.slug as string);

const project = ref<Project | null>(null);
const dsn = ref<string>('');
const loading = ref(true);
const error = ref<string | null>(null);
const deleting = ref(false);
const showDeleteConfirm = ref(false);
const webhookUrl = ref<string>('');
const savingWebhook = ref(false);
const webhookSaved = ref(false);
const testingWebhook = ref(false);
const webhookTested = ref(false);
const maxEventsPerHour = ref<number>(0);
const rateLimitStatus = ref<{ currentHourCount: number; isLimited: boolean } | null>(null);
const savingConfig = ref(false);
const configSaved = ref(false);
const retentionDays = ref<number>(0);
const savingRetention = ref(false);
const retentionSaved = ref(false);

// Members state
const members = ref<ProjectMember[]>([]);
const membersLoading = ref(false);
const membersError = ref<string | null>(null);
const newMemberEmail = ref('');
const newMemberRole = ref<'admin' | 'member'>('member');
const addingMember = ref(false);
const showRemoveConfirm = ref<string | null>(null);
const removingMember = ref(false);

const currentUserRole = computed(() => {
	if (!authStore.user) return null;
	const me = members.value.find((m) => m.userId === authStore.user!.id);
	return me?.role || null;
});

const canManageMembers = computed(() => {
	return currentUserRole.value === 'owner' || currentUserRole.value === 'admin';
});

async function loadProject() {
	loading.value = true;
	error.value = null;

	try {
		const response = await api.get<{ project: Project; dsn: string }>(
			`/api/projects/${slug.value}`,
		);
		project.value = response.project;
		dsn.value = response.dsn;
		webhookUrl.value = response.project.webhookUrl || '';

		const settingsResponse = await api.get<{ retentionDays: number }>(
			`/api/projects/${slug.value}/settings`,
		);
		retentionDays.value = settingsResponse.retentionDays;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load project';
	} finally {
		loading.value = false;
	}
}

async function loadMembers() {
	membersLoading.value = true;
	membersError.value = null;

	try {
		const response = await api.get<{ members: ProjectMember[] }>(
			`/api/projects/${slug.value}/members`,
		);
		members.value = response.members;
	} catch (err) {
		membersError.value = err instanceof Error ? err.message : 'Failed to load members';
	} finally {
		membersLoading.value = false;
	}
}

async function addMember() {
	if (!newMemberEmail.value) return;

	addingMember.value = true;
	membersError.value = null;

	try {
		await api.post(`/api/projects/${slug.value}/members`, {
			email: newMemberEmail.value,
			role: newMemberRole.value,
		});
		newMemberEmail.value = '';
		newMemberRole.value = 'member';
		await loadMembers();
	} catch (err) {
		if (err instanceof ApiError) {
			membersError.value = err.message;
		} else {
			membersError.value = err instanceof Error ? err.message : 'Failed to add member';
		}
	} finally {
		addingMember.value = false;
	}
}

async function updateMemberRole(userId: string, role: string) {
	membersError.value = null;
	try {
		await api.patch(`/api/projects/${slug.value}/members/${userId}`, { role });
		await loadMembers();
	} catch (err) {
		membersError.value = err instanceof Error ? err.message : 'Failed to update member role';
	}
}

async function removeMember(userId: string) {
	removingMember.value = true;
	membersError.value = null;
	try {
		await api.delete(`/api/projects/${slug.value}/members/${userId}`);
		showRemoveConfirm.value = null;
		await loadMembers();
	} catch (err) {
		membersError.value = err instanceof Error ? err.message : 'Failed to remove member';
	} finally {
		removingMember.value = false;
	}
}

async function deleteProject() {
	if (!project.value) return;

	deleting.value = true;
	try {
		await api.delete(`/api/projects/${slug.value}`);
		// Remove project from store so sidebar updates
		projectsStore.removeProject(slug.value);
		router.push('/projects');
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to delete project';
		deleting.value = false;
	}
}

async function saveWebhook() {
	savingWebhook.value = true;
	webhookSaved.value = false;
	try {
		await api.patch(`/api/projects/${slug.value}`, {
			webhookUrl: webhookUrl.value || null,
		});
		webhookSaved.value = true;
		setTimeout(() => {
			webhookSaved.value = false;
		}, 3000);
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to save webhook';
	} finally {
		savingWebhook.value = false;
	}
}

async function testWebhook() {
	if (!webhookUrl.value) return;
	testingWebhook.value = true;
	webhookTested.value = false;
	try {
		await api.post(`/api/projects/${slug.value}/test-webhook`, {});
		webhookTested.value = true;
		setTimeout(() => {
			webhookTested.value = false;
		}, 3000);
	} catch (err) {
		error.value =
			err instanceof Error
				? err.message
				: 'Failed to send test webhook. Check the URL and try again.';
	} finally {
		testingWebhook.value = false;
	}
}

async function loadRateLimitStatus() {
	try {
		const response = await api.get<{
			maxEventsPerHour: number;
			currentHourCount: number;
			isLimited: boolean;
		}>(`/api/projects/${slug.value}/rate-limit`);
		maxEventsPerHour.value = response.maxEventsPerHour;
		rateLimitStatus.value = response;
	} catch {
		/* ignore */
	}
}

async function saveRateLimit() {
	savingConfig.value = true;
	configSaved.value = false;
	try {
		await api.patch(`/api/projects/${slug.value}`, {
			maxEventsPerHour: maxEventsPerHour.value,
		});
		configSaved.value = true;
		await loadRateLimitStatus();
		setTimeout(() => {
			configSaved.value = false;
		}, 3000);
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to save';
	} finally {
		savingConfig.value = false;
	}
}

async function saveRetention() {
	savingRetention.value = true;
	retentionSaved.value = false;
	try {
		await api.patch(`/api/projects/${slug.value}`, {
			retentionDays: retentionDays.value,
		});
		retentionSaved.value = true;
		setTimeout(() => {
			retentionSaved.value = false;
		}, 3000);
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to save settings';
	} finally {
		savingRetention.value = false;
	}
}

function copyDsn() {
	navigator.clipboard.writeText(dsn.value);
}

function formatDate(dateString: string): string {
	return new Date(dateString).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

onMounted(() => {
	loadProject();
	loadRateLimitStatus();
	loadMembers();
});
</script>

<template>
	<div class="max-w-2xl">
		<!-- Loading -->
		<div v-if="loading" class="text-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
		</div>

		<!-- Error -->
		<div v-else-if="error" class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg">
			{{ error }}
		</div>

		<!-- Settings -->
		<div v-else-if="project" class="space-y-6">
			<h1 class="text-2xl font-bold text-gray-900 dark:text-white">Project Settings</h1>

			<!-- DSN -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Client Keys (DSN)</h2>
				<p class="text-sm text-gray-500 mb-4">
					Use this DSN to configure your Sentry SDK.
				</p>

				<div class="flex items-center space-x-2">
					<code class="flex-1 bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-lg text-sm font-mono break-all text-gray-900 dark:text-gray-100">
						{{ dsn }}
					</code>
					<button @click="copyDsn" class="btn btn-secondary" title="Copy to clipboard">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
							/>
						</svg>
					</button>
				</div>
			</div>

			<!-- Project info -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Project Information</h2>

				<dl class="space-y-4">
					<div>
						<dt class="text-sm text-gray-500">Name</dt>
						<dd class="text-gray-900 dark:text-white">{{ project.name }}</dd>
					</div>
					<div>
						<dt class="text-sm text-gray-500">Slug</dt>
						<dd class="text-gray-900 dark:text-white font-mono">{{ project.slug }}</dd>
					</div>
					<div>
						<dt class="text-sm text-gray-500">Platform</dt>
						<dd class="text-gray-900 dark:text-white">{{ project.platform }}</dd>
					</div>
					<div>
						<dt class="text-sm text-gray-500">Created</dt>
						<dd class="text-gray-900 dark:text-white">{{ formatDate(project.createdAt) }}</dd>
					</div>
					<div>
						<dt class="text-sm text-gray-500">Project ID</dt>
						<dd class="text-gray-900 dark:text-white font-mono text-sm">{{ project.id }}</dd>
					</div>
				</dl>
			</div>

			<!-- Team Members -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Team Members</h2>
				<p class="text-sm text-gray-500 mb-4">
					Manage who has access to this project and their roles.
				</p>

				<!-- Members error -->
				<div
					v-if="membersError"
					class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg mb-4"
				>
					{{ membersError }}
				</div>

				<!-- Members loading -->
				<div v-if="membersLoading && members.length === 0" class="text-center py-4">
					<div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
				</div>

				<!-- Members list -->
				<div v-else class="space-y-3 mb-4">
					<div
						v-for="member in members"
						:key="member.userId"
						class="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
					>
						<div class="flex items-center space-x-3 min-w-0">
							<div class="min-w-0">
								<div class="text-sm font-medium text-gray-900 dark:text-white truncate">
									{{ member.name }}
								</div>
								<div class="text-xs text-gray-500 truncate">{{ member.email }}</div>
							</div>
						</div>

						<div class="flex items-center space-x-2 flex-shrink-0">
							<!-- Owner badge (non-editable) -->
							<span
								v-if="member.role === 'owner'"
								class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
							>
								Owner
							</span>

							<!-- Role dropdown for non-owners (only if current user can manage) -->
							<template v-else>
								<select
									v-if="canManageMembers"
									:value="member.role"
									class="text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-gray-900 dark:text-gray-100"
									@change="updateMemberRole(member.userId, ($event.target as HTMLSelectElement).value)"
								>
									<option value="admin">Admin</option>
									<option value="member">Member</option>
								</select>
								<span
									v-else
									class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300"
								>
									{{ member.role === 'admin' ? 'Admin' : 'Member' }}
								</span>

								<!-- Remove button -->
								<button
									v-if="canManageMembers"
									class="text-gray-400 hover:text-error-600 dark:hover:text-error-400 p-1"
									title="Remove member"
									@click="showRemoveConfirm = member.userId"
								>
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</template>
						</div>
					</div>

					<div v-if="members.length === 0 && !membersLoading" class="text-sm text-gray-500 text-center py-4">
						No members found.
					</div>
				</div>

				<!-- Add member form (only for owner/admin) -->
				<div v-if="canManageMembers" class="border-t border-gray-200 dark:border-gray-600 pt-4">
					<h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Add Member</h3>
					<div class="flex items-end space-x-2">
						<div class="flex-1">
							<label class="block text-xs text-gray-500 mb-1">Email</label>
							<input
								v-model="newMemberEmail"
								type="email"
								placeholder="user@example.com"
								class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
								@keydown.enter="addMember"
							/>
						</div>
						<div>
							<label class="block text-xs text-gray-500 mb-1">Role</label>
							<select
								v-model="newMemberRole"
								class="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100"
							>
								<option value="member">Member</option>
								<option value="admin">Admin</option>
							</select>
						</div>
						<button
							class="btn btn-primary"
							:disabled="addingMember || !newMemberEmail"
							@click="addMember"
						>
							<span v-if="addingMember">Adding...</span>
							<span v-else>Add</span>
						</button>
					</div>
				</div>
			</div>

			<!-- Webhook Notifications -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Webhook Notifications</h2>
				<p class="text-sm text-gray-500 mb-4">
					Receive a POST request when a new issue is detected. Works with Slack Incoming Webhooks, Discord Webhooks, or any HTTP endpoint.
				</p>

				<div class="space-y-3">
					<div>
						<label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Webhook URL</label>
						<input
							v-model="webhookUrl"
							type="url"
							placeholder="https://hooks.slack.com/services/..."
							class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
						/>
					</div>

					<div class="flex items-center space-x-3">
						<button
							class="btn btn-primary"
							:disabled="savingWebhook"
							@click="saveWebhook"
						>
							<span v-if="savingWebhook">Saving...</span>
							<span v-else-if="webhookSaved">Saved!</span>
							<span v-else>Save</span>
						</button>
						<button
							v-if="webhookUrl"
							class="btn btn-secondary"
							:disabled="testingWebhook"
							@click="testWebhook"
						>
							<span v-if="testingWebhook">Sending...</span>
							<span v-else-if="webhookTested">Sent!</span>
							<span v-else>Send Test</span>
						</button>
					</div>
				</div>
			</div>

			<!-- Rate Limiting -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Rate Limiting</h2>
				<p class="text-sm text-gray-500 mb-4">
					Limit the number of events this project can receive per hour. Set to 0 for unlimited.
				</p>

				<div class="space-y-4">
					<div>
						<label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
							Max events per hour
						</label>
						<div class="flex items-center space-x-3">
							<input
								v-model.number="maxEventsPerHour"
								type="number"
								min="0"
								step="100"
								class="w-48 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
								placeholder="0 (unlimited)"
							/>
							<button
								class="btn btn-primary"
								:disabled="savingConfig"
								@click="saveRateLimit"
							>
								<span v-if="savingConfig">Saving...</span>
								<span v-else-if="configSaved">Saved!</span>
								<span v-else>Save</span>
							</button>
						</div>
					</div>

					<!-- Current usage display -->
					<div v-if="rateLimitStatus && maxEventsPerHour > 0" class="text-sm">
						<div class="flex items-center space-x-2">
							<span class="text-gray-500">Current hour:</span>
							<span :class="rateLimitStatus.isLimited ? 'text-error-600 font-medium' : 'text-gray-900 dark:text-white'">
								{{ rateLimitStatus.currentHourCount.toLocaleString() }} / {{ maxEventsPerHour.toLocaleString() }}
							</span>
							<span v-if="rateLimitStatus.isLimited" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-error-100 text-error-800 dark:bg-error-900/30 dark:text-error-400">
								Rate limited
							</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Data Retention -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Data Retention</h2>
				<p class="text-sm text-gray-500 mb-4">
					Configure how long event data is kept. Older events, stats, and empty issues will be automatically deleted.
				</p>

				<div class="flex items-center space-x-4">
					<select v-model.number="retentionDays" class="input w-auto">
						<option :value="0">Keep forever</option>
						<option :value="7">7 days</option>
						<option :value="30">30 days</option>
						<option :value="90">90 days</option>
						<option :value="180">180 days</option>
						<option :value="365">1 year</option>
					</select>
					<button
						class="btn btn-primary"
						:disabled="savingRetention"
						@click="saveRetention"
					>
						{{ savingRetention ? 'Saving...' : 'Save' }}
					</button>
					<span v-if="retentionSaved" class="text-sm text-green-600 dark:text-green-400">Saved!</span>
				</div>
			</div>

			<!-- API Tokens -->
			<div class="card p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">API Tokens</h2>
				<p class="text-sm text-gray-500 mb-4">
					Create personal API tokens for programmatic access to the API.
				</p>
				<router-link to="/settings/tokens" class="btn btn-secondary">
					Manage API Tokens
				</router-link>
			</div>

			<!-- Danger zone -->
			<div class="card border-error-200 dark:border-error-800">
				<div class="p-6 border-b border-error-200 dark:border-error-800">
					<h2 class="text-lg font-semibold text-error-600 dark:text-error-400">Danger Zone</h2>
				</div>
				<div class="p-6">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-sm font-medium text-gray-900 dark:text-white">Delete this project</h3>
							<p class="text-sm text-gray-500">
								Once you delete a project, there is no going back. All data will be permanently deleted.
							</p>
						</div>
						<button
							class="btn btn-danger"
							@click="showDeleteConfirm = true"
						>
							Delete Project
						</button>
					</div>
				</div>
			</div>

			<!-- Delete confirmation modal -->
			<div
				v-if="showDeleteConfirm"
				class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
				@click.self="showDeleteConfirm = false"
			>
				<div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4">
					<h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
						Delete "{{ project.name }}"?
					</h3>
					<p class="text-sm text-gray-500 mb-6">
						This action cannot be undone. All issues, events, and settings for this project will be permanently deleted.
					</p>
					<div class="flex justify-end space-x-3">
						<button
							class="btn btn-secondary"
							@click="showDeleteConfirm = false"
						>
							Cancel
						</button>
						<button
							class="btn btn-danger"
							:disabled="deleting"
							@click="deleteProject"
						>
							<span v-if="deleting">Deleting...</span>
							<span v-else>Delete Project</span>
						</button>
					</div>
				</div>
			</div>

			<!-- Remove member confirmation modal -->
			<div
				v-if="showRemoveConfirm"
				class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
				@click.self="showRemoveConfirm = null"
			>
				<div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4">
					<h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
						Remove member?
					</h3>
					<p class="text-sm text-gray-500 mb-6">
						This user will lose access to this project. They can be re-added later.
					</p>
					<div class="flex justify-end space-x-3">
						<button
							class="btn btn-secondary"
							@click="showRemoveConfirm = null"
						>
							Cancel
						</button>
						<button
							class="btn btn-danger"
							:disabled="removingMember"
							@click="removeMember(showRemoveConfirm!)"
						>
							<span v-if="removingMember">Removing...</span>
							<span v-else>Remove</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
