import { json } from '@sveltejs/kit';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { getProjectCwd } from '$lib/server/project-cwd';
import { readStore, withStore } from '$lib/modules/store';

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.productUser?.role !== 'admin') return json({ error: '没有权限' }, { status: 403 });
	const te = readStore().settings.te;
	const ai = readStore().settings.ai;
	return json({
		te: {
			configured: Boolean(te.token || process.env.TE_OPENAPI_TOKEN),
			url: te.url || process.env.TE_OPENAPI_URL || '',
			projectId: te.projectId,
			schema: te.schema
		},
		ai: {
			configured: Boolean(ai.apiKey || process.env.AI_API_KEY),
			provider: ai.provider,
			baseUrl: ai.baseUrl,
			model: ai.model
		}
	});
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	if (locals.productUser?.role !== 'admin') return json({ error: '没有权限' }, { status: 403 });
	const body = await request.json().catch(() => ({}));
	withStore((state) => {
		if (body.te) {
			if (body.te.url !== undefined) state.settings.te.url = String(body.te.url).trim();
			if (body.te.projectId !== undefined) state.settings.te.projectId = String(body.te.projectId).trim();
			if (body.te.schema !== undefined) state.settings.te.schema = String(body.te.schema).trim() || 'ta';
			if (body.te.token) state.settings.te.token = String(body.te.token);
		}
		if (body.ai) {
			if (body.ai.provider !== undefined) state.settings.ai.provider = String(body.ai.provider).trim();
			if (body.ai.baseUrl !== undefined) state.settings.ai.baseUrl = String(body.ai.baseUrl).trim();
			if (body.ai.model !== undefined) state.settings.ai.model = String(body.ai.model).trim();
			if (body.ai.apiKey) state.settings.ai.apiKey = String(body.ai.apiKey);
		}
	});
	const te = readStore().settings.te;
	const url = te.url || process.env.TE_OPENAPI_URL || '';
	const token = te.token || process.env.TE_OPENAPI_TOKEN || '';
	writeFileSync(
		join(getProjectCwd(), 'connection.yaml'),
		`type: thinkingdata\nurl: ${JSON.stringify(url)}\ntoken: ${JSON.stringify(token)}\nproject_id: ${JSON.stringify(te.projectId)}\nschema: ${te.schema || 'ta'}\n`,
		'utf8'
	);
	return json({ ok: true });
};
