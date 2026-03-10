<div align="center">
  <a href="#">
    <h1 style="font-size: 4rem;">🛡️</h1>
    <h1>Workers Sentinel</h1>
  </a>
</div>

<p align="center">
    <em>A self-hosted, Sentry-compatible error tracking system running entirely on Cloudflare Workers</em>
</p>

<p align="center">
    <a href="https://github.com/G4brym/workers-sentinel/commits/main" target="_blank">
      <img src="https://img.shields.io/github/commit-activity/m/G4brym/workers-sentinel?label=Commits&style=social" alt="Workers Sentinel Commits">
    </a>
    <a href="https://github.com/G4brym/workers-sentinel/issues" target="_blank">
      <img src="https://img.shields.io/github/issues/G4brym/workers-sentinel?style=social" alt="Issues">
    </a>
    <a href="https://github.com/G4brym/workers-sentinel/blob/main/LICENSE" target="_blank">
      <img src="https://img.shields.io/badge/license-MIT-brightgreen.svg?style=social" alt="Software License">
    </a>
</p>

# Workers Sentinel

> **⚠️ Disclaimer:** This is a toy project and a very poor imitation of Sentry. It doesn't even represent 0.1% of all Sentry features. This should not be taken seriously or used in any production environment where you actually care about error tracking. Please use the real [Sentry](https://sentry.io) for production workloads.

Workers Sentinel is a lightweight, self-hosted error tracking and monitoring solution that runs entirely on your Cloudflare account. It accepts events using the Sentry SDK wire format, allowing you to use existing Sentry SDKs by simply changing the DSN endpoint. All your error data is stored securely in SQLite-backed Durable Objects, giving you full control over your information.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/G4brym/workers-sentinel/tree/main/template)

## Table of Contents

- [Overview](#overview)
- [Why Workers Sentinel?](#why-workers-sentinel)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [SDK Configuration](#sdk-configuration)
- [Webhook Notifications](#webhook-notifications)
- [API Tokens](#api-tokens)
- [Architecture](#architecture)
- [Roadmap & Future Enhancements](#roadmap--future-enhancements)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

## Overview

Workers Sentinel gives you a private, self-hosted error tracking solution with a modern web dashboard. By leveraging the Cloudflare ecosystem, it offers a cost-effective and scalable alternative to hosted error tracking services. All your data is stored in your own Durable Objects with SQLite storage, giving you complete control and privacy.

## Why Workers Sentinel?

**🔒 Privacy First**
- All data stays in YOUR Cloudflare account
- No third-party tracking or data sharing
- You control your error data completely

**💰 Cost-Effective**
- Runs on Cloudflare's generous free tier
- Pay only for what you use beyond free limits
- No monthly subscription fees

**⚡ Performance**
- Built on Cloudflare's global edge network
- Fast error ingestion worldwide
- Serverless architecture scales automatically

**🔌 SDK Compatible**
- Works with existing Sentry SDKs
- Just change your DSN endpoint
- Supports JavaScript, Python, Go, and more

**🎨 Modern Dashboard**
- Clean, intuitive interface
- Stack trace visualization
- Issue grouping and management

**🛠️ Easy Setup**
- Deploy with one click
- Automatic project creation
- Smart authentication setup

## Key Features

- **🔌 Sentry SDK Compatible**: Use existing Sentry SDKs by changing only the DSN endpoint
- **🔒 Secure & Private**: Self-hosted on your Cloudflare account with no third-party data access
- **🔐 Smart Authentication**: Automatic first-user admin setup with session-based auth
- **📊 Issue Grouping**: Automatic fingerprinting groups similar errors into issues
- **📈 Event Statistics**: Track error frequency with hourly aggregations
- **🔍 Stack Traces**: Full stack trace visualization with code context
- **👥 User Tracking**: See how many users are affected by each issue
- **🏷️ Tags & Context**: View tags, breadcrumbs, and contextual data
- **🔎 Tag-Based Filtering**: Search and filter issues by tag key-value pairs (e.g., browser, OS, environment)
- **✅ Issue Management**: Mark issues as resolved or ignored
- **🌐 Multi-Project**: Create multiple projects with isolated data storage
- **🔔 Webhook Notifications**: Get notified when new issues are detected via Slack, Discord, or any HTTP endpoint
- **⚡ Rate Limiting**: Configurable per-project event quotas to prevent runaway error loops from overwhelming the system
- **🗑️ Data Retention**: Configurable per-project retention policies with automatic cleanup

## Prerequisites

Before deploying Workers Sentinel, make sure you have:

- **Cloudflare Account** - [Sign up for free](https://dash.cloudflare.com/sign-up)
- **Node.js 20+** - For local development (not required for one-click deployment)

**Cloudflare Services Used:**
- Workers (Compute)
- Durable Objects with SQLite (State management)
- Workers Assets (Dashboard hosting)

All these services have generous free tiers sufficient for most use cases.

## Getting Started

### One-Click Deploy

Use the "Deploy to Cloudflare" button above, or run:

```bash
npm create cloudflare@latest -- --template=https://github.com/G4brym/workers-sentinel/tree/main/template
```

### Manual Deployment

```bash
# Clone the repository
git clone https://github.com/G4brym/workers-sentinel.git
cd workers-sentinel

# Install dependencies
pnpm install

# Build and deploy
pnpm deploy
```

### First-Time Setup

1. **Deploy your worker** to Cloudflare
2. **Visit your worker URL** in a browser
3. **Register the first user** - this becomes your admin account
4. **Create your first project** - you'll receive a DSN
5. **Configure your Sentry SDK** with the DSN

## SDK Configuration

Workers Sentinel is compatible with official Sentry SDKs. Simply use your Sentinel DSN instead of a Sentry DSN.

### Cloudflare Workers (Service Binding with RPC)

For Cloudflare Workers, you can use [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) with RPC for optimal performance. This routes requests internally within Cloudflare's network, avoiding external HTTP roundtrips and reducing latency.

**Step 1:** Add a service binding to your worker's `wrangler.jsonc`:

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_flags": ["nodejs_als"],
  "services": [
    { "binding": "SENTINEL", "service": "workers-sentinel", "entrypoint": "SentinelRpc" }
  ]
}
```

**Step 2:** Initialize Sentry with the RPC transport:

```typescript
import * as Sentry from '@sentry/cloudflare';
import { waitUntil } from 'cloudflare:workers';

const DSN = 'https://<public_key>@<your-worker>.workers.dev/<project_id>';

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: DSN,
    transport: () => ({
      send: async (envelope) => {
        const rpcPromise = env.SENTINEL.captureEnvelope(DSN, envelope);
        waitUntil(rpcPromise);
        const result = await rpcPromise;
        return { statusCode: result.status };
      },
      flush: async () => true,
    }),
  }),
  {
    async fetch(request, env, ctx) {
      // Your worker code here
      return new Response('Hello!');
    },
  }
);
```

The `waitUntil` call ensures the RPC completes even after the HTTP response returns. The `captureEnvelope` method takes the DSN and envelope, handling authentication and ingestion internally.

### JavaScript / Browser

```javascript
import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: 'https://<public_key>@<your-worker>.workers.dev/<project_id>',
});
```

### Node.js

```javascript
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: 'https://<public_key>@<your-worker>.workers.dev/<project_id>',
});
```

### Python

```python
import sentry_sdk

sentry_sdk.init(
    dsn="https://<public_key>@<your-worker>.workers.dev/<project_id>",
)
```

### Go

```go
import "github.com/getsentry/sentry-go"

sentry.Init(sentry.ClientOptions{
    Dsn: "https://<public_key>@<your-worker>.workers.dev/<project_id>",
})
```

The DSN is displayed when you create a project in the dashboard, or you can find it in the project settings.

## Webhook Notifications

Workers Sentinel can send a POST request to any HTTP endpoint when a new issue is detected. This enables integration with Slack, Discord, PagerDuty, or any custom alerting system.

### Setup

1. Go to **Project Settings** in the dashboard
2. Enter your webhook URL in the **Webhook Notifications** section
3. Click **Save**
4. Use **Send Test** to verify the endpoint receives notifications

Webhook URLs must use HTTPS.

### Payload Format

When a new issue is detected, Workers Sentinel sends a JSON POST request:

```json
{
  "text": "[My App] New error: TypeError: Cannot read property 'foo' of undefined in app.js",
  "project": {
    "id": "project-uuid",
    "name": "My App",
    "slug": "my-app"
  },
  "issue": {
    "id": "issue-uuid",
    "title": "TypeError: Cannot read property 'foo' of undefined",
    "level": "error",
    "culprit": "app.js"
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

The `text` field is formatted for direct use with Slack Incoming Webhooks. For Discord, use the same URL format with `/slack` appended to your Discord webhook URL.

### Notes

- Webhooks fire only for **new** issues (first occurrence of a unique error fingerprint)
- Delivery is best-effort — failures are logged but not retried
- Webhook requests are sent asynchronously and never slow down event ingestion

## API Tokens

API tokens allow programmatic access to the Workers Sentinel API — useful for CI/CD pipelines, scripts, custom dashboards, and integrations with incident management tools.

### Creating a Token

1. Go to **Project Settings** in the dashboard
2. Click **Manage API Tokens** in the API Tokens section
3. Enter a token name (e.g., `ci-pipeline`) and an optional expiration date
4. Click **Create Token**
5. **Copy the token immediately** — it will only be shown once

### Using a Token

Include the token in the `Authorization` header of any API request:

```bash
# List projects
curl -H "Authorization: Bearer wst_your_token_here" \
  https://your-sentinel.workers.dev/api/projects

# Get issues for a project
curl -H "Authorization: Bearer wst_your_token_here" \
  https://your-sentinel.workers.dev/api/projects/my-app/issues

# List events for an issue
curl -H "Authorization: Bearer wst_your_token_here" \
  https://your-sentinel.workers.dev/api/projects/my-app/issues/issue-uuid/events
```

API tokens use the `wst_` prefix and work alongside existing session-based authentication.

### Token Management

- **Expiration**: Tokens can be created with an optional expiration date. Expired tokens are automatically rejected.
- **Revocation**: Revoke tokens from the API Tokens dashboard page. Revoked tokens stop working immediately.
- **Limits**: Each user can have up to 10 active API tokens.
- **Audit**: Each token's Last Used timestamp is updated on each successful request.

### Security Best Practices

- Store tokens in environment variables, never in source code
- Use descriptive names so you can identify which token belongs to which service
- Set expiration dates for tokens used in temporary or rotating access scenarios
- Revoke tokens immediately when they are no longer needed or may be compromised
- Token management (creating, listing, revoking) requires session authentication — a compromised API token cannot create new tokens

## Architecture

Workers Sentinel is built with modern web technologies:

**Backend (Worker):**
- **Hono** - Fast, lightweight web framework
- **Cloudflare Durable Objects** - Distributed state with SQLite storage
- **Sentry Envelope Parser** - Compatible with Sentry SDK wire format

**Frontend (Dashboard):**
- **Vue.js 3** - Progressive JavaScript framework
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Pinia** - State management
- **Vite** - Fast build tooling

**Data Architecture:**
- **AuthState DO** (singleton) - Users, sessions, project registry
- **ProjectState DO** (per-project) - Issues, events, statistics

Each project has its own isolated Durable Object with SQLite storage, ensuring data isolation and scalability.

**Rate Limiting:**
- Per-project configurable hourly event quotas stored in the ProjectState DO
- In-memory counter with persistent backup in SQLite for fast O(1) checks
- Returns HTTP 429 with `Retry-After` header when quota is exceeded — Sentry SDKs handle this gracefully
- Default is unlimited (0); configurable via dashboard or `PATCH /api/projects/:slug`

## Roadmap & Future Enhancements

Planned features for future releases:

- [ ] Source map support for JavaScript errors
- [ ] Release tracking and deployment correlation
- [ ] Performance monitoring (transactions, spans)
- [x] Webhook alerting notifications
- [ ] Email alerting notifications
- [ ] Session replay support
- [ ] Team/organization support
- [ ] Issue assignment
- [x] Tag-based search and filtering
- [ ] Time-series charts
- [x] Rate limiting per project
- [x] Event retention policies

## Known Limitations

**Current Limitations:**
- No source map support yet (stack traces show minified code)
- No performance monitoring (error tracking only)
- Email notifications not yet available (webhooks supported)
- Single-user admin (no team management yet)

**Sentry Feature Parity:**
Workers Sentinel focuses on core error tracking. Advanced Sentry features like:
- Session replay
- Performance monitoring
- Profiling
- Crons monitoring

Are not currently supported but may be added in future versions.

**Browser Compatibility:**
- Modern browsers required (Chrome 90+, Firefox 88+, Safari 14+)
- JavaScript must be enabled
- Cookies must be enabled for authentication

## Contributing

We welcome contributions from the community!

**🐛 Bug Reports**
- Use the [GitHub Issues](https://github.com/G4brym/workers-sentinel/issues) page
- Include reproduction steps
- Specify your environment

**✨ Feature Requests**
- Check existing issues first
- Explain the use case and benefit

**💻 Code Contributions**
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a Pull Request

**Development Setup:**
```bash
# Clone and install
git clone https://github.com/G4brym/workers-sentinel.git
cd workers-sentinel
pnpm install

# Start development (runs wrangler dev)
pnpm dev

# Build dashboard
pnpm --filter @workers-sentinel/dashboard build

# Typecheck
pnpm typecheck

# Lint
pnpm lint
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Made with ❤️ for the self-hosted community**

If you find Workers Sentinel useful, please consider giving it a ⭐ on GitHub!
