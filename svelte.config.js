import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		paths: {
			// Built three times, see Dockerfile.static: default '/admin' (the legacy
			// confirm.gstar1959.com mount), BASE_PATH=/ops (genelog.nixflow.xyz/ops),
			// and BASE_PATH='' (ops.asaletalkawaz.iq, where the app owns the root).
			// The empty string is a real value here, so test for undefined — `||`
			// would silently turn the root build back into an /admin one.
			base: process.env.BASE_PATH === undefined ? '/admin' : process.env.BASE_PATH
		},
		// Poll for new deploys so UpdatePrompt can offer a reload without a manual nav
		version: {
			pollInterval: 60000
		},
		alias: {
			$lib: './src/lib'
		}
	}
};

export default config;
