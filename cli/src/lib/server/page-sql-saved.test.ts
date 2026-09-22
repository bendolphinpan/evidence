import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runQuery } from '$lib/server/run-query';

const DATES = `BETWEEN '2026-09-14' AND '2026-09-21'`;

function pageQueries(slug: string): { name: string; sql: string }[] {
	const cwd = process.env.EVIDENCE_PROJECT_CWD || '';
	const md = readFileSync(join(cwd, 'pages', `${slug}.md`), 'utf-8');
	const out: { name: string; sql: string }[] = [];
	for (const match of md.matchAll(/```sql\s+(\S+)\s*\n([\s\S]*?)```/g)) {
		out.push({
			name: match[1],
			sql: match[2]
				.replaceAll('{{dates.between}}', DATES)
				.replaceAll(/\{\{\s*audience\.selected\s*\}\}/g, `'real'`)
		});
	}
	return out;
}

const PAGES: Record<string, string[]> = {
	purchase: ['purchase_end', 'buy_enter'],
	'ads-show': ['ads_funnel'],
	'level-fail': ['level_funnel', 'progress_distribution'],
	'online-duration': ['online_min'],
	'level-click-death': ['click_death']
};

describe.each(Object.entries(PAGES))('page SQL with saved marker: %s', (slug, names) => {
	for (const name of names) {
		it(name, { timeout: 180_000 }, async () => {
			const query = pageQueries(slug).find((item) => item.name === name);
			expect(query, `query ${name} exists in ${slug}.md`).toBeDefined();
			expect(query!.sql).toContain('/*evd-saved*/');
			const res = await runQuery(query!.sql, { noCache: true, savedKeys: ['notest'] });
			expect(res.error, `${slug}/${name}: ${res.error}`).toBeUndefined();
			if (slug !== 'purchase') expect(res.rows.length).toBeGreaterThan(0);
		});
	}
});
