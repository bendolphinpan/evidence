import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	addSavedFilter,
	deleteSavedFilter,
	listSavedFilters,
	updateSavedFilter
} from '$lib/modules/store';

function projectIdOf(url: URL, body?: { projectId?: unknown }): string {
	const q = String(url.searchParams.get('projectId') || '').trim();
	if (q) return q;
	const b = String(body?.projectId || '').trim();
	return b || '51';
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.productUser) return json({ error: '未登录' }, { status: 401 });
	return json({ filters: listSavedFilters(projectIdOf(url)) });
};

function canWrite(role: string | undefined): boolean {
	return role === 'admin' || role === 'editor';
}

export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!canWrite(locals.productUser?.role)) return json({ error: '没有权限' }, { status: 403 });
	const body = await request.json().catch(() => ({}));
	const result = addSavedFilter({
		projectId: projectIdOf(url, body),
		key: String(body.key || ''),
		name: String(body.name || ''),
		description: String(body.description || ''),
		sql: String(body.sql || ''),
		createdBy: locals.productUser.username
	});
	if ('error' in result) return json({ error: result.error }, { status: 400 });
	return json({ filter: result });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!canWrite(locals.productUser?.role)) return json({ error: '没有权限' }, { status: 403 });
	const body = await request.json().catch(() => ({}));
	const id = String(body.id || '');
	if (!id) return json({ error: '缺少 id' }, { status: 400 });
	const result = updateSavedFilter(id, {
		key: body.key !== undefined ? String(body.key) : undefined,
		name: body.name !== undefined ? String(body.name) : undefined,
		description: body.description !== undefined ? String(body.description) : undefined,
		sql: body.sql !== undefined ? String(body.sql) : undefined
	});
	if ('error' in result) return json({ error: result.error }, { status: 400 });
	return json({ filter: result });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!canWrite(locals.productUser?.role)) return json({ error: '没有权限' }, { status: 403 });
	const body = await request.json().catch(() => ({}));
	const id = String(body.id || new URL(request.url).searchParams.get('id') || '');
	if (!id) return json({ error: '缺少 id' }, { status: 400 });
	const result = deleteSavedFilter(id);
	if ('error' in result) return json({ error: result.error }, { status: 400 });
	return json({ ok: true });
};
