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

Workers Sentinel is a lightweight, self-hosted error tracking and monitoring solution that runs entirely on your Cloudflare account. It accepts events using the Sentry SDK wire format, allowing you to use existing Sentry SDKs by simply changing the DSN endpoint. All your error data is stored securely in SQLite-backed Durable Objects, giving you full control over your information.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/G4brym/workers-sentinel/tree/main/template)

## Table of Contents

- [Overview](#overview)
- [Why Workers Sentinel?](#why-workers-sentinel)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [SDK Configuration](#sdk-configuration)
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
- **✅ Issue Management**: Mark issues as resolved or ignored
- **🌐 Multi-Project**: Create multiple projects with isolated data storage

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

### Cloudflare Workers (Service Binding)

For Cloudflare Workers, you can use [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) for optimal performance. This routes requests internally within Cloudflare's network, avoiding external HTTP roundtrips and reducing latency.

**Step 1:** Add a service binding to your worker's `wrangler.toml`:

```toml
name = "my-worker"
main = "src/index.ts"

[[services]]
binding = "SENTINEL"
service = "workers-sentinel"  # Your deployed Workers Sentinel worker name
```

**Step 2:** Create a custom transport that uses the service binding:

```typescript
// sentinel-transport.ts
import type {
  BaseTransportOptions,
  Envelope,
  Transport,
  TransportMakeRequestResponse,
} from '@sentry/core';
import { createEnvelope, serializeEnvelope } from '@sentry/core';

export function makeSentinelTransport(
  sentinelBinding: Fetcher,
  projectId: string,
): (options: BaseTransportOptions) => Transport {
  return (options: BaseTransportOptions): Transport => {
    return {
      send: async (envelope: Envelope): Promise<TransportMakeRequestResponse> => {
        const serialized = serializeEnvelope(envelope);
        const response = await sentinelBinding.fetch(
          `https://sentinel/api/${projectId}/envelope/`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-sentry-envelope' },
            body: serialized,
          },
        );
        return { statusCode: response.status };
      },
      flush: async () => true,
    };
  };
}
```

**Step 3:** Initialize Sentry with the custom transport:

```typescript
// index.ts
import * as Sentry from '@sentry/cloudflare';
import { makeSentinelTransport } from './sentinel-transport';

interface Env {
  SENTINEL: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    Sentry.init({
      dsn: 'https://<public_key>@sentinel/<project_id>',
      transport: makeSentinelTransport(env.SENTINEL, '<project_id>'),
    });

    return Sentry.withSentry(env, ctx, async () => {
      // Your worker code here
      return new Response('Hello!');
    });
  },
};
```

The DSN still includes your public key for authentication - the service binding only changes how the request is delivered, not what is sent.

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

## Roadmap & Future Enhancements

Planned features for future releases:

- [ ] Source map support for JavaScript errors
- [ ] Release tracking and deployment correlation
- [ ] Performance monitoring (transactions, spans)
- [ ] Alerting integrations (webhook, email)
- [ ] Session replay support
- [ ] Team/organization support
- [ ] Issue assignment
- [ ] Search functionality
- [ ] Time-series charts
- [ ] Rate limiting per project
- [ ] Event retention policies

## Known Limitations

**Current Limitations:**
- No source map support yet (stack traces show minified code)
- No performance monitoring (error tracking only)
- No alerting/notifications
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
