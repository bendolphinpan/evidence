import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPageMarkdown } from '$lib/modules/pages';
import { appendAudit } from '$lib/modules/store';
import { starterMarkdown } from '$lib/modules/new-page';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.productUser;
	if (!user) return json({ error: '未登录' }, { status: 401 });
	if (user.role === 'viewer') return json({ error: '没有权限' }, { status: 403 });
	const body = await request.json().catch(() => ({}));
	const slug = String(body.slug || '')
		.trim()
		.toLowerCase();
	const title = String(body.title || slug).trim();
	const projectId = String(body.projectId || '51');
	const schema = String(body.schema || 'ta');
	if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
		return json({ error: '路径只允许小写字母、数字和连字符，并且以字母开头' }, { status: 400 });
	}
	const markdown =
		typeof body.markdown === 'string' && body.markdown.trim()
			? body.markdown
			: starterMarkdown({ slug, title, projectId, schema });
	const created = createPageMarkdown(slug, markdown);
	if ('error' in created) return json({ error: created.error }, { status: 409 });
	appendAudit({
		userId: user.id,
		username: user.username,
		action: 'create_page',
		slug,
		detail: `projectId=${projectId}`
	});
	return json({ ok: true, href: slug === 'index' ? '/' : `/${slug}` });
};
