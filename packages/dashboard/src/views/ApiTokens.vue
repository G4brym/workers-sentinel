<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';

interface ApiToken {
	id: string;
	userId: string;
	name: string;
	tokenPrefix: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
	createdAt: string;
}

const tokens = ref<ApiToken[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const newTokenName = ref('');
const newTokenExpiry = ref('');
const creating = ref(false);
const createdToken = ref<string | null>(null);
const copied = ref(false);

const revoking = ref<string | null>(null);

async function loadTokens() {
	loading.value = true;
	error.value = null;
	try {
		const response = await api.get<{ tokens: ApiToken[] }>('/api/auth/tokens');
		tokens.value = response.tokens;
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to load tokens';
	} finally {
		loading.value = false;
	}
}

async function createToken() {
	if (!newTokenName.value.trim()) return;

	creating.value = true;
	error.value = null;
	try {
		const body: { name: string; expiresAt?: string } = { name: newTokenName.value.trim() };
		if (newTokenExpiry.value) {
			body.expiresAt = new Date(newTokenExpiry.value).toISOString();
		}
		const response = await api.post<{ token: ApiToken; rawToken: string }>(
			'/api/auth/tokens',
			body,
		);
		createdToken.value = response.rawToken;
		tokens.value.unshift(response.token);
		newTokenName.value = '';
		newTokenExpiry.value = '';
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to create token';
	} finally {
		creating.value = false;
	}
}

async function revokeToken(tokenId: string) {
	if (!confirm('Are you sure you want to revoke this token? This cannot be undone.')) return;

	revoking.value = tokenId;
	error.value = null;
	try {
		await api.delete(`/api/auth/tokens/${tokenId}`);
		tokens.value = tokens.value.filter((t) => t.id !== tokenId);
	} catch (err) {
		error.value = err instanceof Error ? err.message : 'Failed to revoke token';
	} finally {
		revoking.value = null;
	}
}

function copyToken() {
	if (createdToken.value) {
		navigator.clipboard.writeText(createdToken.value);
		copied.value = true;
		setTimeout(() => {
			copied.value = false;
		}, 2000);
	}
}

function dismissCreatedToken() {
	createdToken.value = null;
	copied.value = false;
}

function formatDate(dateString: string): string {
	return new Date(dateString).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

function formatRelative(dateString: string | null): string {
	if (!dateString) return 'Never';
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return 'Just now';
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) return `${diffDays}d ago`;
	return formatDate(dateString);
}

function isExpired(expiresAt: string | null): boolean {
	if (!expiresAt) return false;
	return new Date(expiresAt) < new Date();
}

onMounted(() => loadTokens());
</script>

<template>
	<div class="max-w-2xl">
		<h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">API Tokens</h1>
		<p class="text-sm text-gray-500 mb-6">
			Create personal API tokens for programmatic access to the API. Tokens are shown only
			once on creation.
		</p>

		<!-- Error -->
		<div
			v-if="error"
			class="bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-400 px-4 py-3 rounded-lg mb-6"
		>
			{{ error }}
		</div>

		<!-- Create token form -->
		<div class="card p-6 mb-6">
			<h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
				Create New Token
			</h2>

			<div class="space-y-3">
				<div>
					<label
						class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
					>
						Token Name
					</label>
					<input
						v-model="newTokenName"
						type="text"
						placeholder="e.g. CI/CD Pipeline, Monitoring Script"
						class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
					/>
				</div>

				<div>
					<label
						class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
					>
						Expiration (optional)
					</label>
					<input
						v-model="newTokenExpiry"
						type="date"
						:min="new Date().toISOString().split('T')[0]"
						class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
					/>
				</div>

				<button
					class="btn btn-primary"
					:disabled="creating || !newTokenName.trim()"
					@click="createToken"
				>
					<span v-if="creating">Creating...</span>
					<span v-else>Create Token</span>
				</button>
			</div>
		</div>

		<!-- Newly created token display -->
		<div
			v-if="createdToken"
			class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-6 mb-6"
		>
			<h3 class="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">
				Make sure to copy this token. You won't be able to see it again.
			</h3>

			<div class="flex items-center space-x-2 mb-3">
				<code
					class="flex-1 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg text-sm font-mono break-all text-gray-900 dark:text-gray-100 border border-amber-200 dark:border-amber-700"
				>
					{{ createdToken }}
				</code>
				<button @click="copyToken" class="btn btn-secondary" title="Copy to clipboard">
					<span v-if="copied">Copied!</span>
					<span v-else>
						<svg
							class="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
							/>
						</svg>
					</span>
				</button>
			</div>

			<button
				class="text-sm text-amber-700 dark:text-amber-300 underline"
				@click="dismissCreatedToken"
			>
				I've copied the token
			</button>
		</div>

		<!-- Loading -->
		<div v-if="loading" class="text-center py-12">
			<div
				class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"
			></div>
		</div>

		<!-- Token list -->
		<div v-else-if="tokens.length > 0" class="card overflow-hidden">
			<table class="w-full">
				<thead>
					<tr
						class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
					>
						<th
							class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3"
						>
							Name
						</th>
						<th
							class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3"
						>
							Token
						</th>
						<th
							class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3"
						>
							Last Used
						</th>
						<th
							class="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3"
						>
							Expires
						</th>
						<th
							class="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3"
						>
							Actions
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="token in tokens"
						:key="token.id"
						class="border-b border-gray-200 dark:border-gray-700 last:border-b-0"
					>
						<td class="px-4 py-3">
							<span class="text-sm font-medium text-gray-900 dark:text-white">
								{{ token.name }}
							</span>
						</td>
						<td class="px-4 py-3">
							<code
								class="text-sm font-mono text-gray-600 dark:text-gray-400"
							>
								{{ token.tokenPrefix }}...
							</code>
						</td>
						<td class="px-4 py-3">
							<span class="text-sm text-gray-500">
								{{ formatRelative(token.lastUsedAt) }}
							</span>
						</td>
						<td class="px-4 py-3">
							<span
								v-if="!token.expiresAt"
								class="text-sm text-gray-500"
							>
								Never
							</span>
							<span
								v-else-if="isExpired(token.expiresAt)"
								class="text-sm text-error-600 dark:text-error-400"
							>
								Expired
							</span>
							<span v-else class="text-sm text-gray-500">
								{{ formatDate(token.expiresAt) }}
							</span>
						</td>
						<td class="px-4 py-3 text-right">
							<button
								class="text-sm text-error-600 dark:text-error-400 hover:text-error-800 dark:hover:text-error-300"
								:disabled="revoking === token.id"
								@click="revokeToken(token.id)"
							>
								<span v-if="revoking === token.id">Revoking...</span>
								<span v-else>Revoke</span>
							</button>
						</td>
					</tr>
				</tbody>
			</table>
		</div>

		<!-- Empty state -->
		<div
			v-else-if="!loading"
			class="text-center py-12 text-gray-500 dark:text-gray-400"
		>
			<p class="text-lg mb-2">No API tokens yet</p>
			<p class="text-sm">
				Create a token above to get started with programmatic API access.
			</p>
		</div>
	</div>
</template>
