# Workers Sentinel

A self-hosted, Sentry-compatible error tracking system running entirely on Cloudflare Workers.

## Features

- **Sentry SDK Compatible**: Use existing Sentry SDKs by changing only the DSN endpoint
- **Self-Hosted**: All data stays in your Cloudflare account
- **Service Binding RPC**: Low-latency event ingestion for Cloudflare Workers via RPC
- **SQLite Storage**: Durable Objects with SQLite for reliable state management

## Deployment

### One-Click Deploy

```bash
npm create cloudflare@latest -- --template=https://github.com/G4brym/workers-sentinel/tree/main/template
```

### Manual Deployment

```bash
git clone https://github.com/G4brym/workers-sentinel.git
cd workers-sentinel
pnpm install
pnpm deploy
```

## Usage

### Standard HTTP (Any Platform)

Configure your Sentry SDK with your Sentinel DSN:

```javascript
import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: 'https://<public_key>@<your-worker>.workers.dev/<project_id>',
});
```

### Service Binding RPC (Cloudflare Workers)

For Cloudflare Workers, use service bindings with RPC for optimal performance:

**1. Add service binding to `wrangler.jsonc`:**

```jsonc
{
  "compatibility_flags": ["nodejs_als"],
  "services": [
    { "binding": "SENTINEL", "service": "workers-sentinel", "entrypoint": "SentinelRpc" }
  ]
}
```

**2. Configure Sentry with RPC transport:**

```typescript
import * as Sentry from '@sentry/cloudflare';
import { waitUntil } from 'cloudflare:workers';

const DSN = 'https://<public_key>@<your-worker>.workers.dev/<project_id>';

export type Env = {
  SENTINEL: {
    captureEnvelope(
      dsn: string,
      envelope: unknown,
    ): Promise<{ status: number; eventId?: string }>;
  };
};

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
      return new Response('Hello World!');
    },
  }
);
```

The `waitUntil` call ensures the RPC completes even after the HTTP response returns.

## API

### `SentinelRpc.captureEnvelope(dsn, envelope)`

Captures a Sentry envelope via RPC.

- **dsn** `string` - Full DSN string (e.g., `https://publicKey@host/projectId`)
- **envelope** `SentryEnvelope` - The Sentry envelope object (not serialized)
- **Returns** `Promise<{ status: number; eventId?: string }>` - Status code and optional event ID

## Documentation

For full documentation, visit the [GitHub repository](https://github.com/G4brym/workers-sentinel).

## License

MIT
