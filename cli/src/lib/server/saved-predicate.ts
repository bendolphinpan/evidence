const FORBIDDEN = /\b(SELECT|WITH|FROM|JOIN|UNION|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|OR)\b/i;

export function validateSavedPredicate(
	sql: string
): { sql: string; aliases: string[] } | { error: string } {
	const text = String(sql || '').trim();
	if (!text) return { error: '收藏需要 SQL 条件' };
	if (text.length > 2000) return { error: 'SQL 条件过长' };
	if (text.includes(';') || text.includes('--') || text.includes('/*') || text.includes('*/')) {
		return { error: '只允许一条布尔条件，不要写注释或多语句' };
	}
	if (FORBIDDEN.test(text)) return { error: '只允许 AND 连接的比较条件，不要写 OR、子查询或写库语句' };
	let depth = 0;
	for (const ch of text) {
		if (ch === '(') depth += 1;
		if (ch === ')') depth -= 1;
		if (depth < 0) return { error: '括号不配对' };
	}
	if (depth !== 0) return { error: '括号不配对' };
	const aliases = [
		...new Set([...text.matchAll(/\b([eu])\s*\./gi)].map((match) => match[1].toLowerCase()))
	];
	if (!aliases.length && text.toLowerCase() !== 'true') {
		return { error: '条件必须使用事件别名 e. 或用户别名 u.' };
	}
	return { sql: text, aliases };
}

export function predicateFitsQuery(aliases: string[], querySql: string): string | null {
	const has = (alias: string) =>
		new RegExp(String.raw`\b(?:FROM|JOIN)\s+[^\s]+\s+${alias}\b`, 'i').test(querySql);
	if (aliases.includes('e') && !has('e')) return '当前查询没有事件表别名 e，这条收藏不能套用';
	if (aliases.includes('u') && !has('u')) return '当前查询没有用户表别名 u，这条收藏不能套用';
	return null;
}
