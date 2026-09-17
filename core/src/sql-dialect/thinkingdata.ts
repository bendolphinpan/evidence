import { isSimpleIdentifier } from './common';
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

	quoteIdentifierIfNeeded(identifier: string): string {
		if (identifier.startsWith('#') || identifier.startsWith('$')) {
			return this.quoteAlias(identifier);
		}
		return isSimpleIdentifier(identifier) ? identifier : this.quoteAlias(identifier);
	}
}
