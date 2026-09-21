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

export type AppState = {
	users: UserRecord[];
	sessions: SessionRecord[];
	pageLocks: PageLock[];
	settings: { te: TeSettings; ai: AiSettings };
};

const EMPTY: AppState = {
	users: [],
	sessions: [],
	pageLocks: [],
	settings: {
		te: { url: '', token: '', projectId: '51', schema: 'ta' },
		ai: { provider: 'azure', baseUrl: '', apiKey: '', model: '', apiVersion: '2024-10-21' }
	}
};

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
			}
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
	const state = readState();
	const result = fn(state);
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
