import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { ingestionRoutes } from './routes/ingestion';
import { issueRoutes } from './routes/issues';
import { projectRoutes } from './routes/projects';
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

// Ingestion routes (DSN auth, not session auth)
app.route('/api', ingestionRoutes);

// Protected routes (session auth required)
app.use('/api/projects/*', authMiddleware);
app.route('/api/projects', projectRoutes);
app.route('/api/projects', issueRoutes);
app.route('/api/projects', eventRoutes);

// Serve dashboard for all non-API routes
app.get('*', (c) => {
	// Assets binding handles static files
	return c.env.ASSETS?.fetch(c.req.raw) ?? c.text('Dashboard not found', 404);
});

export function workersSentinel() {
	return app
}
