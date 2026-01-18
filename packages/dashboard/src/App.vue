<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { useAuthStore } from './stores/auth';

const authStore = useAuthStore();

onMounted(async () => {
	await authStore.checkAuth();
});
</script>

<template>
	<div class="min-h-screen bg-gray-50 dark:bg-gray-900">
		<RouterView />
	</div>
</template>
