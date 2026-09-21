import path from 'node:path';
import { existsSync } from 'node:fs';
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { loadCredentials } from '$lib/auth/credentials.server';
import { getProjectCwd } from '$lib/server/project-cwd';
import { modulesEnabled } from '$lib/modules/store';
import { SESSION_COOKIE, userFromToken } from '$lib/modules/auth';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const mods = modulesEnabled();
	if (mods.auth) {
		if (userFromToken(cookies.get(SESSION_COOKIE))) {
			redirect(302, url.searchParams.get('next') || '/');
		}
		return { productAuth: true };
	}

	const credentials = await loadCredentials();
	const hasLocalConnection = existsSync(path.join(getProjectCwd(), 'connection.yaml'));
	if (credentials?.organizationId || hasLocalConnection) {
		redirect(302, '/');
	}

	return { productAuth: false, authenticated: false };
};
