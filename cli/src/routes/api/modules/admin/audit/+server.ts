import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAudit } from '$lib/modules/store';

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.productUser?.role !== 'admin') return json({ error: '没有权限' }, { status: 403 });
	return json({ audit: listAudit(40) });
};
