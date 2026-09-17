import adapter from './adapter/index.js';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			binaryName: 'evidence',
			out: 'dist'
		}),
		alias: {
			// SvelteKit appends `/*` to each alias automatically. Do not put a
			// star in the replacement path — that becomes `*/*` in tsconfig and
			// Vite warns (and can break client module resolution → blank page).
			'@evidence/core': path.resolve('../core/src'),
			$cli: path.resolve('./cli')
		}
	}
};

export default config;
