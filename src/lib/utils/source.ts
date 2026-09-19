import type { Order, SubmissionSource } from '$lib/api';

/**
 * The two channels a wholesaler reaches us through, as Genelog stamps them.
 *
 *   Dropship  — ships to the RESELLER'S customer. We never contact that person;
 *               the reseller owns that relationship. Gold, end to end.
 *   Wholesale — the reseller restocking their own shelf. It ships to THEM, and
 *               they pay our wholesale price at the door or out of their ledger
 *               balance. They are our own customer, so they get the tracking
 *               messages like anyone else. Purple, end to end.
 *
 * Both are the reseller book, and both belong in the same tab.
 */
export const DROPSHIP_STORE = 'Dropship';
export const WHOLESALE_STORE = 'Wholesale';
export const RESELLER_STORES = [DROPSHIP_STORE, WHOLESALE_STORE];

/**
 * A wholesaler's own restock order.
 *
 * Keyed on `storeName`, NOT on `suppressCustomerContact` the way dropship is.
 * That flag means "do not message the recipient", and here the recipient IS the
 * wholesaler — our customer, who should get the confirmation and the tracking.
 * So it is deliberately false on these, and testing it would find nothing.
 */
export function isWholesaleOrder(order: Pick<Order, 'storeName'>): boolean {
	return (order.storeName ?? '').toLowerCase() === WHOLESALE_STORE.toLowerCase();
}

/**
 * Human-friendly origin badge for an order:
 *   - storeName ("G-Star", "ByteFi", …) when an external storefront submitted it
 *   - "FORM" for the public order form on /
 *   - "ADMIN" / "API" / "TG" for the other backend sources
 */
export function orderSource(order: Pick<Order, 'storeName' | 'source'>): {
	label: string;
	class: string;
} {
	if (order.storeName) {
		const store = order.storeName.toLowerCase();
		// Dropship: the reseller portal, not one of our own storefronts. The name
		// beside this badge is the RESELLER's — the badge says what kind of
		// relationship that name is.
		if (store === 'dropship') {
			return {
				label: 'دروبشيب',
				class: 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/50'
			};
		}
		// The same wholesaler, buying for their own shelf. Purple against
		// dropship's gold: an operator reads the two channels apart before they
		// read the label, and what differs between them is who pays the driver.
		if (store === 'wholesale') {
			return {
				label: 'جملة',
				class: 'bg-violet-500/20 text-violet-800 dark:text-violet-300 border-violet-500/50'
			};
		}
		if (store === 'g-star' || store === 'gstar' || store === 'gstar1959') {
			return {
				label: order.storeName,
				class: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
			};
		}
		if (store === 'bytefi') {
			return {
				label: order.storeName,
				class: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30'
			};
		}
		return {
			label: order.storeName,
			class: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30'
		};
	}
	const s: SubmissionSource = order.source ?? 'WEB_FORM';
	switch (s) {
		case 'WEB_FORM':
			return { label: 'نموذج', class: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30' };
		case 'ADMIN_PANEL':
			return { label: 'يدوي', class: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30' };
		case 'API':
			return { label: 'API', class: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' };
		case 'TELEGRAM':
			return {
				label: 'تيليغرام',
				class: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30'
			};
		default:
			return { label: s, class: 'bg-muted text-muted-foreground border-border' };
	}
}
