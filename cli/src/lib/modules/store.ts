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

export type AppState = {
	users: UserRecord[];
	sessions: SessionRecord[];
	pageLocks: PageLock[];
	settings: { te: TeSettings; ai: AiSettings };
	chats: ChatRecord[];
	sqlKb: SqlKbRecord[];
	auditLog: AuditRecord[];
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
	auditLog: []
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
			auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : []
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
