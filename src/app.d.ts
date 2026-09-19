// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Build-time deployment config; see $lib/config and .env.example.
	interface ImportMetaEnv {
		readonly VITE_PUBLIC_ORDER_ORIGIN?: string;
		readonly VITE_OPS_APP_BASE?: string;
		readonly VITE_PORTAL_URL?: string;
		readonly VITE_IMAGE_CDN?: string;
		readonly VITE_CANONICAL_HOST?: string;
		readonly VITE_DEMO?: string;
	}

	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}

	interface Window {
		// Captured beforeinstallprompt event (set by the inline script in app.html)
		__deferredInstallPrompt?: Event & {
			prompt: () => Promise<void>;
			userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
		};
	}
}

export {};
