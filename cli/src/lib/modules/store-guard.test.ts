import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreCorruptError, addSavedFilter, appendAudit, listSavedFilters, readStore } from './store';

const original = process.env.EVIDENCE_PROJECT_CWD;
let dir = '';

afterEach(() => {
	process.env.EVIDENCE_PROJECT_CWD = original;
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = '';
});

describe('store guard', () => {
	it('does not replace corrupt JSON and can write a fresh file', () => {
		dir = mkdtempSync(join(tmpdir(), 'sd-store-'));
		const project = join(dir, 'project');
		mkdirSync(join(project, 'data'), { recursive: true });
		process.env.EVIDENCE_PROJECT_CWD = project;
		const file = join(project, 'data', 'self-data.json');
		writeFileSync(file, '{broken');
		expect(() =>
			appendAudit({ userId: 'u', username: 'a', action: 'x', slug: 'dau', detail: '' })
		).toThrow(StoreCorruptError);
		expect(readFileSync(file, 'utf8')).toBe('{broken');
		rmSync(file);
		appendAudit({ userId: 'u', username: 'a', action: 'x', slug: 'dau', detail: 'ok' });
		expect(readStore().auditLog[0]?.detail).toBe('ok');
		expect(readStore().revision).toBe(1);
	});

	it('does not leak a saved filter into another project', () => {
		dir = mkdtempSync(join(tmpdir(), 'sd-store-'));
		const project = join(dir, 'project');
		mkdirSync(join(project, 'data'), { recursive: true });
		process.env.EVIDENCE_PROJECT_CWD = project;
		const created = addSavedFilter({
			projectId: '52',
			key: 'vip',
			name: 'VIP',
			description: '',
			sql: 'e.is_test = false',
			createdBy: 'test'
		});
		expect('error' in created).toBe(false);
		expect(listSavedFilters('52').some((filter) => filter.key === 'vip')).toBe(true);
		expect(listSavedFilters('51').some((filter) => filter.key === 'vip')).toBe(false);
		expect(listSavedFilters('51').some((filter) => filter.key === 'notest')).toBe(true);
	});
});
