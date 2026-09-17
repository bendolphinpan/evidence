import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeThinkingDataQuery, resetThinkingDataClientCaches } from './thinkingdata';
import type { ThinkingDataCredentials } from '@evidence/core/connectors/thinkingdata/credentials';

const config: ThinkingDataCredentials = {
	url: 'https://example.thinkingdata.cn',
	token: 'test-token',
	projectId: '51',
	schema: 'ta'
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

afterEach(() => {
	resetThinkingDataClientCaches();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('executeThinkingDataQuery', () => {
	it('runs SELECT 1 against querySql and maps columns', async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				return_code: 0,
				data: { headers: ['ok'], rows: [[1]] }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await executeThinkingDataQuery('SELECT 1 AS ok', config);
		expect(result.rows).toEqual([{ ok: 1 }]);
		expect(result.columns.map((c) => c.name)).toEqual(['ok']);
		expect(fetchMock).toHaveBeenCalled();
		const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
		expect(calledUrl).toContain('/querySql');
		expect(calledUrl).toContain('token=test-token');
	});

	it('rejects write statements before contacting OpenAPI', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await expect(
			executeThinkingDataQuery('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', config)
		).rejects.toThrow(/read-only|Write statements/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rewrites $part_date / #user_id before sending SQL', async () => {
		let postedSql = '';
		vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
			postedSql = new URLSearchParams(String(init?.body || '')).get('sql') || '';
			return jsonResponse({
				return_code: 0,
				data: { headers: ['n'], rows: [[1]] }
			});
		});

		await executeThinkingDataQuery(
			'SELECT #user_id FROM ta.v_event_51 WHERE $part_date >= \'2024-01-01\'',
			config
		);
		expect(postedSql).toContain('"#user_id"');
		expect(postedSql).toContain('"$part_date"');
	});

	it('rejects event-table SQL that omits $part_date', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await expect(
			executeThinkingDataQuery('SELECT * FROM ta.v_event_51 LIMIT 1', config)
		).rejects.toThrow(/\$part_date/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns the local catalog for SHOW TABLES without calling OpenAPI', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const result = await executeThinkingDataQuery('SHOW TABLES', config);
		expect(result.rows.map((r) => r.name)).toEqual([
			'v_event_51',
			'v_user_51',
			'user_day_serial_51'
		]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
