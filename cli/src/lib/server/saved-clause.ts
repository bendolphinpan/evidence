/** Marker pages leave in WHERE. Empty selection keeps `1 = 1`; selected favorites replace it. */
export function injectSavedClauses(sql: string, clauses: string[]): string {
	if (!clauses.length || !sql.includes('/*evd-saved*/')) return sql;
	const predicate = clauses.map((clause) => `(${clause})`).join(' AND ');
	return sql.replace(/\/\*evd-saved\*\/\s*1\s*=\s*1/g, predicate);
}
