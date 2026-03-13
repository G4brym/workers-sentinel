import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { api } from '../api/client';

export interface ResolvedFrame {
	originalFilename: string | null;
	originalFunction: string | null;
	originalLineno: number | null;
	originalColno: number | null;
	resolved: boolean;
}

// Cache parsed source maps to avoid re-fetching/re-parsing
const cache = new Map<string, TraceMap | null>();

function cacheKey(release: string, fileUrl: string): string {
	return `${release}::${fileUrl}`;
}

export async function resolveFrame(
	slug: string,
	release: string,
	frame: { filename?: string; lineno?: number; colno?: number },
): Promise<ResolvedFrame> {
	const empty: ResolvedFrame = {
		originalFilename: null,
		originalFunction: null,
		originalLineno: null,
		originalColno: null,
		resolved: false,
	};

	if (!release || !frame.filename || !frame.lineno) {
		return empty;
	}

	const key = cacheKey(release, frame.filename);

	if (!cache.has(key)) {
		try {
			const response = await api.get<{ sourceMap: unknown; content: string }>(
				`/api/projects/${slug}/sourcemaps/resolve?release=${encodeURIComponent(release)}&fileUrl=${encodeURIComponent(frame.filename)}`,
			);
			cache.set(key, new TraceMap(response.content));
		} catch {
			// No source map available for this file — cache the miss
			cache.set(key, null);
		}
	}

	const traceMap = cache.get(key);
	if (!traceMap) {
		return empty;
	}

	const pos = originalPositionFor(traceMap, {
		line: frame.lineno,
		column: frame.colno ?? 0,
	});

	if (pos.line == null) {
		return empty;
	}

	return {
		originalFilename: pos.source,
		originalFunction: pos.name,
		originalLineno: pos.line,
		originalColno: pos.column,
		resolved: true,
	};
}

export function clearCache(): void {
	cache.clear();
}
