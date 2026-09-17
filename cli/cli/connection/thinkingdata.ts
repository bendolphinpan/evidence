/**
 * Direct ThinkingData OpenAPI query execution using connection.yaml credentials.
 *
 * Ports Self-Data's proven querySql / execute-sql handshake: try both endpoints
 * and form/query/json bodies, then cache whichever combination works.
 */

import { mapThinkingDataColumns } from '@evidence/core/connectors/thinkingdata/map-columns';
import type { ThinkingDataCredentials } from '@evidence/core/connectors/thinkingdata/credentials';
import {
	assertEventTablePartDate,
	assertReadOnlySql,
	isShowTablesSql,
	rewriteTeIdentifiers,
	teQualifiedTables,
	sanitizeTeSql,
	unwrapEvidenceSubquery
} from '@evidence/core/connectors/thinkingdata/sql';
import type { QueryResult } from './types';

const SQL_TIMEOUT_SECONDS = 120;
const OPENAPI_TIMEOUT_MS = SQL_TIMEOUT_SECONDS * 1000 + 20_000;
const RESULT_POLL_MS = 2000;
const RESULT_POLL_ATTEMPTS = Math.ceil(SQL_TIMEOUT_SECONDS / (RESULT_POLL_MS / 1000));
const MAX_RESULT_ROWS = 50_000;

type TeEndpoint = 'querySql' | 'execute-sql';
type TeRequestStyle = 'form' | 'query' | 'json';

const endpointCache = new Map<string, TeEndpoint>();
const styleCache = new Map<string, TeRequestStyle>();
const baseUrlCache = new Map<string, string>();

export function resetThinkingDataClientCaches(): void {
	endpointCache.clear();
	styleCache.clear();
	baseUrlCache.clear();
}

function candidateBaseUrls(baseUrl: string): string[] {
	const cached = baseUrlCache.get(baseUrl);
	const list = cached ? [cached] : [baseUrl];
	try {
		const url = new URL(baseUrl);
		if (!url.port) {
			const withPort = new URL(baseUrl);
			withPort.port = '8992';
			const extra = withPort.toString().replace(/\/+$/, '');
			if (!list.includes(extra)) list.push(extra);
		}
	} catch {
		// ignore
	}
	return list;
}

function teErrorText(status: number, body: string, hintPath: string): string {
	const snippet = body.replace(/\s+/g, ' ').slice(0, 280);
	if (/<!doctype html|<html/i.test(body) || status === 404) {
		return `OpenAPI URL is incorrect (HTTP ${status}, ${hintPath}). Use the console OpenAPI root, not the game receiver / sync_json. Private installs are usually http://host:8992.`;
	}
	return `OpenAPI HTTP ${status} (${hintPath}): ${snippet || 'empty response'}`;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEnvelope(obj: unknown): {
	returnCode?: number;
	message?: string;
	data?: unknown;
	stack?: string;
} {
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
	const rec = obj as Record<string, unknown>;
	const returnCode = rec.return_code ?? rec.returnCode;
	const message = rec.return_message || rec.returnMessage || rec.message || rec.error;
	const stack = rec.stackMessage || rec.stack_message || '';
	return {
		returnCode: typeof returnCode === 'number' ? returnCode : undefined,
		message: message != null ? String(message) : undefined,
		data: rec.data,
		stack: stack ? String(stack) : ''
	};
}

function teBizError(obj: unknown, fallback: string, sql?: string): Error {
	const env = parseEnvelope(obj);
	const parts = [
		env.message || fallback,
		env.returnCode !== undefined ? `return_code=${env.returnCode}` : '',
		env.stack ? `detail=${env.stack.replace(/\s+/g, ' ').slice(0, 300)}` : '',
		sql ? `sql=${sql.replace(/\s+/g, ' ').slice(0, 160)}` : ''
	].filter(Boolean);
	return new Error(parts.join('; '));
}

function assertOkEnvelope(obj: unknown, fallback: string, sql?: string) {
	const env = parseEnvelope(obj);
	if (env.returnCode === undefined) return;
	if (env.returnCode !== 0) throw teBizError(obj, fallback, sql);
}

async function teFetch(input: {
	baseUrl: string;
	path: string;
	token: string;
	method?: 'GET' | 'POST';
	query?: Record<string, string | number | undefined>;
	form?: Record<string, string>;
	jsonBody?: unknown;
	timeoutMs?: number;
}): Promise<{ status: number; text: string }> {
	const url = new URL(
		input.baseUrl.replace(/\/+$/, '') + (input.path.startsWith('/') ? input.path : `/${input.path}`)
	);
	url.searchParams.set('token', input.token);
	for (const [key, value] of Object.entries(input.query || {})) {
		if (value === undefined || value === '') continue;
		url.searchParams.set(key, String(value));
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), input.timeoutMs || OPENAPI_TIMEOUT_MS);
	try {
		const headers: Record<string, string> = {};
		let body: string | undefined;
		if (input.form) {
			headers['Content-Type'] = 'application/x-www-form-urlencoded';
			body = new URLSearchParams(input.form).toString();
		} else if (input.jsonBody !== undefined) {
			headers['Content-Type'] = 'application/json';
			body = JSON.stringify(input.jsonBody);
		}
		const res = await fetch(url.toString(), {
			method: input.method || 'GET',
			headers,
			body,
			signal: controller.signal
		});
		return { status: res.status, text: await res.text() };
	} catch (error: unknown) {
		const err = error as { name?: string; message?: string };
		if (err?.name === 'AbortError') {
			throw new Error(`OpenAPI request timed out (${Math.round((input.timeoutMs || OPENAPI_TIMEOUT_MS) / 1000)}s)`);
		}
		throw new Error(`Could not reach ThinkingData OpenAPI: ${err?.message || error}`);
	} finally {
		clearTimeout(timeout);
	}
}

function tryParseJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function rowsFromValues(headers: string[], values: unknown[]): Record<string, unknown> {
	const row: Record<string, unknown> = {};
	const cols = headers.length ? headers : values.map((_, i) => `col_${i}`);
	cols.forEach((name, idx) => {
		row[name] = values[idx];
	});
	return row;
}

function alignRowToHeaders(headers: string[], item: unknown): Record<string, unknown> {
	if (Array.isArray(item)) return rowsFromValues(headers, item);
	if (!item || typeof item !== 'object') return { value: item };
	const rec = item as Record<string, unknown>;
	if (!headers.length) return rec;
	if (rec[headers[0]] !== undefined && rec[headers[0]] !== null) return rec;
	const positional = headers.map((_, i) => rec[`col_${i}`] ?? rec[String(i)]);
	if (positional.some((value) => value !== undefined)) {
		return Object.fromEntries(headers.map((name, i) => [name, positional[i]]));
	}
	return rec;
}

function parseSqlResultText(
	text: string,
	sql?: string,
	presetHeaders: string[] = []
): { headers: string[]; rows: Record<string, unknown>[] } {
	const trimmed = text.trim();
	if (!trimmed) throw new Error('OpenAPI returned an empty result');

	const asJson = tryParseJson(trimmed);
	if (asJson) {
		assertOkEnvelope(asJson, 'OpenAPI query failed', sql);
		const rec = asJson as Record<string, unknown>;
		const payload =
			rec.data && typeof rec.data === 'object' && !Array.isArray(rec.data)
				? (rec.data as Record<string, unknown>)
				: rec;
		const headers: string[] = (payload.headers || payload.header || presetHeaders || []) as string[];
		const rawRows = payload.rows || payload.list || payload.result || (Array.isArray(payload) ? payload : []);
		if (Array.isArray(rawRows) && rawRows.length) {
			const rows = rawRows
				.slice(0, MAX_RESULT_ROWS)
				.map((item: unknown) => alignRowToHeaders(headers, item));
			const cols = headers.length ? headers : Object.keys(rows[0] || {});
			return { headers: cols, rows };
		}
		if (headers.length) return { headers, rows: [] };
	}

	const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	let headers: string[] = [...presetHeaders];
	let start = 0;
	const first = tryParseJson(lines[0] || '');
	if (first && typeof first === 'object' && !Array.isArray(first)) {
		assertOkEnvelope(first, 'OpenAPI query failed', sql);
		const rec = first as Record<string, unknown>;
		const data = rec.data as Record<string, unknown> | undefined;
		headers = (data?.headers || data?.header || rec.headers || rec.header || headers) as string[];
		start = 1;
	}

	const rows: Record<string, unknown>[] = [];
	for (let i = start; i < lines.length; i++) {
		if (rows.length >= MAX_RESULT_ROWS) break;
		const parsed = tryParseJson(lines[i]);
		if (parsed === undefined) continue;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'return_code' in parsed) {
			assertOkEnvelope(parsed, 'OpenAPI query failed', sql);
			continue;
		}
		if (Array.isArray(parsed)) {
			if (!headers.length) headers = parsed.map((_, idx) => `col_${idx}`);
			rows.push(rowsFromValues(headers, parsed));
		} else if (parsed && typeof parsed === 'object') {
			const aligned = alignRowToHeaders(headers, parsed);
			if (!headers.length) headers = Object.keys(aligned);
			rows.push(aligned);
		}
	}

	return { headers, rows };
}

async function postSql(
	baseUrl: string,
	path: string,
	token: string,
	sql: string,
	extra: { pageSize?: number } = {},
	style: TeRequestStyle
): Promise<{ status: number; text: string }> {
	const format = 'json';
	if (style === 'form') {
		const form: Record<string, string> = { sql, format, timeoutSeconds: String(SQL_TIMEOUT_SECONDS) };
		if (extra.pageSize) form.pageSize = String(extra.pageSize);
		return teFetch({ baseUrl, path, token, method: 'POST', form });
	}
	if (style === 'query') {
		const query: Record<string, string | number> = { sql, format, timeoutSeconds: SQL_TIMEOUT_SECONDS };
		if (extra.pageSize) query.pageSize = extra.pageSize;
		return teFetch({ baseUrl, path, token, method: 'POST', query });
	}
	const jsonBody: Record<string, unknown> = { sql, format, timeoutSeconds: SQL_TIMEOUT_SECONDS };
	if (extra.pageSize) jsonBody.pageSize = extra.pageSize;
	return teFetch({ baseUrl, path, token, method: 'POST', jsonBody });
}

function throwIfSqlFailed(status: number, text: string, path: string, sql: string) {
	if (status >= 400) throw new Error(teErrorText(status, text, path));
	const json = tryParseJson(text.trim().split(/\r?\n/)[0] || text);
	if (json && typeof json === 'object' && json !== null) {
		const rec = json as Record<string, unknown>;
		const code = rec.return_code ?? rec.returnCode;
		if (code !== undefined && code !== 0) throw teBizError(json, `call ${path} failed`, sql);
	}
}

async function queryViaQuerySql(
	baseUrl: string,
	token: string,
	sql: string,
	style: TeRequestStyle
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
	const { status, text } = await postSql(baseUrl, '/querySql', token, sql, {}, style);
	throwIfSqlFailed(status, text, '/querySql', sql);
	return parseSqlResultText(text, sql);
}

async function downloadSqlPages(
	config: ThinkingDataCredentials,
	taskId: string,
	pageCount: number,
	headers: string[]
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
	const rows: Record<string, unknown>[] = [];
	const pages = Math.max(1, pageCount || 1);
	for (let pageId = 0; pageId < pages; pageId++) {
		if (rows.length >= MAX_RESULT_ROWS) break;
		let gotPage = false;
		for (let attempt = 0; attempt < RESULT_POLL_ATTEMPTS; attempt++) {
			const { status, text } = await teFetch({
				baseUrl: config.url,
				path: '/open/sql-result-page',
				token: config.token,
				method: 'GET',
				query: { taskId, pageId }
			});
			if (status >= 400) throw new Error(teErrorText(status, text, '/open/sql-result-page'));
			const maybe = tryParseJson(text.trim());
			const env = parseEnvelope(maybe);
			const running =
				/task is running/i.test(text) ||
				/PENDING|RUNNING/i.test(String(env.message || '')) ||
				(env.returnCode === -1 && /running|pending/i.test(String(env.message || '')));
			if (running) {
				await sleep(RESULT_POLL_MS);
				continue;
			}
			if (maybe && env.returnCode !== undefined && env.returnCode !== 0) {
				throw new Error(env.message || `Failed to download query result (return_code=${env.returnCode})`);
			}
			const parsed = parseSqlResultText(text, `task ${taskId} page ${pageId}`, headers);
			if (!headers.length) headers = parsed.headers;
			rows.push(...parsed.rows.map((row) => alignRowToHeaders(headers, row)));
			gotPage = true;
			break;
		}
		if (!gotPage) throw new Error('Timed out waiting for OpenAPI paged results');
	}
	return { headers, rows: rows.slice(0, MAX_RESULT_ROWS) };
}

async function queryViaExecuteSql(
	config: ThinkingDataCredentials,
	sql: string,
	style: TeRequestStyle
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
	const { status, text } = await postSql(
		config.url,
		'/open/execute-sql',
		config.token,
		sql,
		{ pageSize: MAX_RESULT_ROWS },
		style
	);
	throwIfSqlFailed(status, text, '/open/execute-sql', sql);
	const json = tryParseJson(text);
	if (!json) throw new Error(teErrorText(status, text, '/open/execute-sql'));
	assertOkEnvelope(json, 'OpenAPI execute-sql failed', sql);
	const rec = json as Record<string, unknown>;
	const data = (rec.data || {}) as Record<string, unknown>;
	const headers: string[] = (data.headers || data.header || []) as string[];
	const taskId = data.taskId;
	if (!taskId) return parseSqlResultText(text, sql);
	return downloadSqlPages(config, String(taskId), Number(data.pageCount || 1), headers);
}

function requestStyles(preferred?: TeRequestStyle): TeRequestStyle[] {
	const all: TeRequestStyle[] = ['form', 'json'];
	if (!preferred || preferred === 'query') return all;
	return [preferred, ...all.filter((s) => s !== preferred)];
}

function isRetryableTransportError(message: string): boolean {
	return /HTTP 404|HTTP 405|HTTP 415|OpenAPI URL is incorrect|Could not reach|timed out|ECONNREFUSED|fetch/i.test(
		message || ''
	);
}

async function executeTeSql(
	config: ThinkingDataCredentials,
	sql: string
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
	const bases = candidateBaseUrls(config.url);
	const endpoints: TeEndpoint[] = [];
	const preferredEndpoint = endpointCache.get(config.url);
	const preferredStyle = styleCache.get(config.url);
	for (const ep of (preferredEndpoint
		? [preferredEndpoint, 'querySql', 'execute-sql']
		: ['querySql', 'execute-sql']) as TeEndpoint[]) {
		if (!endpoints.includes(ep)) endpoints.push(ep);
	}

	const errors: string[] = [];
	for (const baseUrl of bases) {
		for (const endpoint of endpoints) {
			for (const style of requestStyles(preferredStyle)) {
				if (style === 'query' && sql.length > 1800) continue;
				try {
					const result =
						endpoint === 'execute-sql'
							? await queryViaExecuteSql({ ...config, url: baseUrl }, sql, style)
							: await queryViaQuerySql(baseUrl, config.token, sql, style);
					endpointCache.set(config.url, endpoint);
					styleCache.set(config.url, style);
					baseUrlCache.set(config.url, baseUrl);
					return result;
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					errors.push(`${endpoint}/${style}: ${message}`);
					if (!isRetryableTransportError(message)) {
						throw new Error(`ThinkingData OpenAPI query failed. ${message}`);
					}
				}
			}
		}
	}
	throw new Error(`ThinkingData OpenAPI query failed. ${errors.slice(0, 4).join(' | ')}`);
}

function catalogResult(config: ThinkingDataCredentials): QueryResult {
	const tables = teQualifiedTables(config.schema, config.projectId);
	const rows = tables.all.map((fullName) => {
		const name = fullName.split('.').pop() || fullName;
		return { name, schema_name: tables.schema };
	});
	return {
		rows,
		columns: mapThinkingDataColumns(['name', 'schema_name'], rows)
	};
}

export async function executeThinkingDataQuery(
	sql: string,
	config: ThinkingDataCredentials
): Promise<QueryResult> {
	const safeSql = rewriteTeIdentifiers(
		assertReadOnlySql(sanitizeTeSql(unwrapEvidenceSubquery(sql)))
	);
	if (isShowTablesSql(safeSql)) {
		if (!config.projectId) {
			throw new Error('ThinkingData project_id is required to list ta.v_event_{id} tables');
		}
		return catalogResult(config);
	}
	assertEventTablePartDate(safeSql);
	const result = await executeTeSql(config, safeSql);
	const headers = result.headers.length ? result.headers : Object.keys(result.rows[0] || {});
	return {
		rows: result.rows,
		columns: mapThinkingDataColumns(headers, result.rows)
	};
}
