import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getProjectCwd } from '$lib/server/project-cwd';

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
	savedFilters: []
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

function readState(): AppState {
	const file = storePath();
	if (!existsSync(file)) return structuredClone(EMPTY);
	try {
		const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppState>;
		return {
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
			savedFilters: Array.isArray(raw.savedFilters) ? raw.savedFilters : []
		};
	} catch {
		return structuredClone(EMPTY);
	}
}

function writeState(state: AppState): void {
	const file = storePath();
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
	renameSync(tmp, file);
}

export function withStore<T>(fn: (state: AppState) => T): T {
	const beforeMtime = (() => {
		try {
			return existsSync(storePath()) ? readFileSync(storePath(), 'utf8').length : -1;
		} catch {
			return -1;
		}
	})();
	const state = readState();
	const result = fn(state);
	const afterLen = (() => {
		try {
			return existsSync(storePath()) ? readFileSync(storePath(), 'utf8').length : -1;
		} catch {
			return -1;
		}
	})();
	if (beforeMtime !== -1 && afterLen !== beforeMtime) {
		// Another writer may have landed; re-read once and re-apply is too hard for arbitrary fn.
		// Best-effort: still write our state (last writer wins) but keep truncation guards.
	}
	writeState(state);
	return result;
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
}): { key: string; name: string; description: string; sql: string } | { error: string } {
	const key = String(input.key || '')
		.trim()
		.toLowerCase()
		.slice(0, 40);
	const name = String(input.name || '').trim().slice(0, 60);
	const description = String(input.description || '').trim().slice(0, 300);
	const sql = String(input.sql || '').trim().slice(0, 2000);
	if (!key) return { error: '收藏需要 key（页内分支用）' };
	if (!/^[a-z][a-z0-9_]*$/.test(key)) return { error: 'key 只允许小写字母/数字/下划线，字母开头' };
	if (key === 'none') return { error: 'key 不能叫 none（保留值）' };
	if (!name) return { error: '收藏需要名字' };
	if (!sql) return { error: '收藏需要 SQL 条件' };
	if (/;\s*\S/.test(sql)) return { error: '只允许单个布尔条件，不要写多语句' };
	if (
		/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|REPLACE|INTO\s+OUTFILE)\b/i.test(
			sql
		)
	) {
		return { error: '只允许布尔条件，不要写写库语句' };
	}
	return { key, name, description, sql };
}

export function listSavedFilters(projectId: string): SavedFilter[] {
	const state = readState();
	const rows = state.savedFilters.filter((f) => f.projectId === projectId);
	if (rows.length === 0 && projectId === '51') {
		const seeded = addSavedFilter({
			projectId: '51',
			key: 'notest',
			name: '排除测试流量',
			description: '去掉事件表 e.is_test。各页事件表别名固定为 e。',
			sql: 'coalesce(e.is_test, false) = false',
			createdBy: 'system'
		});
		if (!('error' in seeded)) return [seeded];
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
	return withStore((state) => {
		const before = state.savedFilters.length;
		state.savedFilters = state.savedFilters.filter((f) => f.id !== id);
		if (state.savedFilters.length === before) return { error: '收藏不存在' };
		return { ok: true };
	});
}
