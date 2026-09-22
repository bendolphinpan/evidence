import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { getProjectCwd } from '$lib/server/project-cwd';
import { runQuery } from '$lib/server/run-query';
import { acquireLock, readPageMarkdown, writePageMarkdown } from './pages';
import {
	appendAudit,
	appendChat,
	getChat,
	listSavedFilters,
	readStore,
	searchSqlKb,
	upsertSqlKb,
	type ChatTurn
} from './store';
import type { PublicUser } from './auth';

type ChatMessage = {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	tool_calls?: unknown;
};

type SkillMeta = { name: string; description: string; triggers: string[]; body: string; path: string };

function aiConfig() {
	const stored = readStore().settings.ai;
	const provider = stored.provider || process.env.AI_PROVIDER || 'azure';
	return {
		provider,
		baseUrl: (stored.baseUrl || process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
		apiKey: stored.apiKey || process.env.AI_API_KEY || '',
		model: stored.model || process.env.AI_MODEL || '',
		apiVersion: stored.apiVersion || process.env.AI_API_VERSION || '2024-10-21'
	};
}

function chatTarget(cfg: ReturnType<typeof aiConfig>) {
	if (cfg.provider === 'azure') {
		if (cfg.baseUrl.includes('/openai/v1')) {
			return {
				url: `${cfg.baseUrl}/chat/completions`,
				headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey }
			};
		}
		const deployment = encodeURIComponent(cfg.model);
		return {
			url: `${cfg.baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(cfg.apiVersion)}`,
			headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey }
		};
	}
	const base = cfg.baseUrl || 'https://api.openai.com/v1';
	return {
		url: `${base}/chat/completions`,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }
	};
}

function readCapped(path: string, max = 12000): string {
	if (!existsSync(path)) return '';
	return readFileSync(path, 'utf8').slice(0, max);
}

function firstExisting(...paths: string[]): string | null {
	for (const p of paths) {
		if (existsSync(p)) return p;
	}
	return null;
}

/** Page frontmatter projectId → global settings.te.projectId → 51 */
export function resolveActiveProject(pageMd: string): string {
	const fm = pageMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (fm) {
		const m = fm[1].match(/^\s*projectId\s*:\s*["']?(\d+)["']?\s*$/m);
		if (m) return m[1];
	}
	const te = readStore().settings.te;
	return String(te.projectId || process.env.TE_PROJECT_ID || '51').trim() || '51';
}

function teTables(projectId: string, schema = 'ta') {
	const ns = schema || 'ta';
	const id = projectId.replace(/[^\w]/g, '') || '51';
	return {
		schema: ns,
		projectId: id,
		event: `${ns}.v_event_${id}`,
		user: `${ns}.v_user_${id}`,
		serial: `${ns}.user_day_serial_${id}`
	};
}

function catalogPath(projectId: string): string {
	const cwd = getProjectCwd();
	const hit = firstExisting(
		join(cwd, 'projects', projectId, 'wiki', 'catalog.json'),
		join(cwd, '..', 'llm_wiki', 'catalog.json'),
		join(cwd, '..', 'src', 'lib', 'wiki', 'catalog.json')
	);
	if (!hit) {
		console.warn(`[ai-chat] catalog missing for project ${projectId}`);
		return join(cwd, 'projects', projectId, 'wiki', 'catalog.json');
	}
	if (!hit.includes(`projects${sep}${projectId}`) && !hit.includes(`/projects/${projectId}/`)) {
		console.warn(`[ai-chat] using legacy catalog path: ${hit}`);
	}
	return hit;
}

function parseSkillFile(path: string): SkillMeta | null {
	const raw = readCapped(path, 12000);
	if (!raw || /兼容垫片|权威文件/.test(raw.slice(0, 200))) return null;
	const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	const body = fm ? fm[2] : raw;
	const head = fm ? fm[1] : '';
	const name = (head.match(/^name:\s*(.+)$/m)?.[1] || '').trim() || path;
	const description = (head.match(/^description:\s*(.+)$/m)?.[1] || '').trim();
	const triggersRaw = (head.match(/^triggers:\s*(.+)$/m)?.[1] || '').trim();
	const triggers = triggersRaw
		? triggersRaw.split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
		: [];
	return { name, description, triggers, body, path };
}

function listSkillDir(dir: string): SkillMeta[] {
	if (!existsSync(dir)) return [];
	const out: SkillMeta[] = [];
	for (const name of readdirSync(dir)) {
		const file = join(dir, name, 'SKILL.md');
		const meta = parseSkillFile(file);
		if (meta) out.push(meta);
	}
	return out;
}

function loadLayeredSkills(projectId: string, slug: string, prompt: string): string {
	const cwd = getProjectCwd();
	const platform = listSkillDir(join(cwd, 'platform', 'skills'));
	const project = listSkillDir(join(cwd, 'projects', projectId, 'skills'));
	// Legacy fallback if platform empty
	const legacy = platform.length ? [] : listSkillDir(join(cwd, 'agent', 'skills'));

	const parts: string[] = [];
	const budget = { platform: 4500, project: 3500, page: 3500 };
	let usedPlat = 0;
	for (const s of [...platform, ...legacy]) {
		const chunk = s.body.slice(0, 3500);
		if (usedPlat + chunk.length > budget.platform) break;
		parts.push(`### platform/${s.name}\n${chunk}`);
		usedPlat += chunk.length;
	}

	const q = `${slug} ${prompt}`.toLowerCase();
	let usedProj = 0;
	for (const s of project) {
		const pageMatch = slug === s.name || slug.includes(s.name);
		const triggerHit =
			pageMatch ||
			s.triggers.some((t) => t && q.includes(t)) ||
			q.includes(s.name.toLowerCase());
		if (!triggerHit && project.length > 1) {
			console.info(`[ai-chat] skip project skill ${s.name} (no trigger for ${slug})`);
			continue;
		}
		const chunk = s.body.slice(0, pageMatch ? budget.page : 2500);
		if (usedProj + chunk.length > budget.project + budget.page) break;
		parts.push(`### project/${projectId}/${s.name}\n${chunk}`);
		usedProj += chunk.length;
	}

	return parts.join('\n\n---\n\n');
}

type PropHit = {
	name: string;
	display?: string;
	desc?: string;
	table: string;
	sql: string;
	source: string;
};

function matchText(q: string, ...parts: Array<string | undefined>): boolean {
	return parts.join(' ').toLowerCase().includes(q);
}

function wikiLookup(query: string, projectId: string): string {
	const q = query.trim().toLowerCase();
	if (!q) return JSON.stringify({ error: 'query 为空' });
	const tables = teTables(projectId, readStore().settings.te.schema || 'ta');
	try {
		const catPath = catalogPath(projectId);
		if (!existsSync(catPath)) {
			return JSON.stringify({ error: `wiki catalog 不存在: projects/${projectId}/wiki/catalog.json` });
		}
		const cat = JSON.parse(readFileSync(catPath, 'utf8')) as {
			tables?: Record<string, string>;
			events?: Array<{ name?: string; display?: string; desc?: string }>;
			metrics?: Array<{ id?: string; name?: string; 口径?: string; sql?: string }>;
			userPropsSpec?: Array<{ name?: string; display?: string; desc?: string; type?: string }>;
			userPropsTe?: Array<{ name?: string; display?: string; desc?: string }>;
			specPublicProps?: Array<{ name?: string; display?: string; desc?: string }>;
			publicEventProps?: Array<{ name?: string; display?: string; desc?: string }>;
		};
		const userTable = cat.tables?.user || tables.user;
		const eventTable = cat.tables?.event || tables.event;
		const props: PropHit[] = [];
		for (const p of cat.userPropsSpec || []) {
			if (!matchText(q, p.name, p.display, p.desc, '用户')) continue;
			props.push({
				name: p.name || '',
				display: p.display,
				desc: p.desc,
				table: userTable,
				sql: `u."${p.name}"`,
				source: '打点需求用户属性'
			});
		}
		for (const p of cat.userPropsTe || []) {
			if (!matchText(q, p.name, p.display, p.desc)) continue;
			if (props.some((x) => x.name === p.name && x.table === userTable)) continue;
			props.push({
				name: p.name || '',
				display: p.display,
				desc: p.desc,
				table: userTable,
				sql: `u."${p.name}"`,
				source: 'TE 用户表导出'
			});
		}
		for (const p of [...(cat.specPublicProps || []), ...(cat.publicEventProps || [])]) {
			if (!matchText(q, p.name, p.display, p.desc)) continue;
			const name = p.name || '';
			const quoted = name.startsWith('#') || name.startsWith('$') ? `"${name}"` : name;
			props.push({
				name,
				display: p.display,
				desc: p.desc,
				table: eventTable,
				sql: quoted,
				source: '打点需求/TE 事件属性'
			});
		}
		const events = (cat.events || [])
			.filter((e) => matchText(q, e.name, e.display, e.desc))
			.slice(0, 8)
			.map((e) => ({ name: e.name, display: e.display, desc: e.desc }));
		const metrics = (cat.metrics || [])
			.filter((m) => matchText(q, m.id, m.name, m.口径))
			.slice(0, 4)
			.map((m) => ({ id: m.id, name: m.name, 口径: m.口径, sql: (m.sql || '').slice(0, 600) }));
		return JSON.stringify({
			projectId,
			tables: cat.tables || tables,
			props: props.slice(0, 15),
			events,
			metrics,
			hint: `用户属性必须 JOIN ${userTable} 并用 u."name"。事件属性在 ${eventTable}。查询别名不是表。`
		});
	} catch (error) {
		return JSON.stringify({ error: error instanceof Error ? error.message : 'wiki 读取失败' });
	}
}

function systemPrompt(slug: string, pageMd: string, projectId: string, prompt: string): string {
	const cwd = getProjectCwd();
	const tables = teTables(projectId, readStore().settings.te.schema || 'ta');
	const platformAgents = readCapped(join(cwd, 'platform', 'AGENTS.md'), 4000);
	const agents =
		platformAgents ||
		readCapped(join(cwd, 'AGENTS.md'), 4000);
	const projectCtx = readCapped(join(cwd, 'projects', projectId, 'context', 'gaps.md'), 2500);
	const tracking =
		readCapped(join(cwd, 'projects', projectId, 'context', 'tracking-props.md'), 4000) ||
		readCapped(join(cwd, 'agent/context/tracking-props.md'), 4000);
	const liveCat =
		readCapped(join(cwd, 'projects', projectId, 'context', 'live-catalog.md'), 3000) ||
		readCapped(join(cwd, 'agent/context/live-catalog.md'), 3000);
	const skills = loadLayeredSkills(projectId, slug, prompt);
	return `你是 Self-Data 报告助手。口径以当前项目 wiki 为准。写 SQL 前用 wiki_lookup。

当前页 slug: ${slug}
活跃 projectId: ${projectId}
表: ${tables.event} / ${tables.user}

## 技能（平台 → 项目 → 当前页相关）
${skills || '（无 skill）'}

## 打点需求列归属
${tracking || '见 projects/' + projectId + '/context/tracking-props.md'}

## 项目 Gaps
${projectCtx || '无'}

## 线上 OpenAPI 目录
${liveCat || '尚未拉取。管理员可点「拉取数数最新表结构」。'}

## TE 方言（平台）
${agents || '见 platform/AGENTS.md'}

## 当前页 markdown
${pageMd.slice(0, 5000)}

流程：wiki_lookup / search_sql_kb / search_saved_filters → 按 te-sql 写 SQL（用户属性 JOIN ${tables.user}）→ run_sql 跑通 → patch_page。收藏条件由顶栏筛选抽屉套用：页内 SQL 留 AND /*evd-saved*/ 1 = 1，不要再写 saved dropdown 或按 key 分支。用户要新建收藏时告诉他去顶栏筛选里点「收藏」。
禁止 FROM 查询别名。不要输出 Token。`;
}

const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'run_sql',
			description: '对 ThinkingData 跑只读 SQL，返回最多 20 行',
			parameters: {
				type: 'object',
				properties: { sql: { type: 'string' } },
				required: ['sql']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_page',
			description: '读取某报告页的 markdown',
			parameters: {
				type: 'object',
				properties: { slug: { type: 'string' } },
				required: ['slug']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'wiki_lookup',
			description: '查当前项目打点需求：事件名、属性表归属、口径。筛国家/测试用户前必须调用。',
			parameters: {
				type: 'object',
				properties: { query: { type: 'string' } },
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_sql_kb',
			description: '按事件/指标指纹搜索本项目已成功跑通的 SQL 预览',
			parameters: {
				type: 'object',
				properties: { query: { type: 'string' } },
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_saved_filters',
			description: '查当前项目收藏筛选库：key、名字、描述、SQL 条件。用户说“用收藏XX筛选”时调用。套用靠地址栏 ?saved=key 和页内 AND /*evd-saved*/ 1 = 1，不要在页里按 key 写分支。',
			parameters: {
				type: 'object',
				properties: { query: { type: 'string' } },
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'patch_page',
			description: '用完整 markdown 覆盖当前或指定页。调用者必须能编辑且持锁。',
			parameters: {
				type: 'object',
				properties: {
					slug: { type: 'string' },
					markdown: { type: 'string' }
				},
				required: ['slug', 'markdown']
			}
		}
	}
];

const ALLOWED_TAG_ATTRS: Record<string, string[]> = {
	range_calendar: ['id', 'value_column', 'default_range'],
	table: ['data'],
	line_chart: ['data', 'x', 'y', 'series'],
	bar_chart: ['data', 'x', 'y', 'series'],
	area_chart: ['data', 'x', 'y', 'series'],
	scatter_plot: ['data', 'x', 'y', 'series']
};

function last7DaysBetween(): string {
	const end = new Date();
	const start = new Date();
	start.setDate(start.getDate() - 6);
	const iso = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	return `BETWEEN '${iso(start)}' AND '${iso(end)}'`;
}

function interpolateEvidenceSql(sql: string): string {
	return sql
		.replace(/\{\{\s*dates\.between\s*\}\}/g, last7DaysBetween())
		.replace(/\{\{\s*audience\.selected\s*\}\}/g, "'real'");
}

function sqlFingerprint(sql: string): { fingerprint: string; events: string[] } {
	const events = [...sql.matchAll(/"\$part_event"\s*=\s*'([^']+)'/g)].map((m) => m[1]);
	const hasAgg = /\bCOUNT\s*\(|\bSUM\s*\(|\bAVG\s*\(/i.test(sql);
	const hasJoin = /\bJOIN\b/i.test(sql);
	const fingerprint = [
		events.sort().join('+') || 'no-event',
		hasAgg ? 'agg' : 'raw',
		hasJoin ? 'join' : 'single',
		/\bGROUP\s+BY\b/i.test(sql) ? 'group' : 'nogroup'
	].join('|');
	return { fingerprint, events };
}

async function validatePatchMarkdown(markdown: string, projectId: string): Promise<string | null> {
	const tables = teTables(projectId);
	const tagRe = /\{%\s*(\w+)([^%]*?)\/%\}/g;
	let m: RegExpExecArray | null;
	while ((m = tagRe.exec(markdown))) {
		const tag = m[1];
		const raw = m[2];
		const allowed = ALLOWED_TAG_ATTRS[tag];
		if (!allowed) continue;
		const attrRe = /(\w[\w-]*)\s*=/g;
		let a: RegExpExecArray | null;
		while ((a = attrRe.exec(raw))) {
			if (!allowed.includes(a[1])) {
				return `{% ${tag} %} 不支持属性 ${a[1]}。允许：${allowed.join(', ')}。低转化用 SQL 里的 CASE 列 + series=，不要 color=。`;
			}
		}
	}
	const sqlRe = /```sql(?:[ \t]+(\S+))?[ \t]*\n([\s\S]*?)```/g;
	const fences: { name: string; sql: string }[] = [];
	while ((m = sqlRe.exec(markdown))) {
		fences.push({ name: m[1] || 'query', sql: m[2] });
	}
	if (!fences.length) return '改页必须包含 ```sql name 查询。图表 data= 必须等于这个 name，name 不是数数表。';
	for (const fence of fences) {
		if (!/ta\.v_event_\d+|ta\.v_user_\d+|ta\.user_day_serial_\d+/.test(fence.sql)) {
			return `查询 ${fence.name} 必须 FROM ${tables.event}（或用户表）。页内 sql 名只是别名，禁止 FROM ${fence.name}。按 te-sql 重写。`;
		}
		const sql = interpolateEvidenceSql(fence.sql);
		const result = await runQuery(sql);
		if (result.error) {
			return `查询 ${fence.name} 跑失败：${result.error.slice(0, 400)}。按 te-sql / wiki_lookup 改 SQL，不要 patch 失败查询。`;
		}
	}
	return null;
}

function rememberSuccessfulSql(projectId: string, sql: string) {
	const { fingerprint, events } = sqlFingerprint(sql);
	const sqlHash = createHash('sha256').update(sql).digest('hex').slice(0, 16);
	let wikiVersion = '';
	try {
		const cat = JSON.parse(readFileSync(catalogPath(projectId), 'utf8')) as { projectId?: unknown };
		wikiVersion = String(cat.projectId ?? projectId);
	} catch {
		wikiVersion = projectId;
	}
	upsertSqlKb({
		projectId,
		fingerprint,
		sqlHash,
		sqlPreview: sql.replace(/\s+/g, ' ').slice(0, 240),
		wikiVersion,
		eventHints: events
	});
}

async function runTool(
	name: string,
	args: Record<string, string>,
	user: PublicUser,
	projectId: string
): Promise<string> {
	if (user.role === 'viewer' && !['wiki_lookup', 'read_page'].includes(name)) {
		return JSON.stringify({ error: 'viewer 只能查口径和读页面' });
	}
	if (name === 'run_sql') {
		const sql = interpolateEvidenceSql(String(args.sql || ''));
		const result = await runQuery(sql);
		if (result.error) return JSON.stringify({ error: result.error });
		rememberSuccessfulSql(projectId, sql);
		return JSON.stringify({
			rows: (result.rows || []).slice(0, 20),
			rowCount: result.rows?.length ?? 0
		});
	}
	if (name === 'wiki_lookup') {
		return wikiLookup(String(args.query || ''), projectId);
	}
	if (name === 'search_sql_kb') {
		return JSON.stringify({
			projectId,
			hits: searchSqlKb(projectId, String(args.query || ''))
		});
	}
	if (name === 'search_saved_filters') {
		const q = String(args.query || '').trim().toLowerCase();
		const hits = listSavedFilters(projectId)
			.filter(
				(f) =>
					!q ||
					f.name.toLowerCase().includes(q) ||
					(f.description || '').toLowerCase().includes(q) ||
					f.sql.toLowerCase().includes(q)
			)
			.slice(0, 10);
		return JSON.stringify({ projectId, hits });
	}
	if (name === 'read_page') {
		const md = readPageMarkdown(String(args.slug || ''));
		if (md === null) return JSON.stringify({ error: '页面不存在' });
		return md.slice(0, 12000);
	}
	if (name === 'patch_page') {
		if (user.role === 'viewer') return JSON.stringify({ error: 'viewer 不能改页' });
		const slug = String(args.slug || '');
		const markdown = String(args.markdown || '');
		const invalid = await validatePatchMarkdown(markdown, projectId);
		if (invalid) return JSON.stringify({ error: invalid });
		const lock = acquireLock(slug, user);
		if ('error' in lock) return JSON.stringify({ error: lock.error });
		const written = writePageMarkdown(slug, markdown);
		if ('error' in written) return JSON.stringify(written);
		appendAudit({
			userId: user.id,
			username: user.username,
			action: 'patch_page',
			slug,
			detail: `projectId=${projectId}`
		});
		return JSON.stringify({ ok: true, slug, projectId });
	}
	return JSON.stringify({ error: `未知工具 ${name}` });
}

export async function productChat(input: {
	prompt: string;
	slug: string;
	user: PublicUser;
}): Promise<{ reply: string; patched?: boolean; projectId: string }> {
	const cfg = aiConfig();
	if (!cfg.apiKey && cfg.provider !== 'ollama') {
		throw new Error('未配置 AI Key。请在管理页填写。');
	}
	if (cfg.provider === 'azure' && !cfg.baseUrl) {
		throw new Error('未配置 AI Base URL。');
	}
	const pageMd = readPageMarkdown(input.slug) || '';
	const projectId = resolveActiveProject(pageMd);
	const target = chatTarget(cfg);

	const history: ChatTurn[] = getChat(input.user.id, projectId, input.slug).slice(-12);

	const messages: ChatMessage[] = [
		{ role: 'system', content: systemPrompt(input.slug, pageMd, projectId, input.prompt) },
		...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.text })),
		{ role: 'user', content: input.prompt }
	];
	let patched = false;
	const maxRounds = 10;

	async function complete(extra?: Record<string, unknown>) {
		const body: Record<string, unknown> = {
			model: cfg.model,
			messages,
			...extra
		};
		const res = await fetch(target.url, {
			method: 'POST',
			headers: target.headers,
			body: JSON.stringify(body)
		});
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`模型接口 HTTP ${res.status}: ${text.slice(0, 300)}`);
		}
		const json = JSON.parse(text) as {
			choices?: Array<{
				message?: {
					content?: string;
					tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
				};
			}>;
		};
		const msg = json.choices?.[0]?.message;
		if (!msg) throw new Error('模型无返回');
		return msg;
	}

	let reply = '';
	for (let round = 0; round < maxRounds; round++) {
		const tools =
			input.user.role === 'viewer'
				? TOOLS.filter((tool) => ['wiki_lookup', 'read_page'].includes(tool.function.name))
				: TOOLS;
		const msg = await complete({ tools });
		const calls = msg.tool_calls;
		if (!calls?.length) {
			reply = msg.content || (patched ? '已按你的要求改页。' : '（无内容）');
			break;
		}
		messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
		for (const call of calls) {
			let args: Record<string, string> = {};
			try {
				args = JSON.parse(call.function.arguments || '{}');
			} catch {
				args = {};
			}
			if (call.function.name === 'patch_page') patched = true;
			const out = await runTool(call.function.name, args, input.user, projectId);
			messages.push({ role: 'tool', tool_call_id: call.id, content: out });
		}
	}
	if (!reply) {
		messages.push({
			role: 'user',
			content: '不要再调用工具。用中文简短说明已经完成或还缺什么。'
		});
		const last = await complete({});
		reply = last.content || (patched ? '已改页，请看左侧预览。' : '未改页，请把需求再说具体一点。');
	}

	const now = new Date().toISOString();
	appendChat(input.user.id, projectId, input.slug, [
		{ role: 'user', text: input.prompt, at: now },
		{ role: 'assistant', text: reply, at: now }
	]);

	return { reply, patched, projectId };
}
