// SPA mode: disable SSR + prerender so adapter-static produces a single-page app
// served via fallback (index.html) from any /ops/* path.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'always';
