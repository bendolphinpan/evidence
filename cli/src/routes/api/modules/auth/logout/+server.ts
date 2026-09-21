import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { destroySession, SESSION_COOKIE } from '$lib/modules/auth';

export const POST: RequestHandler = async ({ cookies }) => {
	destroySession(cookies.get(SESSION_COOKIE));
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
