import type { SentryEvent, IssueMetadata, Stacktrace, StackFrame } from '../types';

/**
 * Generate a fingerprint for grouping events into issues.
 * Priority:
 * 1. Explicit fingerprint from SDK (if not default)
 * 2. Exception-based grouping (type + message + top frames)
 * 3. Message-based grouping
 * 4. Fallback to event ID (no grouping)
 */
export function generateFingerprint(event: SentryEvent): string {
	// Priority 1: Explicit fingerprint from SDK
	if (event.fingerprint && event.fingerprint.length > 0) {
		const nonDefault = event.fingerprint.filter((f) => f !== '{{ default }}');
		if (nonDefault.length > 0) {
			return hashArray(nonDefault);
		}
	}

	// Priority 2: Exception-based grouping
	if (event.exception?.values && event.exception.values.length > 0) {
		const exc = event.exception.values[0];
		const parts: string[] = [];

		// Exception type
		parts.push(exc.type || 'Error');

		// Normalized message (remove variable parts like IDs, timestamps)
		const normalizedMessage = normalizeMessage(exc.value || '');
		parts.push(normalizedMessage);

		// Top in-app frames
		const topFrames = getTopFrames(exc.stacktrace, 3);
		for (const frame of topFrames) {
			parts.push(formatFrame(frame));
		}

		return hashArray(parts);
	}

	// Priority 3: Message-based grouping
	if (event.message) {
		const normalizedMessage = normalizeMessage(event.message);
		return hashArray([event.level || 'error', normalizedMessage]);
	}

	// Fallback: unique per event
	return hashArray([event.event_id]);
}

/**
 * Extract the title for an issue from an event.
 */
export function extractTitle(event: SentryEvent): string {
	if (event.exception?.values && event.exception.values.length > 0) {
		const exc = event.exception.values[0];
		const type = exc.type || 'Error';
		const value = exc.value || '';

		// Truncate long messages
		const truncatedValue = value.length > 100 ? value.slice(0, 97) + '...' : value;

		return `${type}: ${truncatedValue}`;
	}

	if (event.message) {
		return event.message.length > 128 ? event.message.slice(0, 125) + '...' : event.message;
	}

	return 'Unknown Error';
}

/**
 * Extract the culprit (location) from an event.
 */
export function extractCulprit(event: SentryEvent): string | null {
	// Use transaction if available
	if (event.transaction) {
		return event.transaction;
	}

	// Extract from stack trace
	if (event.exception?.values && event.exception.values.length > 0) {
		const exc = event.exception.values[0];
		const frame = getTopFrame(exc.stacktrace);

		if (frame) {
			const parts: string[] = [];

			if (frame.filename) {
				parts.push(frame.filename);
			}

			if (frame.function && frame.function !== '<anonymous>') {
				parts.push(`in ${frame.function}`);
			}

			if (frame.lineno) {
				parts.push(`at line ${frame.lineno}`);
			}

			if (parts.length > 0) {
				return parts.join(' ');
			}
		}
	}

	return null;
}

/**
 * Extract metadata for quick display.
 */
export function extractMetadata(event: SentryEvent): IssueMetadata {
	const metadata: IssueMetadata = {
		type: 'Error',
		value: '',
	};

	if (event.exception?.values && event.exception.values.length > 0) {
		const exc = event.exception.values[0];
		metadata.type = exc.type || 'Error';
		metadata.value = (exc.value || '').slice(0, 200);

		const frame = getTopFrame(exc.stacktrace);
		if (frame) {
			metadata.filename = frame.filename;
			metadata.function = frame.function;
		}
	} else if (event.message) {
		metadata.type = 'Message';
		metadata.value = event.message.slice(0, 200);
	}

	return metadata;
}

/**
 * Get the top N in-app frames from a stacktrace.
 */
function getTopFrames(stacktrace: Stacktrace | undefined, count: number): StackFrame[] {
	if (!stacktrace?.frames || stacktrace.frames.length === 0) {
		return [];
	}

	// Frames are usually in reverse order (most recent last)
	const frames = [...stacktrace.frames].reverse();

	// Prefer in-app frames
	const inAppFrames = frames.filter((f) => f.in_app !== false);
	if (inAppFrames.length > 0) {
		return inAppFrames.slice(0, count);
	}

	// Fall back to any frames
	return frames.slice(0, count);
}

/**
 * Get the top frame from a stacktrace.
 */
function getTopFrame(stacktrace: Stacktrace | undefined): StackFrame | null {
	const frames = getTopFrames(stacktrace, 1);
	return frames.length > 0 ? frames[0] : null;
}

/**
 * Format a stack frame for fingerprinting.
 */
function formatFrame(frame: StackFrame): string {
	const parts: string[] = [];

	if (frame.filename) {
		// Remove query strings and hashes, normalize path
		const filename = frame.filename.split('?')[0].split('#')[0];
		parts.push(filename);
	}

	if (frame.function) {
		parts.push(frame.function);
	}

	if (frame.lineno) {
		parts.push(String(frame.lineno));
	}

	return parts.join(':');
}

/**
 * Normalize a message by removing variable parts.
 */
function normalizeMessage(message: string): string {
	return (
		message
			// Remove UUIDs
			.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
			// Remove hex strings (likely IDs)
			.replace(/\b[0-9a-f]{24,}\b/gi, '<id>')
			// Remove numbers (but keep error codes like "404")
			.replace(/\b\d{6,}\b/g, '<num>')
			// Remove timestamps
			.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, '<timestamp>')
			// Remove IP addresses
			.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<ip>')
			// Remove email addresses
			.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '<email>')
			// Normalize whitespace
			.replace(/\s+/g, ' ')
			.trim()
			// Truncate
			.slice(0, 500)
	);
}

/**
 * Hash an array of strings to create a fingerprint.
 */
function hashArray(parts: string[]): string {
	const str = parts.join('||');
	return simpleHash(str);
}

/**
 * Simple hash function (djb2 algorithm).
 * For production, consider using SHA-256 via crypto.subtle.
 */
function simpleHash(str: string): string {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = (hash * 33) ^ str.charCodeAt(i);
	}
	// Convert to hex string
	return (hash >>> 0).toString(16).padStart(8, '0');
}
