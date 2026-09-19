/**
 * Alwaseet needs a real region — a generic «اخرى» ("other") is accepted by the
 * form but routes badly at the carrier, so operators get a warning and are asked
 * to pick the right (or nearest) region before the order goes out.
 *
 * Both the storefront checkout and the ops new-order form can produce it: the
 * region list synced from Alwaseet has an «اخرى» entry per city.
 */
import { normalizeSearchText } from './arabic-search';

// Folded forms (normalizeSearchText maps أإآٱ→ا, ة→ه, ىیئ→ي, strips diacritics
// and bidi marks), so «أخرى», «اخرى», «اخری» and «غير محدّدة» all land here.
const VAGUE_REGIONS = new Set(['اخري', 'غير محدد', 'غير محدده']);

/** True when the region is a placeholder rather than an actual area. */
export function isVagueRegion(regionName: string | null | undefined): boolean {
	if (!regionName) return false;
	return VAGUE_REGIONS.has(normalizeSearchText(regionName));
}
