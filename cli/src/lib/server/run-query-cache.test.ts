import { describe, expect, it } from 'vitest';
import { runQuery } from '$lib/server/run-query';

describe('runQuery server cache (thinkingdata, SHOW TABLES is local)', () => {
	it('serves the second identical query from cache and bypasses on noCache', async () => {
		const first = await runQuery('SHOW TABLES');
		expect(first.error).toBeUndefined();
		expect(first.cached ?? false).toBe(false);
		expect(first.rows.length).toBeGreaterThan(0);

		const second = await runQuery('SHOW TABLES');
		expect(second.cached).toBe(true);
		expect(second.source).toBe('Cache');
		expect(second.rows).toEqual(first.rows);

		const fresh = await runQuery('SHOW TABLES', { noCache: true });
		expect(fresh.cached ?? false).toBe(false);
		expect(fresh.rows).toEqual(first.rows);
	});
});
