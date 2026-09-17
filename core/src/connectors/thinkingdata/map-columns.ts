import type { Column } from '../../user-components/interfaces/query-service';

export type ThinkingDataJsType = Column['jsType'];

function inferJsType(value: unknown): ThinkingDataJsType {
	if (value === null || value === undefined) return 'unknown';
	if (typeof value === 'number' && Number.isFinite(value)) return 'number';
	if (typeof value === 'boolean') return 'boolean';
	if (value instanceof Date) return 'date';
	if (typeof value === 'string') {
		if (/^-?\d+(\.\d+)?$/.test(value) && value.length < 16) return 'number';
		if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(value)) return 'date';
		return 'string';
	}
	if (typeof value === 'object') return 'object';
	return 'string';
}

export function mapThinkingDataColumns(
	headers: string[],
	sampleRows: Record<string, unknown>[] = []
): Column[] {
	return headers.map((name) => {
		let jsType: ThinkingDataJsType = 'unknown';
		for (const row of sampleRows) {
			const inferred = inferJsType(row[name]);
			if (inferred !== 'unknown') {
				jsType = inferred;
				break;
			}
		}
		if (jsType === 'unknown') jsType = 'string';
		return {
			name,
			clickhouseType: jsType === 'number' ? 'Float64' : jsType === 'date' ? 'DateTime' : 'String',
			jsType
		};
	});
}
