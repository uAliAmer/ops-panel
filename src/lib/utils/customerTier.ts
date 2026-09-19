import type { Order } from '$lib/api';

/**
 * Customer-loyalty tier from the count of *previous completed* orders
 * (Order.previousOrders, computed server-side). Returns null for new customers
 * (0 prior orders) so no badge renders.
 *
 *   1–2 → عائد   (returning, blue)
 *   3–7 → مميز   (valued, amber)
 *   8+  → VIP     (gold)
 */
export function customerTier(
	order: Pick<Order, 'previousOrders'>
): { label: string; class: string; count: number } | null {
	const count = order.previousOrders ?? 0;
	if (count <= 0) return null;
	if (count <= 2) {
		return {
			label: 'عائد',
			count,
			class: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30'
		};
	}
	if (count <= 7) {
		return {
			label: 'مميز',
			count,
			class: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
		};
	}
	return {
		label: 'VIP',
		count,
		class: 'bg-yellow-400/20 text-yellow-700 dark:text-yellow-300 border-yellow-400/40'
	};
}

/** Arabic-grammar "N previous orders" — spells out what the tier count means. */
export function prevOrdersLabel(count: number): string {
	if (count === 1) return 'طلب سابق واحد';
	if (count === 2) return 'طلبان سابقان';
	if (count <= 10) return `${count} طلبات سابقة`;
	return `${count} طلباً سابقاً`;
}
