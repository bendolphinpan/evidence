import { describe, it, expect } from 'vitest';
import {
	assertEventTablePartDate,
	assertReadOnlySql,
	eventTableNeedsPartDate,
	isShowTablesSql,
	normalizeTeBaseUrl,
	rewriteTeIdentifiers,
	teQualifiedTables,
	isEvidenceCountSql,
	sanitizeTeSql,
	unwrapEvidenceSubquery
} from './sql';
import { resolveThinkingDataCredentials } from './resolve';

describe('normalizeTeBaseUrl', () => {
	it('strips querySql and trailing slash', () => {
		expect(normalizeTeBaseUrl('https://example.thinkingdata.cn/querySql').baseUrl).toBe(
			'https://example.thinkingdata.cn'
		);
	});

	it('pulls token from the URL query string', () => {
		const parsed = normalizeTeBaseUrl('https://host.example/open/sql?token=abc');
		expect(parsed.baseUrl).toBe('https://host.example');
		expect(parsed.tokenFromUrl).toBe('abc');
	});

	it('adds https when the scheme is missing', () => {
		expect(normalizeTeBaseUrl('ta.internal:8992').baseUrl).toBe('https://ta.internal:8992');
	});
});

describe('teQualifiedTables', () => {
	it('builds event/user/serial names from schema and project id', () => {
		expect(teQualifiedTables('ta', '51')).toEqual({
			schema: 'ta',
			projectId: '51',
			event: 'ta.v_event_51',
			user: 'ta.v_user_51',
			serial: 'ta.user_day_serial_51',
			all: ['ta.v_event_51', 'ta.v_user_51', 'ta.user_day_serial_51']
		});
	});
});

describe('assertReadOnlySql', () => {
	it('accepts SELECT', () => {
		expect(assertReadOnlySql('SELECT 1 AS ok')).toBe('SELECT 1 AS ok');
	});

	it('rejects INSERT at the start of the statement', () => {
		expect(() => assertReadOnlySql('INSERT INTO t VALUES (1)')).toThrow(
			/SELECT \/ WITH \/ SHOW|read-only/i
		);
	});

	it('rejects INSERT after a CTE', () => {
		expect(() =>
			assertReadOnlySql('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')
		).toThrow(/read-only/i);
	});

	it('rejects multiple statements', () => {
		expect(() => assertReadOnlySql('SELECT 1; SELECT 2')).toThrow(/Multiple/);
	});
});

describe('rewriteTeIdentifiers', () => {
	it('quotes $part_date', () => {
		expect(rewriteTeIdentifiers('WHERE $part_date >= \'2024-01-01\'')).toContain('"$part_date"');
	});

	it('rewrites $user_id to #user_id', () => {
		expect(rewriteTeIdentifiers('SELECT $user_id')).toBe('SELECT "#user_id"');
	});
});

describe('event table partition guard', () => {
	it('flags v_event queries without $part_date', () => {
		expect(eventTableNeedsPartDate('SELECT * FROM ta.v_event_51 LIMIT 1')).toBe(true);
		expect(() => assertEventTablePartDate('SELECT * FROM ta.v_event_51 LIMIT 1')).toThrow(
			/\$part_date/
		);
	});

	it('allows v_event queries that filter $part_date', () => {
		expect(
			eventTableNeedsPartDate(
				'SELECT * FROM ta.v_event_51 WHERE "$part_date" >= \'2024-01-01\' LIMIT 1'
			)
		).toBe(false);
	});
});

describe('isShowTablesSql', () => {
	it('matches SHOW TABLES', () => {
		expect(isShowTablesSql('SHOW TABLES')).toBe(true);
		expect(isShowTablesSql('show tables;')).toBe(true);
		expect(isShowTablesSql('SELECT 1')).toBe(false);
	});
});

describe('unwrapEvidenceSubquery', () => {
	it('unwraps SELECT * FROM (WITH ...) AS __ev_limit_wrap LIMIT n', () => {
		const inner = 'WITH ev AS (SELECT 1 AS ok) SELECT * FROM ev';
		const wrapped = `SELECT * FROM (${inner}\n) AS __ev_limit_wrap LIMIT 1000`;
		expect(unwrapEvidenceSubquery(wrapped)).toBe(`${inner}\nLIMIT 1000`);
	});

	it('unwraps evidence_paged wrap without relying on alias name', () => {
		const inner = 'WITH ev AS (SELECT try_cast(level AS integer) AS level FROM t) SELECT * FROM ev';
		const wrapped = `SELECT * FROM (${inner}) AS evidence_paged WHERE 1=1 LIMIT 10 OFFSET 0`;
		expect(unwrapEvidenceSubquery(wrapped).startsWith('WITH ev AS')).toBe(true);
	});

	it('unwraps SELECT * FROM (SELECT ...) table wrappers', () => {
		const inner = `SELECT series_type, level FROM (SELECT 'interval' AS series_type) result`;
		const wrapped = `SELECT * FROM (${inner}) AS evidence_paged WHERE (lower(CAST("series_type" AS varchar)) LIKE lower('%')) LIMIT 10`;
		expect(unwrapEvidenceSubquery(wrapped)).toBe(`${inner}\nLIMIT 10`);
	});

	it('leaves plain SELECT unchanged', () => {
		expect(unwrapEvidenceSubquery('SELECT 1 AS ok')).toBe('SELECT 1 AS ok');
	});

	it('does not unwrap COUNT(*) total_count into a data SELECT', () => {
		const inner = 'SELECT 1 AS ok FROM ta.v_event_51 WHERE "$part_date" = \'2026-09-18\'';
		const countSql = `SELECT COUNT(*) AS "total_count" FROM (${inner})`;
		expect(isEvidenceCountSql(countSql)).toBe(true);
		expect(unwrapEvidenceSubquery(countSql)).toBe(countSql);
	});
});

describe('sanitizeTeSql', () => {
	it('rewrites ILIKE to LIKE', () => {
		expect(sanitizeTeSql("WHERE 'x' ILIKE '%'")).toBe("WHERE 'x' LIKE '%'");
	});

	it('fills leftover {{dates.between}} placeholders', () => {
		const out = sanitizeTeSql('WHERE "$part_date" {{dates.between}}');
		expect(out).toMatch(/WHERE "\$part_date" BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'/);
	});
});

describe('resolveThinkingDataCredentials', () => {
	it('normalizes url and maps project_id', () => {
		const creds = resolveThinkingDataCredentials({
			type: 'thinkingdata',
			url: 'https://example.thinkingdata.cn/querySql',
			token: 'tok',
			project_id: '51',
			schema: 'ta'
		});
		expect(creds).toEqual({
			url: 'https://example.thinkingdata.cn',
			token: 'tok',
			projectId: '51',
			schema: 'ta'
		});
	});
});
