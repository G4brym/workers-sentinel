# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Workers Sentinel is a self-hosted, Sentry-compatible error tracking system running entirely on Cloudflare Workers. It accepts events from Sentry SDKs via the envelope protocol and stores them in SQLite-backed Durable Objects.

## Commands

```bash
# Development - runs worker with wrangler dev
pnpm dev

# Build dashboard then worker
pnpm build

# Deploy to Cloudflare
pnpm deploy

# Lint with Biome
pnpm lint
pnpm lint:fix

# Format
pnpm format

# Typecheck all packages
pnpm typecheck

# Dashboard-specific
pnpm --filter @workers-sentinel/dashboard dev      # Vite dev server
pnpm --filter @workers-sentinel/dashboard build    # Production build

# Worker-specific
pnpm --filter @workers-sentinel/worker dev         # Wrangler dev
pnpm --filter @workers-sentinel/worker typecheck   # TypeScript check
```

## Architecture

### Monorepo Structure

- `packages/workers-sentinel/` - Cloudflare Worker (Hono framework)
- `packages/dashboard/` - Vue.js 3 frontend (served as static assets)

### Durable Objects

Two SQLite-backed Durable Objects handle all state:

**AuthState** (singleton, named "global"):
- `users`, `sessions`, `projects`, `project_members` tables
- Handles registration, login, session validation, project registry
- All requests go through `http://internal/*` fetch pattern

**ProjectState** (per-project, named by project ID):
- `issues`, `events`, `issue_stats`, `issue_users` tables
- Handles event ingestion, issue grouping, statistics
- Each project has isolated storage

### Request Flow

```
Sentry SDK → /api/{projectId}/envelope/ → DSN validation (AuthState)
           → Parse envelope → Fingerprint → Store (ProjectState)

Dashboard  → /api/auth/* (public) → AuthState
           → /api/projects/* (protected) → authMiddleware → ProjectState
```

### Key Modules

- `lib/envelope-parser.ts` - Parses Sentry envelope format (newline-delimited JSON)
- `lib/fingerprint.ts` - Groups events into issues using exception type + message + stack frames
- `routes/ingestion.ts` - SDK endpoint, supports `?sentry_key=` and `X-Sentry-Auth` header

### DSN Format

```
https://{publicKey}@{host}/{projectId}
```

The publicKey is validated against AuthState's projects table. ProjectState is accessed by project ID.

## Technology Stack

- **Worker**: Hono, Cloudflare Workers, Durable Objects with SQLite
- **Dashboard**: Vue 3, Pinia, Vue Router, Tailwind CSS, Vite
- **Tooling**: pnpm workspaces, Biome (lint/format), TypeScript
