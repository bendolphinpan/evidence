import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readStore, withStore, type Role, type UserRecord } from './store';

export const SESSION_COOKIE = 'sd_session';
const SESSION_DAYS = 7;

export type PublicUser = { id: string; username: string; role: Role };

function newId(prefix: string): string {
	return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const next = scryptSync(password, salt, 64);
	const prev = Buffer.from(hash, 'hex');
	if (next.length !== prev.length) return false;
	return timingSafeEqual(next, prev);
}

function publicUser(user: UserRecord): PublicUser {
	return { id: user.id, username: user.username, role: user.role };
}

export function bootstrapAdmin(): void {
	const username = (process.env.INIT_ADMIN_USER || '').trim();
	const password = process.env.INIT_ADMIN_PASSWORD || '';
	if (!username || !password) return;
	withStore((state) => {
		if (state.users.length) return;
		state.users.push({
			id: newId('usr'),
			username,
			passwordHash: hashPassword(password),
			role: 'admin',
			disabled: false,
			createdAt: new Date().toISOString()
		});
	});
}

export function createSession(
	username: string,
	password: string
): { token: string; user: PublicUser } | { error: string } {
	bootstrapAdmin();
	const state = readStore();
	const user = state.users.find((u) => u.username === username);
	if (!user || user.disabled || !verifyPassword(password, user.passwordHash)) {
		return { error: '用户名或密码错误' };
	}
	const token = newId('ses');
	const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
	withStore((next) => {
		next.sessions = next.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
		next.sessions.push({ id: token, userId: user.id, expiresAt: expires.toISOString() });
	});
	return { token, user: publicUser(user) };
}

export function destroySession(token: string | undefined): void {
	if (!token) return;
	withStore((state) => {
		state.sessions = state.sessions.filter((s) => s.id !== token);
	});
}

export function userFromToken(token: string | undefined): PublicUser | null {
	if (!token) return null;
	bootstrapAdmin();
	const state = readStore();
	const session = state.sessions.find((s) => s.id === token);
	if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
	const user = state.users.find((u) => u.id === session.userId);
	if (!user || user.disabled) return null;
	return publicUser(user);
}

export function listUsers(): PublicUser[] {
	bootstrapAdmin();
	return readStore().users.map(publicUser);
}

export function createUser(input: {
	username: string;
	password: string;
	role: Role;
}): PublicUser | { error: string } {
	const username = input.username.trim();
	if (username.length < 2) return { error: '用户名至少 2 个字符' };
	if (!input.password || input.password.length < 6) return { error: '密码至少 6 位' };
	if (!['admin', 'editor', 'viewer'].includes(input.role)) return { error: '无效角色' };
	return withStore((state) => {
		if (state.users.some((u) => u.username === username)) return { error: '用户名已存在' };
		const user: UserRecord = {
			id: newId('usr'),
			username,
			passwordHash: hashPassword(input.password),
			role: input.role,
			disabled: false,
			createdAt: new Date().toISOString()
		};
		state.users.push(user);
		return publicUser(user);
	});
}

export function cookieHeader(token: string): string {
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
