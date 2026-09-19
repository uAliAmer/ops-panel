import { DEMO, IMAGE_CDN as CDN } from '../config';
import { demoImage } from '../demo/image';

/**
 * Resolve a stored imageUrl to its public CDN URL.
 * Stored paths look like /api/static/images/{uuid}.webp (or mangled variants).
 * The CDN serves them directly at {IMAGE_CDN}/{uuid}.webp
 */
export function resolveImage(url: string | null | undefined): string | null {
	if (!url) return null;
	// No CDN in demo mode — draw the placeholder the fixture stands for.
	if (DEMO) return demoImage(url.split('/').filter(Boolean).pop() ?? 'item');
	if (url.startsWith('http')) {
		// Already absolute — extract just the filename in case it points to the wrong host
		const filename = url.split('/').pop();
		return filename ? `${CDN}/${filename}` : url;
	}
	// Relative path — grab the last segment (the UUID filename)
	const filename = url.split('/').filter(Boolean).pop();
	return filename ? `${CDN}/${filename}` : null;
}
