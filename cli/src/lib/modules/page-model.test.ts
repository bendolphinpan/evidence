import { describe, expect, it } from 'vitest';
import { applyFilterToSql, parsePage, queriesUsingFilter, serializePage } from './page-model';

const sample = `---
title: DAU / DNU
---

# DAU / DNU

口径说明。

{% range_calendar id="dates" value_column="$part_date" default_range="last 7 days" /%}

\`\`\`sql dau
SELECT 1 AS part_date, 2 AS dau
WHERE "$part_date" {{dates.between}}
\`\`\`

{% line_chart data="dau" x="part_date" y="dau" /%}

{% table data="dau" /%}
`;

describe('page-model', () => {
	it('binds charts to the sql they reference', () => {
		const nodes = parsePage(sample);
		const query = nodes.find((n) => n.type === 'query');
		expect(query?.type).toBe('query');
		if (query?.type !== 'query') return;
		expect(query.name).toBe('dau');
		expect(query.viz.map((v) => v.tag)).toEqual(['line_chart', 'table']);
		expect(nodes.some((n) => n.type === 'filter' && n.tag === 'range_calendar')).toBe(true);
	});

	it('finds which queries a calendar drives', () => {
		const nodes = parsePage(sample);
		expect(queriesUsingFilter(nodes, 'dates')).toEqual(['dau']);
	});

	it('rewrites {{dates.between}} onto a chosen filter id', () => {
		expect(applyFilterToSql('WHERE "$part_date" {{dates.between}}', 'window')).toBe(
			'WHERE "$part_date" {{window.between}}'
		);
	});

	it('round-trips data= onto the query name', () => {
		const out = serializePage(parsePage(sample));
		expect(out).toContain('```sql dau');
		expect(out).toContain('{% line_chart data="dau" x="part_date" y="dau" /%}');
		expect(out).toContain('{% table data="dau" /%}');
		expect(out).toContain('{% range_calendar');
	});
});
