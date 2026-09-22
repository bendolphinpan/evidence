import { describe, expect, it } from 'vitest';
import { injectSavedClauses } from '$lib/server/saved-clause';

describe('injectSavedClauses', () => {
	it('leaves the marker when nothing is selected', () => {
		const sql = 'WHERE "$part_date" BETWEEN 1 AND 2\n  AND /*evd-saved*/ 1 = 1';
		expect(injectSavedClauses(sql, [])).toBe(sql);
	});

	it('replaces every marker with the selected predicates', () => {
		const sql = 'AND /*evd-saved*/ 1 = 1\nAND /*evd-saved*/ 1=1';
		expect(injectSavedClauses(sql, ['coalesce(is_test, false) = false', "status = 'end'"])).toBe(
			"AND (coalesce(is_test, false) = false) AND (status = 'end')\nAND (coalesce(is_test, false) = false) AND (status = 'end')"
		);
	});
});
