import { describe, it, expect } from 'vitest';
import { listTablesSql, qualifyTableName, describeTableSql } from './index';
import type {
	ClickHouseConnectionConfig,
	FabricConnectionConfig,
	DatabricksConnectionConfig,
	ThinkingDataConnectionConfig
} from './types';

const ch = (databases: string[]): ClickHouseConnectionConfig => ({
	type: 'clickhouse',
	url: 'https://h:8443',
	username: 'default',
	database: 'default',
	databases
});

const fabric = (extra: Partial<FabricConnectionConfig> = {}): FabricConnectionConfig => ({
	type: 'fabric',
	server: 'abc.datawarehouse.fabric.microsoft.com',
	database: 'analytics',
	tenantId: 't',
	clientId: 'c',
	clientSecret: 's',
	...extra
});

const databricks = (extra: Partial<DatabricksConnectionConfig> = {}): DatabricksConnectionConfig =>
	({
		type: 'databricks',
		authType: 'token',
		host: 'dbc-x.cloud.databricks.com',
		httpPath: '/sql/1.0/warehouses/abc',
		catalog: 'main',
		schema: 'default',
		token: 'dapi123',
		...extra
		// The `...extra` spread widens the token/oauth discriminant; cast back.
	}) as DatabricksConnectionConfig;

describe('listTablesSql (clickhouse)', () => {
	it('scopes to the current database when the allowlist is empty', () => {
		const sql = listTablesSql(ch([]));
		expect(sql).toContain('database = currentDatabase()');
		expect(sql).not.toContain('IN (');
	});

	it('spans exactly the allowlisted databases and labels each with its database', () => {
		const sql = listTablesSql(ch(['analytics', 'raw']));
		expect(sql).toContain("database IN ('analytics', 'raw')");
		expect(sql).toContain('database AS schema_name');
	});

	it('escapes single quotes in database names', () => {
		expect(listTablesSql(ch(["a'b"]))).toContain("IN ('a''b')");
	});
});

describe('qualifyTableName (clickhouse)', () => {
	it('qualifies a bare table with its database when a schema is given', () => {
		expect(qualifyTableName('orders', ch(['analytics']), 'analytics')).toBe('`analytics`.`orders`');
	});

	it('leaves the name bare when no schema is given', () => {
		expect(qualifyTableName('orders', ch([]))).toBe('orders');
	});

	it('does not double-qualify an already-qualified name', () => {
		expect(qualifyTableName('analytics.orders', ch(['analytics']), 'analytics')).toBe(
			'analytics.orders'
		);
	});
});

describe('listTablesSql (fabric)', () => {
	it('lists base tables schema-qualified from INFORMATION_SCHEMA', () => {
		const sql = listTablesSql(fabric());
		expect(sql).toContain('INFORMATION_SCHEMA.TABLES');
		expect(sql).toContain("TABLE_TYPE = 'BASE TABLE'");
		expect(sql).toContain("CONCAT(TABLE_SCHEMA, '.', TABLE_NAME)");
		expect(sql).not.toContain('TABLE_SCHEMA IN');
	});

	it('scopes to the schemas allowlist when set', () => {
		const sql = listTablesSql(fabric({ schemas: ['sales', 'raw'] }));
		expect(sql).toContain("TABLE_SCHEMA IN ('sales', 'raw')");
	});

	it('escapes single quotes in schema names', () => {
		expect(listTablesSql(fabric({ schemas: ["a'b"] }))).toContain("IN ('a''b')");
	});
});

describe('qualifyTableName (fabric)', () => {
	it('leaves an already-qualified name unchanged', () => {
		expect(qualifyTableName('dbo.orders', fabric({ defaultSchema: 'dbo' }))).toBe('dbo.orders');
	});

	it('qualifies a bare name with the configured default schema', () => {
		expect(qualifyTableName('orders', fabric({ defaultSchema: 'sales' }))).toBe('[sales].[orders]');
	});

	it('leaves a bare name unqualified when no default schema is set', () => {
		expect(qualifyTableName('orders', fabric())).toBe('orders');
	});
});

describe('listTablesSql (databricks)', () => {
	it('lists tables schema-qualified from information_schema, excluding information_schema', () => {
		const sql = listTablesSql(databricks());
		expect(sql).toContain('information_schema.tables');
		expect(sql).toContain("CONCAT(table_schema, '.', table_name)");
		expect(sql).toContain("table_schema <> 'information_schema'");
		expect(sql).not.toContain('table_schema IN');
	});

	it('scopes to the schemas allowlist when set', () => {
		const sql = listTablesSql(databricks({ schemas: ['sales', 'raw'] }));
		expect(sql).toContain("table_schema IN ('sales', 'raw')");
	});

	it('escapes single quotes in schema names', () => {
		expect(listTablesSql(databricks({ schemas: ["a'b"] }))).toContain("IN ('a''b')");
	});
});

describe('qualifyTableName (databricks)', () => {
	it('qualifies a bare name with the configured schema using backticks', () => {
		expect(qualifyTableName('orders', databricks({ schema: 'sales' }))).toBe('`sales`.`orders`');
	});

	it('leaves an already-qualified name unchanged', () => {
		expect(qualifyTableName('sales.orders', databricks({ schema: 'sales' }))).toBe('sales.orders');
	});
});

const te = (extra: Partial<ThinkingDataConnectionConfig> = {}): ThinkingDataConnectionConfig => ({
	type: 'thinkingdata',
	url: 'https://company.thinkingdata.cn',
	token: 'tok',
	projectId: '51',
	schema: 'ta',
	...extra
});

describe('listTablesSql (thinkingdata)', () => {
	it('returns SHOW TABLES (executor serves the local catalog)', () => {
		expect(listTablesSql(te())).toBe('SHOW TABLES');
	});

	it('requires project_id', () => {
		expect(() => listTablesSql(te({ projectId: '' }))).toThrow(/project_id/);
	});
});

describe('qualifyTableName (thinkingdata)', () => {
	it('prefixes the configured schema', () => {
		expect(qualifyTableName('v_event_51', te())).toBe('ta.v_event_51');
	});

	it('leaves an already-qualified name unchanged', () => {
		expect(qualifyTableName('ta.v_user_51', te())).toBe('ta.v_user_51');
	});
});

describe('describeTableSql (thinkingdata)', () => {
	it('adds a $part_date window for event tables', () => {
		const sql = describeTableSql('v_event_51', te());
		expect(sql).toContain('ta.v_event_51');
		expect(sql).toContain('"$part_date"');
		expect(sql).toMatch(/LIMIT 1\s*$/);
	});

	it('does not add $part_date for user tables', () => {
		const sql = describeTableSql('v_user_51', te());
		expect(sql).toBe('SELECT * FROM ta.v_user_51 LIMIT 1');
	});
});
