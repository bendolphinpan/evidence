import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from '$lib/server/project-cwd';
import { readStore } from './store';

type LiveProp = { name: string; display?: string; type?: string; tableType?: string; desc?: string };
type LiveEvent = { name: string; display?: string; desc?: string };
export type LiveCatalog = {
	fetchedAt: string;
	projectId: string;
	schema: string;
	tables: { event: string; user: string; serial: string };
	events: LiveEvent[];
	eventProps: LiveProp[];
	userProps: LiveProp[];
	source: 'openapi';
};

function connectionYamlCreds(): { url: string; token: string; projectId: string; schema: string } {
	const file = join(getProjectCwd(), 'connection.yaml');
	if (!existsSync(file)) return { url: '', token: '', projectId: '', schema: '' };
	const text = readFileSync(file, 'utf8');
	const pick = (key: string) => {
		const match = text.match(new RegExp(`^${key}:\\s*["']?([^"'\\n#]+)`, 'm'));
		return match ? match[1].trim() : '';
	};
	return {
		url: pick('url'),
		token: pick('token'),
		projectId: pick('project_id') || pick('projectId'),
		schema: pick('schema')
	};
}

function teCreds() {
	const te = readStore().settings.te;
	const file = connectionYamlCreds();
	return {
		url: (te.url || file.url || process.env.TE_OPENAPI_URL || '').replace(/\/+$/, ''),
		token: te.token || file.token || process.env.TE_OPENAPI_TOKEN || '',
		projectId: te.projectId || file.projectId || process.env.TE_PROJECT_ID || '51',
		schema: te.schema || file.schema || process.env.TE_SCHEMA || 'ta'
	};
}

function mapProp(raw: Record<string, unknown>, tableType: string): LiveProp | null {
	const name = String(raw.columnName || raw.name || '');
	if (!name) return null;
	return {
		name,
		display: String(raw.columnDesc || raw.columnRemark || '') || undefined,
		type: String(raw.selectType || raw.columnType || raw.propType || 'string'),
		tableType,
		desc: String(raw.columnRemark || raw.columnDesc || '') || undefined
	};
}

async function teGet(base: string, token: string, path: string, query: Record<string, string>) {
	const url = new URL(path, `${base}/`);
	url.searchParams.set('token', token);
	for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
	const res = await fetch(url);
	const text = await res.text();
	let json: { return_code?: number; return_message?: string; data?: Record<string, unknown> };
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(`OpenAPI ${path} 非 JSON：${text.slice(0, 160)}`);
	}
	if (res.status >= 400 || (json.return_code !== undefined && json.return_code !== 0)) {
		throw new Error(json.return_message || `OpenAPI ${path} HTTP ${res.status}`);
	}
	return json;
}

export async function fetchAndWriteLiveCatalog(): Promise<{
	catalog: LiveCatalog;
	paths: { snapshot: string; liveMd: string };
}> {
	const creds = teCreds();
	if (!creds.url || !creds.token) throw new Error('未配置数数 URL / Token');
	const projectId = creds.projectId;
	const schema = creds.schema;
	const eventMeta = await teGet(creds.url, creds.token, '/open/list-event-meta', { projectId });
	const eventsRaw = (eventMeta.data?.events || eventMeta.data?.list || []) as Array<Record<string, unknown>>;
	let eventPropsRaw: Array<Record<string, unknown>> = [];
	let userPropsRaw: Array<Record<string, unknown>> = [];
	try {
		const ev = await teGet(creds.url, creds.token, '/open/list-props', { projectId, tableType: 'event' });
		eventPropsRaw = (ev.data?.properties || ev.data?.list || []) as Array<Record<string, unknown>>;
	} catch {
		eventPropsRaw = [];
	}
	try {
		const us = await teGet(creds.url, creds.token, '/open/list-props', { projectId, tableType: 'user' });
		userPropsRaw = (us.data?.properties || us.data?.list || []) as Array<Record<string, unknown>>;
	} catch {
		userPropsRaw = [];
	}
	const catalog: LiveCatalog = {
		fetchedAt: new Date().toISOString(),
		projectId,
		schema,
		tables: {
			event: `${schema}.v_event_${projectId}`,
			user: `${schema}.v_user_${projectId}`,
			serial: `${schema}.user_day_serial_${projectId}`
		},
		events: eventsRaw
			.map((ev) => ({
				name: String(ev.eventName || ''),
				display: String(ev.eventDesc || ev.remark || '') || undefined,
				desc: String(ev.remark || ev.eventDesc || '') || undefined
			}))
			.filter((e) => e.name)
			.sort((a, b) => a.name.localeCompare(b.name)),
		eventProps: eventPropsRaw.map((p) => mapProp(p, 'event')).filter((p): p is LiveProp => Boolean(p)),
		userProps: userPropsRaw.map((p) => mapProp(p, 'user')).filter((p): p is LiveProp => Boolean(p)),
		source: 'openapi'
	};

	const cwd = getProjectCwd();
	const projectSync = join(cwd, 'projects', projectId, 'wiki', 'sync');
	const legacySync = join(cwd, '..', 'llm_wiki', 'sync');
	mkdirSync(projectSync, { recursive: true });
	mkdirSync(legacySync, { recursive: true });
	const snapshot = join(projectSync, 'te_live_snapshot.json');
	const payload = JSON.stringify(catalog, null, 2);
	writeFileSync(snapshot, payload, 'utf8');
	writeFileSync(join(legacySync, 'te_live_snapshot.json'), payload, 'utf8');

	const lines = [
		`# 线上数数目录（OpenAPI ${catalog.fetchedAt}）`,
		'',
		`projectId: ${projectId}`,
		`表：\`${catalog.tables.event}\` / \`${catalog.tables.user}\``,
		'',
		'## 事件',
		...catalog.events.slice(0, 200).map((e) => `- \`${e.name}\` ${e.display || ''}`),
		'',
		'## 事件属性',
		...catalog.eventProps
			.slice(0, 300)
			.map((p) => `- \`${p.name}\` ${p.display || p.type || ''} · ${catalog.tables.event}`),
		'',
		'## 用户属性',
		...catalog.userProps
			.slice(0, 300)
			.map((p) => `- \`${p.name}\` ${p.display || p.type || ''} · ${catalog.tables.user} · SQL: u."${p.name}"`)
	];
	const liveBody = lines.join('\n') + '\n';
	const projectLiveMd = join(cwd, 'projects', projectId, 'context', 'live-catalog.md');
	const legacyLiveMd = join(cwd, 'agent', 'context', 'live-catalog.md');
	mkdirSync(join(cwd, 'projects', projectId, 'context'), { recursive: true });
	mkdirSync(join(cwd, 'agent', 'context'), { recursive: true });
	writeFileSync(projectLiveMd, liveBody, 'utf8');
	writeFileSync(legacyLiveMd, liveBody, 'utf8');

	return { catalog, paths: { snapshot, liveMd: projectLiveMd } };
}
