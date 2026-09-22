import { describe, expect, it } from 'vitest';
import { predicateFitsQuery, validateSavedPredicate } from './saved-predicate';

describe('validateSavedPredicate', () => {
	it('accepts an event-alias comparison', () => {
		const result = validateSavedPredicate('coalesce(e.is_test, false) = false');
		expect(result).toEqual({ sql: 'coalesce(e.is_test, false) = false', aliases: ['e'] });
	});

	it('rejects OR escape, subqueries, and unbalanced parentheses', () => {
		expect('error' in validateSavedPredicate('e.is_test = false) OR (true')).toBe(true);
		expect('error' in validateSavedPredicate('e."#user_id" IN (SELECT 1)')).toBe(true);
		expect('error' in validateSavedPredicate('(e.is_test = false')).toBe(true);
	});

	it('requires e or u', () => {
		expect('error' in validateSavedPredicate('is_test = false')).toBe(true);
	});
});

describe('predicateFitsQuery', () => {
	it('rejects a user predicate on an event-only query', () => {
		expect(predicateFitsQuery(['u'], 'FROM ta.v_event_51 e')).toMatch(/用户表别名/);
		expect(predicateFitsQuery(['e'], 'FROM ta.v_event_51 e LEFT JOIN ta.v_user_51 u')).toBeNull();
	});
});
