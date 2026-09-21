import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { productChat } from '$lib/modules/ai-chat';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.productUser;
	if (!user) return json({ error: '未登录' }, { status: 401 });
	const body = await request.json().catch(() => ({}));
	const prompt = String(body.prompt || '').trim();
	const slug = String(body.slug || 'index');
	if (!prompt) return json({ error: '请输入问题' }, { status: 400 });
	try {
		const result = await productChat({ prompt, slug, user });
		return json(result);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'AI 调用失败' },
			{ status: 400 }
		);
	}
};
