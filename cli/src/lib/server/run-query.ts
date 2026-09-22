/**
 * Server-side query runner: shared core of `/api/query`, callable directly
 * (e.g. by the validate command's metadata loader) without an HTTP round-trip.
 * Runs against connection.yaml if present, else the managed Evidence engine.
 */

// __DEFAULT_QUERY_ENGINE_HOST__ is replaced at build time by vite define;
// process.env overrides it at runtime (e.g. for dev/staging testing).
declare const __DEFAULT_QUERY_ENGINE_HOST__: string;
const PUBLIC_STUDIO_HOST = process.env.PUBLIC_STUDIO_HOST ?? 'https://evidence.studio';
const PUBLIC_QUERY_ENGINE_HOST = process.env.PUBLIC_QUERY_ENGINE_HOST ?? __DEFAULT_QUERY_ENGINE_HOST__;
import {
	loadCredentials,
	ensureSessionResolved,
	clearSessionCache
} from '$lib/auth/credentials.server';
import { loadConnectionConfig, executeQuery as executeDirectQuery } from '$cli/connection';
import { createHash } from 'node:crypto';
import { getProjectCwd } from '$lib/server/project-cwd';
import type { Column } from '@evidence/core/user-components/interfaces/query-service';
import { listSavedFilters, readStore } from '$lib/modules/store';
import { injectSavedClauses } from '$lib/server/saved-clause';
import { predicateFitsQuery } from '$lib/server/saved-predicate';

const STUDIO_HOST = PUBLIC_STUDIO_HOST.replace(/\/$/, '');

export interface RunQueryResult {
	rows: Record<string, unknown>[];
	columns: Column[];
	source?: string;
	error?: string;
	/** HTTP-style status hint for the `/api/query` wrapper. */
	status?: number;
	/** True when served from the server-side TTL cache (source is 'Cache'). */
	cached?: boolean;
}

export interface RunQueryOpts {
	/** Bypass the server-side TTL cache (page refresh / explicit re-run). */
	noCache?: boolean;
	/** Favorite keys from the saved query param. Injected before cache and execution. */
	savedKeys?: string[];
	/** Active page project. Falls back to settings only when omitted. */
	projectId?: string;
}

type CacheEntry = {
	at: number;
	rows: Record<string, unknown>[];
	columns: Column[];
	source?: string;
};

/**
 * Short-TTL in-memory cache for direct-connection queries (ThinkingData OpenAPI).
 * Why here and not localStorage: page results are tiny aggregates (tens of rows),
 * so memory is negligible; the real cost is TE round-trips on every filter change,
 * tab switch, or multi-viewer open. Browser localStorage would add stale-data risk
 * (no invalidation channel) and a 5MB quota shared with chat history — the client
 * already keeps an SQL-keyed in-memory cache per page, so the server cache only
 * needs to cover cross-viewer and cross-query repeats within a few minutes.
 */
const queryCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RunQueryResult>>();
const MAX_CACHE_ENTRIES = 200;
const MAX_CACHE_ROWS = 5000;

function cacheTtlMs(): number {
	const raw = Number(process.env.TE_QUERY_CACHE_TTL_SECONDS ?? 180);
	if (!Number.isFinite(raw) || raw <= 0) return 0;
	return Math.min(raw, 3600) * 1000;
}

function cacheKey(sql: string, connectionType: string): string {
	return createHash('sha256').update(`${connectionType}::${sql}`).digest('hex');
}

function cacheGet(key: string): CacheEntry | null {
	const hit = queryCache.get(key);
	if (!hit) return null;
	if (Date.now() - hit.at > cacheTtlMs()) {
		queryCache.delete(key);
		return null;
	}
	// LRU touch
	queryCache.delete(key);
	queryCache.set(key, hit);
	return hit;
}

function cacheSet(key: string, entry: CacheEntry) {
	if (entry.rows.length > MAX_CACHE_ROWS) return;
	queryCache.set(key, entry);
	while (queryCache.size > MAX_CACHE_ENTRIES) {
		const oldest = queryCache.keys().next();
		if (oldest.done) break;
		queryCache.delete(oldest.value);
	}
}

export function clearQueryCache() {
	queryCache.clear();
}

function rewriteSaved(
	sql: string,
	keys: string[] | undefined,
	projectId: string | undefined
): { sql: string } | { error: string } {
	const list = (keys ?? []).map((key) => key.trim()).filter(Boolean);
	if (!list.length || !sql.includes('/*evd-saved*/')) return { sql };
	const active = projectId || readStore().settings.te.projectId || '51';
	const filters = listSavedFilters(active);
	const clauses: string[] = [];
	for (const key of list) {
		if (!/^[a-z][a-z0-9_]*$/.test(key)) return { error: `非法收藏 key：${key}` };
		const hit = filters.find((filter) => filter.key === key);
		if (!hit) return { error: `收藏不存在：${key}` };
		const fit = predicateFitsQuery(hit.aliases || [], sql);
		if (fit) return { error: `${hit.name}：${fit}` };
		clauses.push(hit.sql);
	}
	return { sql: injectSavedClauses(sql, clauses) };
}

export async function runQuery(sql: string, opts?: RunQueryOpts): Promise<RunQueryResult> {
	const rewritten = rewriteSaved(sql, opts?.savedKeys, opts?.projectId);
	if ('error' in rewritten) {
		return { rows: [], columns: [], error: rewritten.error, status: 400 };
	}
	sql = rewritten.sql;

	// A broken connection.yaml should be reported, not masked by falling through.
	let connectionConfig;
	try {
		connectionConfig = await loadConnectionConfig(getProjectCwd());
	} catch (e) {
		return {
			rows: [],
			columns: [],
			error: e instanceof Error ? e.message : 'Failed to load connection.yaml',
			status: 500
		};
	}

	if (connectionConfig) {
		const ttl = cacheTtlMs();
		const key = cacheKey(sql, connectionConfig.type);
		if (ttl > 0 && !opts?.noCache) {
			const hit = cacheGet(key);
			if (hit) {
				return { rows: hit.rows, columns: hit.columns, source: 'Cache', cached: true };
			}
			const pending = inflight.get(key);
			if (pending) return pending;
		}
		const task = (async (): Promise<RunQueryResult> => {
			try {
				const result = await executeDirectQuery(sql, connectionConfig);
			const source =
				connectionConfig.type === 'snowflake'
					? 'Snowflake'
					: connectionConfig.type === 'bigquery'
						? 'BigQuery'
						: connectionConfig.type === 'fabric'
							? 'Microsoft Fabric'
							: connectionConfig.type === 'thinkingdata'
								? 'ThinkingData'
								: undefined;
				const out: RunQueryResult = { rows: result.rows, columns: result.columns, source };
				if (ttl > 0 && !out.error) {
					cacheSet(key, { at: Date.now(), rows: out.rows, columns: out.columns, source: out.source });
				}
				return out;
			} catch (e) {
				return {
					rows: [],
					columns: [],
					error: e instanceof Error ? e.message : 'Query execution failed',
					status: 500
				};
			}
		})();
		if (ttl > 0 && !opts?.noCache) {
			inflight.set(key, task);
			try {
				return await task;
			} finally {
				inflight.delete(key);
			}
		}
		return task;
	}

	// No connection.yaml — fall back to managed query engine.
	let credentials = await loadCredentials();

	if (!PUBLIC_QUERY_ENGINE_HOST) {
		return {
			rows: [],
			columns: [],
			error: 'PUBLIC_QUERY_ENGINE_HOST not configured. Set it in .env before building.',
			status: 500
		};
	}

	if (!credentials || !credentials.organizationId) {
		return {
			rows: [],
			columns: [],
			error:
				'Not authenticated. Add a connection.yaml to query your own database, or run `evidence login` to use the hosted Evidence Warehouse.',
			status: 401
		};
	}

	const url = `${PUBLIC_QUERY_ENGINE_HOST}/v2/workspaces/${credentials.organizationId}/json`;

	try {
		credentials = await ensureSessionResolved(credentials, STUDIO_HOST);
		const encodedSql = Buffer.from(sql).toString('base64');

		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (credentials.sealedSession) {
			headers['Cookie'] = `wos-session=${credentials.sealedSession}`;
		} else {
			headers['Authorization'] = `Bearer ${credentials.accessToken}`;
		}

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({ query: encodedSql, queryWorkspaceData: true })
		});

		const responseText = await response.text();

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				clearSessionCache();
				return {
					rows: [],
					columns: [],
					error: 'Session expired. Please log in again.',
					status: 401
				};
			}
			return {
				rows: [],
				columns: [],
				error: `Query engine error (${response.status}): ${responseText}`,
				status: response.status
			};
		}

		try {
			const parsed = JSON.parse(responseText);
			return {
				rows: parsed.rows ?? [],
				columns: parsed.columns ?? [],
				source: parsed.source
			};
		} catch {
			return { rows: [], columns: [], error: `Invalid response: ${responseText}`, status: 500 };
		}
	} catch (e) {
		return {
			rows: [],
			columns: [],
			error: e instanceof Error ? e.message : 'Unknown error',
			status: 500
		};
	}
}
