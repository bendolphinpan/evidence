import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getProjectCwd } from '$lib/server/project-cwd';
import { validateSavedPredicate } from '$lib/server/saved-predicate';

export type Role = 'admin' | 'editor' | 'viewer';

export type UserRecord = {
	id: string;
	username: string;
	passwordHash: string;
	role: Role;
	disabled: boolean;
	createdAt: string;
};

export type SessionRecord = { id: string; userId: string; expiresAt: string };

export type PageLock = { slug: string; userId: string; username: string; expiresAt: string };

export type TeSettings = { url: string; token: string; projectId: string; schema: string };
export type AiSettings = {
	provider: string;
	baseUrl: string;
	apiKey: string;
	model: string;
	apiVersion: string;
};

export type ChatTurn = { role: 'user' | 'assistant'; text: string; at: string };

export type ChatRecord = {
	userId: string;
	projectId: string;
	slug: string;
	messages: ChatTurn[];
	updatedAt: string;
};

/** Fingerprint only — full SQL remains in page fences. */
export type SqlKbRecord = {
	projectId: string;
	fingerprint: string;
	sqlHash: string;
	sqlPreview: string;
	wikiVersion: string;
	eventHints: string[];
	updatedAt: string;
	hitCount: number;
};

export type AuditRecord = {
	at: string;
	userId: string;
	username: string;
	action: string;
	slug?: string;
	detail?: string;
};

/**
 * Saved content filter: a named boolean SQL fragment scoped to a project.
 * Pages reference it by id in a `saved` dropdown and inline the matching
 * branch in their SQL (see platform report-edit skill). The fragment itself
 * must be a boolean expression over the page's event/user aliases —
 * never a full SELECT (page-level patch validation re-runs the whole SQL
 * through the read-only guard before it can land).
 */
export type SavedFilter = {
	id: string;
	/** Stable per-project key used in ?saved= (e.g. "notest"). Pages do not branch on it. */
	key: string;
	projectId: string;
	name: string;
	description: string;
	sql: string;
	/** Table aliases the predicate needs, e.g. ["e"] or ["e","u"]. */
	aliases: string[];
	createdBy: string;
	updatedAt: string;
};

export type AppState = {
	users: UserRecord[];
	sessions: SessionRecord[];
	pageLocks: PageLock[];
	settings: { te: TeSettings; ai: AiSettings };
	chats: ChatRecord[];
	sqlKb: SqlKbRecord[];
	auditLog: AuditRecord[];
	savedFilters: SavedFilter[];
	revision: number;
};

const EMPTY: AppState = {
	users: [],
	sessions: [],
	pageLocks: [],
	settings: {
		te: { url: '', token: '', projectId: '51', schema: 'ta' },
		ai: { provider: 'azure', baseUrl: '', apiKey: '', model: '', apiVersion: '2024-10-21' }
	},
	chats: [],
	sqlKb: [],
	auditLog: [],
	savedFilters: [],
	revision: 0
};

const MAX_CHAT_TURNS = 40; // 20 rounds
const MAX_SQL_KB = 200;
const MAX_AUDIT = 500;

export function storePath(): string {
	const cwd = getProjectCwd();
	const parent = resolve(cwd, '..', 'data', 'self-data.json');
	if (existsSync(parent)) return parent;
	return resolve(cwd, 'data', 'self-data.json');
}

export class StoreCorruptError extends Error {
	constructor(path: string) {
		super(`状态文件损坏，已拒绝写回：${path}`);
		this.name = 'StoreCorruptError';
	}
}

function readState(): AppState {
	const loaded = loadState();
	if (loaded.corrupt) throw new StoreCorruptError(storePath());
	return loaded.state;
}

function loadState(): { state: AppState; corrupt: boolean } {
	const file = storePath();
	if (!existsSync(file)) return { state: structuredClone(EMPTY), corrupt: false };
	let text = '';
	try {
		text = readFileSync(file, 'utf8');
		const raw = JSON.parse(text) as Partial<AppState>;
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			return { state: structuredClone(EMPTY), corrupt: true };
		}
		return {
			corrupt: false,
			state: {
				users: Array.isArray(raw.users) ? raw.users : [],
				sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
				pageLocks: Array.isArray(raw.pageLocks) ? raw.pageLocks : [],
				settings: {
					te: { ...EMPTY.settings.te, ...(raw.settings?.te || {}) },
					ai: { ...EMPTY.settings.ai, ...(raw.settings?.ai || {}) }
				},
				chats: Array.isArray(raw.chats) ? raw.chats : [],
				sqlKb: Array.isArray(raw.sqlKb) ? raw.sqlKb : [],
				auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : [],
				savedFilters: Array.isArray(raw.savedFilters) ? raw.savedFilters : [],
				revision: Number(raw.revision) || 0
			}
		};
	} catch {
		return { state: structuredClone(EMPTY), corrupt: text.trim().length > 0 };
	}
}

function writeState(state: AppState): void {
	const file = storePath();
	mkdirSync(dirname(file), { recursive: true });
	if (existsSync(file)) {
		try {
			copyFileSync(file, `${file}.bak`);
		} catch {
			// backup is best-effort; the write still goes through a temp file
		}
	}
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
	renameSync(tmp, file);
}

function sleep(ms: number) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withFileLock<T>(fn: () => T): T {
	const lock = `${storePath()}.lock`;
	mkdirSync(dirname(lock), { recursive: true });
	const start = Date.now();
	let fd: number | null = null;
	while (fd === null) {
		try {
			fd = openSync(lock, 'wx');
		} catch {
			if (Date.now() - start > 5000) throw new Error('状态文件锁超时');
			sleep(20);
		}
	}
	try {
		return fn();
	} finally {
		closeSync(fd);
		try {
			unlinkSync(lock);
		} catch {
			// another waiter may already have recreated it
		}
	}
}

export function withStore<T>(fn: (state: AppState) => T): T {
	return withFileLock(() => {
		const loaded = loadState();
		if (loaded.corrupt) throw new StoreCorruptError(storePath());
		const seen = loaded.state.revision || 0;
		const result = fn(loaded.state);
		const again = loadState();
		if (again.corrupt) throw new StoreCorruptError(storePath());
		if ((again.state.revision || 0) !== seen) {
			throw new Error('状态文件在写入前已变化，请重试');
		}
		loaded.state.revision = seen + 1;
		writeState(loaded.state);
		return result;
	});
}

export function readStore(): AppState {
	return readState();
}

export function modulesEnabled(): { auth: boolean; editor: boolean } {
	try {
		const raw = readFileSync(join(getProjectCwd(), 'evidence.config.yaml'), 'utf8');
		const auth = /auth:\s*true/.test(raw);
		const editor = /editor:\s*true/.test(raw);
		return { auth, editor };
	} catch {
		return { auth: false, editor: false };
	}
}

export function getChat(userId: string, projectId: string, slug: string): ChatTurn[] {
	const state = readState();
	const hit = state.chats.find(
		(c) => c.userId === userId && c.projectId === projectId && c.slug === slug
	);
	return hit?.messages || [];
}

export function appendChat(
	userId: string,
	projectId: string,
	slug: string,
	turns: ChatTurn[]
): ChatTurn[] {
	return withStore((state) => {
		let hit = state.chats.find(
			(c) => c.userId === userId && c.projectId === projectId && c.slug === slug
		);
		if (!hit) {
			hit = { userId, projectId, slug, messages: [], updatedAt: new Date().toISOString() };
			state.chats.push(hit);
		}
		hit.messages = [...hit.messages, ...turns].slice(-MAX_CHAT_TURNS);
		hit.updatedAt = new Date().toISOString();
		return hit.messages;
	});
}

export function upsertSqlKb(entry: Omit<SqlKbRecord, 'updatedAt' | 'hitCount'> & { hitCount?: number }) {
	withStore((state) => {
		const idx = state.sqlKb.findIndex(
			(r) => r.projectId === entry.projectId && r.fingerprint === entry.fingerprint
		);
		const next: SqlKbRecord = {
			...entry,
			hitCount: (idx >= 0 ? state.sqlKb[idx].hitCount : 0) + 1,
			updatedAt: new Date().toISOString()
		};
		if (idx >= 0) state.sqlKb[idx] = next;
		else state.sqlKb.unshift(next);
		if (state.sqlKb.length > MAX_SQL_KB) state.sqlKb = state.sqlKb.slice(0, MAX_SQL_KB);
	});
}

export function searchSqlKb(projectId: string, query: string): SqlKbRecord[] {
	const q = query.trim().toLowerCase();
	const state = readState();
	return state.sqlKb
		.filter((r) => r.projectId === projectId)
		.filter(
			(r) =>
				!q ||
				r.fingerprint.toLowerCase().includes(q) ||
				r.eventHints.some((h) => h.toLowerCase().includes(q)) ||
				r.sqlPreview.toLowerCase().includes(q)
		)
		.slice(0, 8);
}

export function listAudit(limit = 30): AuditRecord[] {
	return readStore().auditLog.slice(0, limit);
}

export function appendAudit(entry: Omit<AuditRecord, 'at'> & { at?: string }) {
	withStore((state) => {
		state.auditLog.unshift({ ...entry, at: entry.at || new Date().toISOString() });
		if (state.auditLog.length > MAX_AUDIT) state.auditLog = state.auditLog.slice(0, MAX_AUDIT);
	});
}

function newFilterId(): string {
	return `flt_${randomBytes(4).toString('hex')}`;
}

function sanitizeSavedFilter(input: {
	key: string;
	name: string;
	description: string;
	sql: string;
}): { key: string; name: string; description: string; sql: string; aliases: string[] } | { error: string } {
	const key = String(input.key || '')
		.trim()
		.toLowerCase()
		.slice(0, 40);
	const name = String(input.name || '').trim().slice(0, 60);
	const description = String(input.description || '').trim().slice(0, 300);
	if (!key) return { error: '收藏需要 key（页内分支用）' };
	if (!/^[a-z][a-z0-9_]*$/.test(key)) return { error: 'key 只允许小写字母/数字/下划线，字母开头' };
	if (key === 'none') return { error: 'key 不能叫 none（保留值）' };
	if (!name) return { error: '收藏需要名字' };
	const predicate = validateSavedPredicate(input.sql);
	if ('error' in predicate) return predicate;
	return { key, name, description, sql: predicate.sql, aliases: predicate.aliases };
}

const BUILTIN_NOTEST: SavedFilter = {
	id: 'builtin-notest',
	key: 'notest',
	projectId: '51',
	name: '排除测试流量',
	description: '只去掉事件表测试包，不是真实用户口径。真实用户用页内对象筛选。',
	sql: 'coalesce(e.is_test, false) = false',
	aliases: ['e'],
	createdBy: 'system',
	updatedAt: ''
};

export function listSavedFilters(projectId: string): SavedFilter[] {
	const state = readState();
	const rows = state.savedFilters
		.filter((f) => f.projectId === projectId)
		.map((filter) => {
			if (filter.aliases?.length) return filter;
			const parsed = validateSavedPredicate(filter.sql);
			return 'error' in parsed ? { ...filter, aliases: [] } : { ...filter, aliases: parsed.aliases };
		});
	if (projectId === '51' && !rows.some((filter) => filter.key === 'notest')) {
		rows.push(BUILTIN_NOTEST);
	}
	return rows;
}

export function addSavedFilter(input: {
	projectId: string;
	key: string;
	name: string;
	description: string;
	sql: string;
	createdBy: string;
}): SavedFilter | { error: string } {
	const clean = sanitizeSavedFilter(input);
	if ('error' in clean) return clean;
	const projectId = String(input.projectId || '51').trim() || '51';
	return withStore((state) => {
		if (state.savedFilters.some((f) => f.projectId === projectId && f.key === clean.key)) {
			return { error: `项目 ${projectId} 已有 key=${clean.key} 的收藏` };
		}
		const row: SavedFilter = {
			id: newFilterId(),
			projectId,
			...clean,
			createdBy: String(input.createdBy || ''),
			updatedAt: new Date().toISOString()
		};
		state.savedFilters.unshift(row);
		return row;
	});
}

export function updateSavedFilter(
	id: string,
	patch: { key?: string; name?: string; description?: string; sql?: string }
): SavedFilter | { error: string } {
	return withStore((state) => {
		const idx = state.savedFilters.findIndex((f) => f.id === id);
		if (idx < 0) return { error: '收藏不存在' };
		const cur = state.savedFilters[idx];
		const clean = sanitizeSavedFilter({
			key: patch.key ?? cur.key,
			name: patch.name ?? cur.name,
			description: patch.description ?? cur.description,
			sql: patch.sql ?? cur.sql
		});
		if ('error' in clean) return clean;
		if (
			state.savedFilters.some(
				(f) => f.id !== id && f.projectId === cur.projectId && f.key === clean.key
			)
		) {
			return { error: `项目 ${cur.projectId} 已有 key=${clean.key} 的收藏` };
		}
		const next: SavedFilter = { ...cur, ...clean, updatedAt: new Date().toISOString() };
		state.savedFilters[idx] = next;
		return next;
	});
}

export function deleteSavedFilter(id: string): { ok: true } | { error: string } {
	if (id.startsWith('builtin-')) return { error: '内置条件不能删除' };
	return withStore((state) => {
		const before = state.savedFilters.length;
		state.savedFilters = state.savedFilters.filter((f) => f.id !== id);
		if (state.savedFilters.length === before) return { error: '收藏不存在' };
		return { ok: true };
	});
}
