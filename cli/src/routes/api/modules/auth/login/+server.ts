import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, createSession } from '$lib/modules/auth';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => ({}));
	const username = String(body.username || '').trim();
	const password = String(body.password || '');
	if (!username || !password) return json({ error: '请填写用户名和密码' }, { status: 400 });
	const result = createSession(username, password);
	if ('error' in result) return json({ error: result.error }, { status: 401 });
	cookies.set(SESSION_COOKIE, result.token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 7 * 86400,
		secure: false
	});
	return json({ user: result.user });
};
