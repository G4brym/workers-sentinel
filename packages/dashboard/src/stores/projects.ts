import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client';

export interface Project {
	id: string;
	name: string;
	slug: string;
	platform: string;
}

export const useProjectsStore = defineStore('projects', () => {
	const projects = ref<Project[]>([]);
	const loading = ref(false);
	const initialized = ref(false);

	async function loadProjects() {
		loading.value = true;
		try {
			const response = await api.get<{ projects: Project[] }>('/api/projects');
			projects.value = response.projects;
			initialized.value = true;
		} catch (err) {
			console.error('Failed to load projects:', err);
		} finally {
			loading.value = false;
		}
	}

	function addProject(project: Project) {
		projects.value = [...projects.value, project];
	}

	function removeProject(slug: string) {
		projects.value = projects.value.filter((p) => p.slug !== slug);
	}

	function reset() {
		projects.value = [];
		initialized.value = false;
	}

	return {
		projects,
		loading,
		initialized,
		loadProjects,
		addProject,
		removeProject,
		reset,
	};
});
