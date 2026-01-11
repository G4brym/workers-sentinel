import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
	history: createWebHistory(),
	routes: [
		{
			path: '/login',
			name: 'login',
			component: () => import('../views/Login.vue'),
			meta: { guest: true },
		},
		{
			path: '/register',
			name: 'register',
			component: () => import('../views/Register.vue'),
			meta: { guest: true },
		},
		{
			path: '/',
			component: () => import('../views/Layout.vue'),
			meta: { auth: true },
			children: [
				{
					path: '',
					redirect: '/projects',
				},
				{
					path: 'projects',
					name: 'projects',
					component: () => import('../views/Projects.vue'),
				},
				{
					path: 'projects/new',
					name: 'project-create',
					component: () => import('../views/ProjectCreate.vue'),
				},
				{
					path: 'projects/:slug',
					redirect: (to) => `/projects/${to.params.slug}/issues`,
				},
				{
					path: 'projects/:slug/issues',
					name: 'issues',
					component: () => import('../views/Issues.vue'),
				},
				{
					path: 'projects/:slug/issues/:issueId',
					name: 'issue-detail',
					component: () => import('../views/IssueDetail.vue'),
				},
				{
					path: 'projects/:slug/events/:eventId',
					name: 'event-detail',
					component: () => import('../views/EventDetail.vue'),
				},
				{
					path: 'projects/:slug/settings',
					name: 'project-settings',
					component: () => import('../views/ProjectSettings.vue'),
				},
			],
		},
	],
});

router.beforeEach(async (to, _from, next) => {
	const authStore = useAuthStore();

	// Wait for initial auth check
	if (!authStore.initialized) {
		await authStore.checkAuth();
	}

	const isAuthenticated = authStore.isAuthenticated;

	// Guest routes - redirect to home if authenticated
	if (to.meta.guest && isAuthenticated) {
		return next('/');
	}

	// Protected routes - redirect to login if not authenticated
	if (to.meta.auth && !isAuthenticated) {
		return next('/login');
	}

	next();
});

export default router;
