/**
 * Helpers shared between the production server (server.ts) and the
 * dev-mode server (server.dev.ts).
 */


const STUDIO_HOST = process.env.PUBLIC_STUDIO_HOST || 'https://evidence.studio';

export async function checkStudioServer(): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 3000);

		const response = await fetch(`${STUDIO_HOST}/health`, {
			method: 'GET',
			signal: controller.signal
		});

		clearTimeout(timeoutId);
		return response.ok;
	} catch {
		return false;
	}
}

export async function ensureStudioServerOrExit(): Promise<void> {
	const studioRunning = await checkStudioServer();

	if (!studioRunning) {
		console.error(`  ✗ Evidence Studio server is not running at ${STUDIO_HOST}`);
		console.error('');
		console.error('    To start the Studio dev server:');
		console.error('      cd studio && pnpm run dev');
		console.error('');
		console.error('    Or set PUBLIC_STUDIO_HOST if running elsewhere:');
		console.error('      PUBLIC_STUDIO_HOST=https://your-studio.com evidence dev');
		console.error('');
		process.exit(1);
	}
}

export function openBrowser(url: string): void {
	const { spawn } = require('child_process') as typeof import('node:child_process');
	const platform = process.platform;

	// Windows `start "quoted"` treats the first quoted arg as the window title,
	// so `start "http://localhost:3000"` opens a blank window. Match auth.ts:
	// `cmd /c start "" <url>`.
	const [cmd, args]: [string, string[]] =
		platform === 'darwin'
			? ['open', [url]]
			: platform === 'win32'
				? ['cmd', ['/c', 'start', '', url]]
				: ['xdg-open', [url]];

	try {
		const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
		child.on('error', () => {});
		child.unref();
	} catch {
		// best-effort; the user can open the URL manually
	}
}
