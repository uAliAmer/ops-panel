/**
 * Placeholder product images for demo mode.
 *
 * Deliberately its own module, importing nothing: `utils/image.ts` needs
 * `demoImage` on the synchronous path, and importing it from `./index` would
 * pull the fixture set into the main bundle — defeating the dynamic import that
 * keeps demo data out of a production build.
 *
 * The pictures come from DiceBear, which the panel already uses for operator
 * avatars, so the demo adds no new third party. The seed is the fixture's own
 * filename, which makes each product's picture stable across reloads — an item
 * whose photo changed every refresh would read as a different product.
 */

const DICEBEAR = 'https://api.dicebear.com/10.x/stack/svg';

export function demoImage(filename: string): string {
	const seed = filename.replace(/\.[a-z0-9]+$/i, '') || 'item';
	return `${DICEBEAR}?seed=${encodeURIComponent(seed)}`;
}
