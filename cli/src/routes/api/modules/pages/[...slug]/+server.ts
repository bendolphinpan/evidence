import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { acquireLock, readPageMarkdown, releaseLock, writePageMarkdown } from '$lib/modules/pages';
import { parsePage, serializePage, type PageNode } from '$lib/modules/page-model';

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = locals.productUser;
	if (!user) return json({ error: '未登录' }, { status: 401 });
	const slug = params.slug;
	const markdown = readPageMarkdown(slug);
	if (markdown === null) return json({ error: '页面不存在' }, { status: 404 });
	const nodes = parsePage(markdown);
	const lock = acquireLock(slug, user);
	if ('error' in lock) return json({ error: lock.error, markdown, nodes }, { status: 409 });
	return json({ markdown, nodes, lock });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const user = locals.productUser;
	if (!user) return json({ error: '未登录' }, { status: 401 });
	if (user.role === 'viewer') return json({ error: '没有权限' }, { status: 403 });
	const slug = params.slug;
	const lock = acquireLock(slug, user);
	if ('error' in lock) return json({ error: lock.error }, { status: 409 });
	const body = await request.json().catch(() => ({}));
	const markdown =
		typeof body.markdown === 'string'
			? body.markdown
			: Array.isArray(body.nodes)
				? serializePage(body.nodes as PageNode[])
				: '';
	const result = writePageMarkdown(slug, markdown);
	if ('error' in result) return json({ error: result.error }, { status: 400 });
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = locals.productUser;
	if (!user) return json({ error: '未登录' }, { status: 401 });
	releaseLock(params.slug, user.id);
	return json({ ok: true });
};
