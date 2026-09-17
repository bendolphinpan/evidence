import { isSimpleIdentifier, wrapWithLimit } from './common';
import { PostgresDialect } from './postgres';

/**
 * ThinkingData OpenAPI SQL is Trino-flavoured: double-quoted identifiers
 * (including `$part_date` / `#user_id`) and `date_add('unit', n, col)`.
 */
export class ThinkingDataDialect extends PostgresDialect {
	readonly name = 'thinkingdata';

	dateAdd(unit: string, amount: number | string, column: string): string {
		return `date_add('${unit}', ${amount}, ${column})`;
	}

	dateSub(unit: string, amount: number | string, column: string): string {
		const negated = typeof amount === 'number' ? -amount : `-(${amount})`;
		return `date_add('${unit}', ${negated}, ${column})`;
	}

	dateLiteral(isoDate: string): string {
		return `'${isoDate}'`;
	}

	shortDateLabel(column: string): string {
		return `CAST(${column} AS varchar)`;
	}

	castToString(column: string): string {
		return `CAST(${column} AS varchar)`;
	}

	caseInsensitiveLike(column: string, pattern: string): string {
		return `lower(${column}) LIKE lower('${pattern}')`;
	}

	quoteIdentifierIfNeeded(identifier: string): string {
		if (identifier.startsWith('#') || identifier.startsWith('$')) {
			return this.quoteAlias(identifier);
		}
		return isSimpleIdentifier(identifier) ? identifier : this.quoteAlias(identifier);
	}

	applyRowLimit(sql: string, limit: number): string {
		const trimmed = sql.trim().replace(/;+$/, '');
		if (/^\s*WITH\b/i.test(trimmed)) {
			if (/\bLIMIT\s+\d+\s*$/i.test(trimmed)) return trimmed;
			return `${trimmed}\nLIMIT ${limit}`;
		}
		return wrapWithLimit(sql, limit);
	}
}
