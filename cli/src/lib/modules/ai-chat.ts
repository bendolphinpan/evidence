import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from '$lib/server/project-cwd';
import { runQuery } from '$lib/server/run-query';
import { acquireLock, readPageMarkdown, writePageMarkdown } from './pages';
import { readStore } from './store';
import type { PublicUser } from './auth';

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: unknown };

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

function loadSkills(): string {
	const dir = join(getProjectCwd(), 'agent/skills');
	if (!existsSync(dir)) return '';
	const parts: string[] = [];
	for (const name of readdirSync(dir)) {
		const file = join(dir, name, 'SKILL.md');
		const body = readCapped(file, 3500);
		if (body) parts.push(body);
	}
	return parts.join('\n\n---\n\n');
}

function catalogPath(): string {
	const cwd = getProjectCwd();
	const a = join(cwd, '..', 'llm_wiki', 'catalog.json');
	const b = join(cwd, '..', 'src', 'lib', 'wiki', 'catalog.json');
	if (existsSync(a)) return a;
	return b;
}

function liveSnapshotPath(): string {
	return join(getProjectCwd(), '..', 'llm_wiki', 'sync', 'te_live_snapshot.json');
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

function wikiLookup(query: string): string {
	const q = query.trim().toLowerCase();
	if (!q) return JSON.stringify({ error: 'query 为空' });
	try {
		const cat = JSON.parse(readFileSync(catalogPath(), 'utf8')) as {
			tables?: Record<string, string>;
			events?: Array<{ name?: string; display?: string; desc?: string }>;
			metrics?: Array<{ id?: string; name?: string; 口径?: string; sql?: string }>;
			userPropsSpec?: Array<{ name?: string; display?: string; desc?: string; type?: string }>;
			userPropsTe?: Array<{ name?: string; display?: string; desc?: string }>;
			specPublicProps?: Array<{ name?: string; display?: string; desc?: string }>;
			publicEventProps?: Array<{ name?: string; display?: string; desc?: string }>;
		};
		const props: PropHit[] = [];
		for (const p of cat.userPropsSpec || []) {
			if (!matchText(q, p.name, p.display, p.desc, '用户')) continue;
			props.push({
				name: p.name || '',
				display: p.display,
				desc: p.desc,
				table: 'ta.v_user_51',
				sql: `u."${p.name}"`,
				source: '打点需求用户属性'
			});
		}
		for (const p of cat.userPropsTe || []) {
			if (!matchText(q, p.name, p.display, p.desc)) continue;
			if (props.some((x) => x.name === p.name && x.table === 'ta.v_user_51')) continue;
			props.push({
				name: p.name || '',
				display: p.display,
				desc: p.desc,
				table: 'ta.v_user_51',
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
				table: 'ta.v_event_51',
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
			tables: cat.tables,
			props: props.slice(0, 15),
			events,
			metrics,
			hint: '用户属性必须 JOIN ta.v_user_51 并用 u."name"。事件属性在 ta.v_event_51。查询别名不是表。'
		});
	} catch (error) {
		return JSON.stringify({ error: error instanceof Error ? error.message : 'wiki 读取失败' });
	}
}

function systemPrompt(slug: string, pageMd: string): string {
	const cwd = getProjectCwd();
	const agents = readCapped(join(cwd, 'AGENTS.md'), 5000);
	const skills = loadSkills();
	const tracking = readCapped(join(cwd, 'agent/context/tracking-props.md'), 4000);
	const liveCat = readCapped(join(cwd, 'agent/context/live-catalog.md'), 3000);
	return `你是 Self-Data 报告助手。口径以打点需求 wiki 为准。写 SQL 前用 wiki_lookup 查事件和属性属于哪张表。

当前页 slug: ${slug}

## 技能
${skills}

## 打点需求列归属
${tracking || '见 agent/context/tracking-props.md'}

## 线上 OpenAPI 目录（管理页可刷新）
${liveCat || '尚未拉取。管理员可点「拉取数数最新表结构」。'}

## TE 方言
${agents || '见 AGENTS.md'}

## 当前页 markdown
${pageMd.slice(0, 5000)}

流程：wiki_lookup → 按 te-sql 写 SQL（用户属性 JOIN ta.v_user_51）→ run_sql 跑通 → patch_page。
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
			description: '查打点需求：事件名、用户/事件属性属于哪张表、口径、示例 SQL。筛国家/测试用户前必须调用。',
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

async function validatePatchMarkdown(markdown: string): Promise<string | null> {
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
			return `查询 ${fence.name} 必须 FROM ta.v_event_51（或用户表）。页内 sql 名只是别名，禁止 FROM ${fence.name}。按 te-sql 重写。`;
		}
		const sql = interpolateEvidenceSql(fence.sql);
		const result = await runQuery(sql);
		if (result.error) {
			return `查询 ${fence.name} 跑失败：${result.error.slice(0, 400)}。按 te-sql / wiki_lookup 改 SQL，不要 patch 失败查询。`;
		}
	}
	return null;
}

async function runTool(
	name: string,
	args: Record<string, string>,
	user: PublicUser
): Promise<string> {
	if (name === 'run_sql') {
		const sql = interpolateEvidenceSql(String(args.sql || ''));
		const result = await runQuery(sql);
		if (result.error) return JSON.stringify({ error: result.error });
		return JSON.stringify({
			rows: (result.rows || []).slice(0, 20),
			rowCount: result.rows?.length ?? 0
		});
	}
	if (name === 'wiki_lookup') {
		return wikiLookup(String(args.query || ''));
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
		const invalid = await validatePatchMarkdown(markdown);
		if (invalid) return JSON.stringify({ error: invalid });
		const lock = acquireLock(slug, user);
		if ('error' in lock) return JSON.stringify({ error: lock.error });
		const written = writePageMarkdown(slug, markdown);
		if ('error' in written) return JSON.stringify(written);
		return JSON.stringify({ ok: true, slug });
	}
	return JSON.stringify({ error: `未知工具 ${name}` });
}

export async function productChat(input: {
	prompt: string;
	slug: string;
	user: PublicUser;
}): Promise<{ reply: string; patched?: boolean }> {
	const cfg = aiConfig();
	if (!cfg.apiKey && cfg.provider !== 'ollama') {
		throw new Error('未配置 AI Key。请在管理页填写。');
	}
	if (cfg.provider === 'azure' && !cfg.baseUrl) {
		throw new Error('未配置 AI Base URL。');
	}
	const pageMd = readPageMarkdown(input.slug) || '';
	const target = chatTarget(cfg);
	const messages: ChatMessage[] = [
		{ role: 'system', content: systemPrompt(input.slug, pageMd) },
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

	for (let round = 0; round < maxRounds; round++) {
		const msg = await complete({ tools: TOOLS });
		const calls = msg.tool_calls;
		if (!calls?.length) {
			return { reply: msg.content || (patched ? '已按你的要求改页。' : '（无内容）'), patched };
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
			const out = await runTool(call.function.name, args, input.user);
			messages.push({ role: 'tool', tool_call_id: call.id, content: out });
		}
	}
	messages.push({
		role: 'user',
		content: '不要再调用工具。用中文简短说明已经完成或还缺什么。'
	});
	const last = await complete({});
	return {
		reply: last.content || (patched ? '已改页，请看左侧预览。' : '未改页，请把需求再说具体一点。'),
		patched
	};
}


