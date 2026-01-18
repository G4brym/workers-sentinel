import type { EnvelopeHeader, EnvelopeItem, ParsedEnvelope, SentryEvent } from '../types';

/**
 * Parse a Sentry envelope.
 * Envelope format:
 * ```
 * {header_json}\n
 * {item_header_json}\n
 * {item_payload_json}\n
 * {item_header_json}\n
 * {item_payload_json}\n
 * ...
 * ```
 */
export function parseEnvelope(body: string): ParsedEnvelope {
	const lines = body.split('\n');

	if (lines.length < 1) {
		throw new Error('Invalid envelope: empty body');
	}

	// Parse envelope header (first line)
	let header: EnvelopeHeader;
	try {
		header = JSON.parse(lines[0]);
	} catch {
		throw new Error('Invalid envelope: failed to parse header');
	}

	const items: EnvelopeItem[] = [];
	let i = 1;

	// Parse items (pairs of header + payload)
	while (i < lines.length) {
		// Skip empty lines
		if (!lines[i] || lines[i].trim() === '') {
			i++;
			continue;
		}

		// Parse item header
		let itemHeader: { type: string; length?: number; content_type?: string };
		try {
			itemHeader = JSON.parse(lines[i]);
		} catch {
			// May be end of envelope or malformed
			i++;
			continue;
		}

		i++;

		// Parse item payload
		if (i >= lines.length) {
			break;
		}

		let payload: unknown;

		if (itemHeader.length !== undefined) {
			// Binary/fixed-length payload
			const payloadStr = lines[i].substring(0, itemHeader.length);
			try {
				payload = JSON.parse(payloadStr);
			} catch {
				payload = payloadStr;
			}
		} else {
			// JSON payload
			try {
				payload = JSON.parse(lines[i]);
			} catch {
				payload = lines[i];
			}
		}

		items.push({
			type: itemHeader.type as EnvelopeItem['type'],
			payload,
		});

		i++;
	}

	return { header, items };
}

/**
 * Parse DSN from various sources.
 * DSN format: https://{public_key}@{host}/{project_id}
 */
export function parseDSN(dsn: string): {
	protocol: string;
	publicKey: string;
	host: string;
	projectId: string;
} | null {
	try {
		const url = new URL(dsn);
		const publicKey = url.username;
		const pathParts = url.pathname.split('/').filter(Boolean);
		const projectId = pathParts[pathParts.length - 1];

		if (!publicKey || !projectId) {
			return null;
		}

		return {
			protocol: url.protocol.replace(':', ''),
			publicKey,
			host: url.host,
			projectId,
		};
	} catch {
		return null;
	}
}

/**
 * Extract public key from Sentry auth header.
 * Format: Sentry sentry_version=7, sentry_key={key}, ...
 */
export function extractKeyFromAuthHeader(header: string): string | null {
	if (!header.startsWith('Sentry ')) {
		return null;
	}

	const parts = header.substring(7).split(',');
	for (const part of parts) {
		const [key, value] = part.trim().split('=');
		if (key === 'sentry_key') {
			return value;
		}
	}

	return null;
}

/**
 * Validate and extract event items from an envelope.
 */
export function extractEvents(envelope: ParsedEnvelope): SentryEvent[] {
	const events: SentryEvent[] = [];

	for (const item of envelope.items) {
		if (item.type === 'event' || item.type === 'transaction') {
			const event = item.payload as SentryEvent;

			// Ensure event_id
			if (!event.event_id) {
				event.event_id = crypto.randomUUID().replace(/-/g, '');
			}

			// Ensure timestamp
			if (!event.timestamp) {
				event.timestamp = new Date().toISOString();
			}

			events.push(event);
		}
	}

	return events;
}

/**
 * Decompress gzip-encoded body if necessary.
 */
export async function maybeDecompress(
	body: ArrayBuffer,
	contentEncoding: string | null,
): Promise<string> {
	if (contentEncoding === 'gzip') {
		const ds = new DecompressionStream('gzip');
		const decompressed = new Response(body).body!.pipeThrough(ds);
		return await new Response(decompressed).text();
	}

	return new TextDecoder().decode(body);
}
