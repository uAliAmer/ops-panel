/**
 * Placeholder images for demo mode.
 *
 * Deliberately its own module, importing nothing: `utils/image.ts` needs
 * `demoImage` on the synchronous path, and importing it from `./index` would
 * pull the fixture set into the main bundle — defeating the dynamic import that
 * keeps demo data out of a production build.
 */

/** A deterministic placeholder image, so the fixtures need no binary assets. */
export function demoImage(filename: string): string {
	let hash = 0;
	for (const ch of filename) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	const hue = hash % 360;
	const label = filename.replace(/\.[a-z]+$/i, '').slice(0, 2).toUpperCase();
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<rect width="200" height="200" fill="hsl(${hue} 55% 88%)"/>
<circle cx="100" cy="82" r="42" fill="hsl(${hue} 50% 72%)"/>
<rect x="46" y="140" width="108" height="26" rx="13" fill="hsl(${hue} 50% 72%)"/>
<text x="100" y="95" font-family="system-ui,sans-serif" font-size="34" font-weight="700"
 fill="hsl(${hue} 60% 35%)" text-anchor="middle">${label}</text></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
