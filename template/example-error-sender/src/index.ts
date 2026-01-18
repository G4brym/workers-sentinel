import * as Sentry from "@sentry/cloudflare";
import { waitUntil } from "cloudflare:workers";

// Replace with your DSN from Sentinel dashboard
const DSN = "https://6dd636abda6cc82f71ae6d6187dbb612@workers-sentinel.massadas.workers.dev/6e322150-2c88-416d-a5b9-bf78403dbbc4";

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
            // Randomly throw an error to test Sentry integration
            if (Math.random() < 0.5) {
                throw new Error("Oops! Random failure occurred");
            }
            return new Response("Hello World!");
        },
    }
);
