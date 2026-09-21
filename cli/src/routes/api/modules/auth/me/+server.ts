import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.productUser) return json({ error: '未登录' }, { status: 401 });
	return json({ user: locals.productUser });
};
