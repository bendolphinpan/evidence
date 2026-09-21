// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			productUser?: { id: string; username: string; role: 'admin' | 'editor' | 'viewer' };
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
