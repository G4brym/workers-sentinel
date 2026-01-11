# Workers Sentinel - Claude Code Context

## Commands

```bash
# Development
pnpm dev                    # Start worker dev server (wrangler dev)
pnpm test                   # Run tests once
pnpm test:watch             # Run tests in watch mode

# From root
pnpm build                  # Build dashboard + worker
pnpm deploy                 # Build and deploy to Cloudflare
pnpm lint                   # Check with Biome
pnpm lint:fix               # Auto-fix lint issues
pnpm typecheck              # Type check all packages
```

## Architecture

### Monorepo Structure
- `packages/workers-sentinel/` - Cloudflare Worker (Hono framework)
- `packages/dashboard/` - Vue 3 + Pinia + Tailwind CSS frontend

### Durable Objects with SQLite

**AuthState** (singleton via `idFromName('global')`)
- Tables: `users`, `sessions`, `projects`, `project_members`
- Handles: registration, login, session validation, project CRUD
- All user/project data lives here

**ProjectState** (per-project via `idFromName(projectId)`)
- Tables: `issues`, `events`, `issue_stats`, `issue_users`
- Handles: event ingestion, issue grouping, stats
- Each project has its own isolated DO instance

### Route Structure (src/index.ts)
```
/api/auth/*                  # Public - registration, login, logout
/api/:projectId/envelope/    # Public - Sentry SDK ingestion endpoint
/api/projects/*              # Protected - requires auth middleware
/api/health                  # Public - health check
```

### Event Ingestion Flow
1. SDK sends envelope to `/api/:projectId/envelope/`
2. `envelope-parser.ts` extracts DSN, validates auth, parses items
3. `fingerprint.ts` generates issue grouping key:
   - Priority: explicit fingerprint > exception type+message+frames > message > event_id
4. ProjectState DO stores event and updates issue stats

## Testing Notes

Tests use `@cloudflare/vitest-pool-workers` with `isolatedStorage: false` and `singleWorker: true` to allow state persistence across tests within a describe block.

DO operations may fail with "invalidating this Durable Object" error during test restarts - test utilities include retry logic for this.

## Code Style (Biome)
- Tabs for indentation
- Single quotes
- Semicolons required
- 100 character line width
