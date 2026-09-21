import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChat, readStore } from '$lib/modules/store';
import { readPageMarkdown } from '$lib/modules/pages';
import { resolveActiveProject } from '$lib/modules/ai-chat';

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = locals.productUser;
	if (!user) return json({ error: '未登录' }, { status: 401 });
	const slug = String(url.searchParams.get('slug') || 'index');
	const pageMd = readPageMarkdown(slug) || '';
	const projectId =
		String(url.searchParams.get('projectId') || '').trim() ||
		resolveActiveProject(pageMd) ||
		readStore().settings.te.projectId ||
		'51';
	return json({
		slug,
		projectId,
		messages: getChat(user.id, projectId, slug)
	});
};
