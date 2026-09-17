/**
 * ThinkingData OpenAPI SQL helpers: URL normalize, table names, read-only guard,
 * #/$ identifier rewrite, and event-table partition checks.
 */

const WRITE_PATTERN =
	/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|REPLACE|LOAD|COPY|CALL|LOCK|UNLOCK|RENAME|MERGE|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i;

const ALLOWED_START = /^(WITH|SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;

const TE_DOLLAR_FIELDS = new Set([
	'part_date',
	'part_event',
	'part_date_with_timezone',
	'pt'
]);

const TE_HASH_FIELDS = new Set([
	'user_id',
	'event_time',
	'event_name',
	'account_id',
	'distinct_id',
	'app_version',
	'bundle_id',
	'city',
	'country',
	'country_code',
	'data_source',
	'device_id',
	'device_model',
	'device_type',
	'disk',
	'fps',
	'install_time',
	'ip',
	'lib',
	'lib_version',
	'manufacturer',
	'network_type',
	'os',
	'os_version',
	'province',
	'ram',
	'screen_height',
	'screen_width',
	'simulator',
	'system_language',
	'te_event_id',
	'zone_offset',
	'carrier',
	'duration',
	'screen_name',
	'title',
	'background_duration',
	'resume_from_background',
	'start_reason',
	'scene_name',
	'scene_path',
	'app_crashed_reason',
	'update_time',
	'reg_time',
	'active_time'
]);

export function sanitizeTeId(value: string): string {
	return String(value || '').replace(/[^\w]/g, '');
}

export function teQualifiedTables(
	schema: string,
	projectId: string
): {
	schema: string;
	projectId: string;
	event: string;
	user: string;
	serial: string;
	all: string[];
} {
	const ns = sanitizeTeId(schema) || 'ta';
	const id = sanitizeTeId(projectId);
	const event = `${ns}.v_event_${id}`;
	const user = `${ns}.v_user_${id}`;
	const serial = `${ns}.user_day_serial_${id}`;
	return { schema: ns, projectId: id, event, user, serial, all: id ? [event, user, serial] : [] };
}

export function normalizeTeBaseUrl(raw: string): { baseUrl: string; tokenFromUrl?: string } {
	let input = (raw || '').trim();
	if (!input) return { baseUrl: '' };
	if (!/^https?:\/\//i.test(input)) input = `https://${input}`;

	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error(`OpenAPI URL could not be parsed: ${raw}`);
	}

	const tokenFromUrl = url.searchParams.get('token') || undefined;
	url.search = '';
	url.hash = '';

	let path = url.pathname.replace(/\/+$/, '');
	path = path.replace(
		/\/(querySql|open\/execute-sql|open\/sql-result-page|open\/submit-sql|open\/sql)(\/.*)?$/i,
		''
	);
	url.pathname = path || '/';

	const baseUrl = url.toString().replace(/\/+$/, '');
	return { baseUrl, tokenFromUrl };
}

function quoteTeSpecial(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/** Fix common mix-ups of #user_id vs $user_id and $part_date vs #part_date. */
export function rewriteTeIdentifiers(sql: string): string {
	return sql.replace(/"?([#$])([A-Za-z_][\w]*)"?/g, (full, prefix: string, name: string) => {
		const key = name.toLowerCase();
		if (prefix === '$') {
			if (TE_DOLLAR_FIELDS.has(key) || TE_DOLLAR_FIELDS.has(name)) return quoteTeSpecial(`$${name}`);
			if (TE_HASH_FIELDS.has(key) || TE_HASH_FIELDS.has(name)) return quoteTeSpecial(`#${name}`);
			return full;
		}
		if (TE_HASH_FIELDS.has(key) || TE_HASH_FIELDS.has(name)) return quoteTeSpecial(`#${name}`);
		if (TE_DOLLAR_FIELDS.has(key) || TE_DOLLAR_FIELDS.has(name)) return quoteTeSpecial(`$${name}`);
		return full;
	});
}

function extractParen(sql: string, openIdx: number): { inner: string; end: number } | null {
  if (sql[openIdx] !== '(') return null;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = openIdx; i < sql.length; i++) {
    const c = sql[i];
    if (inSingle) {
      if (c === "'" && sql[i + 1] === "'") {
        i++;
        continue;
      }
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"' && sql[i + 1] === '"') {
        i++;
        continue;
      }
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return { inner: sql.slice(openIdx + 1, i), end: i };
    }
  }
  return null;
}

export function interpolateTeDatePlaceholders(sql: string): string {
  if (!/\{\{\s*dates\.between\s*\}\}/.test(sql)) return sql;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const iso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return sql.replace(/\{\{\s*dates\.between\s*\}\}/g, `BETWEEN '${iso(start)}' AND '${iso(end)}'`);
}

export function sanitizeTeSql(sql: string): string {
  return interpolateTeDatePlaceholders(sql)
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/\bformatDateTime\s*\(/gi, 'CAST(')
    .replace(/,\s*'%b %e\/%y'\s*\)/gi, ' AS varchar)');
}

export function unwrapEvidenceSubquery(sql: string): string {
  let s = sql.trim().replace(/;+$/, '');
  for (let n = 0; n < 6; n++) {
    const head = s.match(/^SELECT\s+(?:\*|COUNT\s*\(\s*\*\s*\)\s+AS\s+"?total_count"?)\s+FROM\s+\(/i);
    if (!head) break;
    const extracted = extractParen(s, head[0].length - 1);
    if (!extracted) break;
    const inner = extracted.inner.trim();
    if (!/^\s*(WITH|SELECT)\b/i.test(inner)) break;
    const rest = s.slice(extracted.end + 1);
    const limitMatch = rest.match(/LIMIT\s+(\d+)/i);
    s = inner;
    if (limitMatch && !/\bLIMIT\s+\d+\s*$/i.test(s)) s += `\nLIMIT ${limitMatch[1]}`;
  }
  return s;
}

export function assertReadOnlySql(sql: string): string {
	const clean = sql.trim().replace(/;+\s*$/, '');
	if (!clean) {
		throw new Error('SQL cannot be empty');
	}
	if (clean.length > 20000) {
		throw new Error('SQL is too long');
	}
	if (clean.includes(';')) {
		throw new Error('Multiple SQL statements are not supported');
	}
	if (!ALLOWED_START.test(clean)) {
		throw new Error('Only SELECT / WITH / SHOW / DESCRIBE / EXPLAIN are allowed');
	}
	if (WRITE_PATTERN.test(clean)) {
		throw new Error('Write statements are blocked: this connection is read-only');
	}
	return clean;
}

export function isShowTablesSql(sql: string): boolean {
	return /^\s*SHOW\s+TABLES\s*;?\s*$/i.test(sql);
}

export function eventTableNeedsPartDate(sql: string): boolean {
	if (!/\bv_event_\w+/i.test(sql)) return false;
	return !/\$part_date/i.test(sql);
}

export function assertEventTablePartDate(sql: string): void {
	if (eventTableNeedsPartDate(sql)) {
		throw new Error(
			'Event table queries must filter "$part_date" (ThinkingData partition column). Example: WHERE "$part_date" >= date_format(date_add(\'day\', -6, current_date), \'%Y-%m-%d\')'
		);
	}
}

export function localIsoDate(daysAgo = 0): string {
	const d = new Date();
	d.setDate(d.getDate() - daysAgo);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function eventProbeSql(fullName: string): string {
	return `SELECT * FROM ${fullName} WHERE "$part_date" >= '${localIsoDate(6)}' LIMIT 1`;
}

export function tableProbeSql(fullName: string): string {
	if (/v_event_\w+$/.test(fullName)) return eventProbeSql(fullName);
	return `SELECT * FROM ${fullName} LIMIT 1`;
}
