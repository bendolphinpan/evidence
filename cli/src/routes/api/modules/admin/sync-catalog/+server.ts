import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchAndWriteLiveCatalog } from '$lib/modules/sync-catalog';

export const POST: RequestHandler = async ({ locals }) => {
	if (locals.productUser?.role !== 'admin') return json({ error: '没有权限' }, { status: 403 });
	try {
		const { catalog, paths } = await fetchAndWriteLiveCatalog();
		return json({
			ok: true,
			fetchedAt: catalog.fetchedAt,
			eventCount: catalog.events.length,
			eventPropCount: catalog.eventProps.length,
			userPropCount: catalog.userProps.length,
			hasInitCountry: catalog.userProps.some((p) => p.name === 'init_country'),
			paths
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : '同步失败' },
			{ status: 400 }
		);
	}
};
