import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth';
import { adminRoutes } from './routes/admin';
import { authRoutes, tokenRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { ingestionRoutes } from './routes/ingestion';
import { issueRoutes } from './routes/issues';
import { memberRoutes } from './routes/members';
import { projectRoutes } from './routes/projects';
import { releaseRoutes } from './routes/releases';
import { sourcemapRoutes } from './routes/sourcemaps';
import type { AuthContext, Env } from './types';

// Re-export Durable Objects
export { AuthState } from './durable-objects/auth-state';
export { ProjectState } from './durable-objects/project-state';

// Re-export RPC entrypoint for service bindings
export { SentinelRpc } from './rpc';

type Variables = {
	auth?: AuthContext;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS for dashboard
app.use(
	'/api/*',
	cors({
		origin: '*',
		allowHeaders: ['Content-Type', 'Authorization'],
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		credentials: true,
	}),
);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public routes (no auth required)
app.route('/api/auth', authRoutes);

// API token management routes (session auth required)
app.use('/api/auth/tokens/*', authMiddleware);
app.use('/api/auth/tokens', authMiddleware);
app.route('/api/auth/tokens', tokenRoutes);

// Ingestion routes (DSN auth, not session auth)
app.route('/api', ingestionRoutes);

// Protected routes (session auth required)
app.use('/api/projects/*', authMiddleware);
app.route('/api/projects', projectRoutes);
app.route('/api/projects', memberRoutes);
app.route('/api/projects', issueRoutes);
app.route('/api/projects', eventRoutes);
app.route('/api/projects', releaseRoutes);
app.route('/api/projects', sourcemapRoutes);

// Admin routes (session auth required)
app.use('/api/admin/*', authMiddleware);
app.route('/api/admin', adminRoutes);

// Serve dashboard for all non-API routes
app.get('*', (c) => {
	// Assets binding handles static files
	return c.env.ASSETS?.fetch(c.req.raw) ?? c.text('Dashboard not found', 404);
});

export default app;

export function workersSentinel() {
	return app;
}
