import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser, listUsers } from '$lib/modules/auth';
import type { Role } from '$lib/modules/store';

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.productUser?.role !== 'admin') return json({ error: '没有权限' }, { status: 403 });
	return json({ users: listUsers() });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (locals.productUser?.role !== 'admin') return json({ error: '没有权限' }, { status: 403 });
	const body = await request.json().catch(() => ({}));
	const result = createUser({
		username: String(body.username || ''),
		password: String(body.password || ''),
		role: body.role as Role
	});
	if ('error' in result) return json({ error: result.error }, { status: 400 });
	return json({ user: result });
};
