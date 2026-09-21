export type Attr = { key: string; value: string };

export type Viz = { tag: string; attrs: Attr[] };

export type PageNode =
	| { type: 'frontmatter'; text: string }
	| { type: 'md'; text: string }
	| { type: 'filter'; tag: string; attrs: Attr[] }
	| { type: 'query'; name: string; sql: string; viz: Viz[] };

const VIZ_TAGS = new Set([
	'table',
	'line_chart',
	'bar_chart',
	'area_chart',
	'scatter_plot',
	'histogram',
	'big_value',
	'funnel_chart',
	'sankey_chart',
	'heatmap'
]);

const FILTER_TAGS = new Set(['range_calendar', 'dropdown', 'date_range', 'slider']);

function parseAttrs(raw: string): Attr[] {
	const attrs: Attr[] = [];
	const re = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw))) {
		attrs.push({ key: m[1], value: m[2] ?? m[3] ?? m[4] ?? '' });
	}
	return attrs;
}

function formatAttrs(attrs: Attr[]): string {
	return attrs
		.filter((a) => a.key.trim())
		.map((a) => `${a.key}="${a.value}"`)
		.join(' ');
}

function attr(attrs: Attr[], key: string): string | undefined {
	return attrs.find((a) => a.key === key)?.value;
}

function setAttr(attrs: Attr[], key: string, value: string): Attr[] {
	const next = attrs.filter((a) => a.key !== key);
	next.unshift({ key, value });
	return next;
}

type Token =
	| { kind: 'md'; text: string }
	| { kind: 'sql'; name: string; sql: string }
	| { kind: 'tag'; tag: string; attrs: Attr[] };

function tokenize(body: string): Token[] {
	const found: { start: number; end: number; token: Token }[] = [];
	const sqlRe = /```sql(?:[ \t]+(\S+))?[ \t]*\n([\s\S]*?)```/g;
	let m: RegExpExecArray | null;
	while ((m = sqlRe.exec(body))) {
		found.push({
			start: m.index,
			end: m.index + m[0].length,
			token: { kind: 'sql', name: m[1] || 'query', sql: m[2].replace(/\n$/, '') }
		});
	}
	const selfRe = /\{%\s*(\w+)([^%]*?)\s*\/%\}/g;
	while ((m = selfRe.exec(body))) {
		found.push({
			start: m.index,
			end: m.index + m[0].length,
			token: { kind: 'tag', tag: m[1], attrs: parseAttrs(m[2]) }
		});
	}
	found.sort((a, b) => a.start - b.start);
	const tokens: Token[] = [];
	let last = 0;
	for (const item of found) {
		if (item.start < last) continue;
		const prose = body.slice(last, item.start);
		if (prose.trim()) tokens.push({ kind: 'md', text: prose.replace(/^\n+|\n+$/g, '') });
		tokens.push(item.token);
		last = item.end;
	}
	const tail = body.slice(last);
	if (tail.trim()) tokens.push({ kind: 'md', text: tail.replace(/^\n+|\n+$/g, '') });
	return tokens;
}

export function parsePage(markdown: string): PageNode[] {
	let rest = markdown;
	const nodes: PageNode[] = [];
	if (rest.startsWith('---')) {
		const end = rest.indexOf('\n---', 3);
		if (end !== -1) {
			nodes.push({ type: 'frontmatter', text: rest.slice(0, end + 4).trim() });
			rest = rest.slice(end + 4);
		}
	}
	const tokens = tokenize(rest);
	const queries = new Map<string, { type: 'query'; name: string; sql: string; viz: Viz[] }>();
	for (const token of tokens) {
		if (token.kind === 'sql') {
			const q: PageNode = { type: 'query', name: token.name, sql: token.sql, viz: [] };
			queries.set(token.name, q);
			nodes.push(q);
			continue;
		}
		if (token.kind === 'tag') {
			const data = attr(token.attrs, 'data');
			if (data && VIZ_TAGS.has(token.tag) && queries.has(data)) {
				queries.get(data)!.viz.push({ tag: token.tag, attrs: token.attrs });
				continue;
			}
			if (FILTER_TAGS.has(token.tag) || !data) {
				nodes.push({ type: 'filter', tag: token.tag, attrs: token.attrs });
				continue;
			}
			nodes.push({ type: 'filter', tag: token.tag, attrs: token.attrs });
			continue;
		}
		nodes.push({ type: 'md', text: token.text });
	}
	return nodes;
}

export function serializePage(nodes: PageNode[]): string {
	return nodes
		.map((n) => {
			if (n.type === 'frontmatter') return n.text.trim();
			if (n.type === 'md') return n.text.trim();
			if (n.type === 'filter') {
				const a = formatAttrs(n.attrs);
				return a ? `{% ${n.tag} ${a} /%}` : `{% ${n.tag} /%}`;
			}
			const viz = n.viz
				.map((v) => {
					const attrs = setAttr(v.attrs, 'data', n.name);
					return `{% ${v.tag} ${formatAttrs(attrs)} /%}`;
				})
				.join('\n\n');
			const sql = `\`\`\`sql ${n.name}\n${n.sql.trim()}\n\`\`\``;
			return viz ? `${sql}\n\n${viz}` : sql;
		})
		.filter(Boolean)
		.join('\n\n') + '\n';
}

export function renameQuery(nodes: PageNode[], from: string, to: string): PageNode[] {
	return nodes.map((n) => {
		if (n.type !== 'query' || n.name !== from) return n;
		return {
			...n,
			name: to,
			viz: n.viz.map((v) => ({ ...v, attrs: setAttr(v.attrs, 'data', to) }))
		};
	});
}

export const VIZ_PRESETS: { tag: string; label: string; extra: Attr[] }[] = [
	{ tag: 'table', label: '表格', extra: [] },
	{ tag: 'line_chart', label: '折线', extra: [{ key: 'x', value: '' }, { key: 'y', value: '' }] },
	{ tag: 'bar_chart', label: '柱状', extra: [{ key: 'x', value: '' }, { key: 'y', value: '' }] },
	{
		tag: 'scatter_plot',
		label: '散点（看相关）',
		extra: [
			{ key: 'x', value: '' },
			{ key: 'y', value: '' }
		]
	}
];

export function filterIdsInSql(sql: string): string[] {
	const ids = new Set<string>();
	const re = /\{\{\s*([A-Za-z_]\w*)\./g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(sql))) ids.add(m[1]);
	return [...ids];
}

export function queriesUsingFilter(nodes: PageNode[], filterId: string): string[] {
	return nodes
		.filter((n): n is Extract<PageNode, { type: 'query' }> => n.type === 'query')
		.filter((n) => filterIdsInSql(n.sql).includes(filterId))
		.map((n) => n.name);
}

export function applyFilterToSql(sql: string, filterId: string): string {
	if (!filterId) return sql;
	if (/\{\{\s*[A-Za-z_]\w*\.between\s*\}\}/.test(sql)) {
		return sql.replace(/\{\{\s*[A-Za-z_]\w*\.between\s*\}\}/g, `{{${filterId}.between}}`);
	}
	if (/"\$part_date"/.test(sql) && /\bWHERE\b/i.test(sql)) {
		return sql.replace(/\bWHERE\b/i, `WHERE "$part_date" {{${filterId}.between}}\n  AND`);
	}
	return sql;
}

export function filterIdOf(node: Extract<PageNode, { type: 'filter' }>): string {
	return attr(node.attrs, 'id') || '';
}
