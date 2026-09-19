/**
 * Which branch a parcel went out from, as a name an operator reads.
 *
 * There is no branch column on an order — the backend reads it from the
 * strongest signal a row carries, and the same order of preference is used here
 * (see the BRANCHES note in routes/adminShipments/list.js):
 *
 *   1. shipment.branchKey — written at fulfillment, and rewritten when a local
 *      driver changes, so it follows the parcel. Authoritative when present.
 *   2. shipment.alwaseetAccount — set on every sticker order, and it IS the
 *      branch account. Covers rows that predate branchKey.
 *
 * A parcel with neither has not been sent by anybody yet, and is deliberately
 * nameless rather than guessed into a branch.
 *
 * The labels mirror ALWASEET_APP_LABEL / ALWASEET_APP_LABEL_<KEY> in the
 * backend's env, which is where the authoritative ones live — the pickup board
 * gets them from the server. An account configured later falls through to its
 * own key rather than disappearing.
 */
import type { Order } from '$lib/api';

const LABELS: Record<string, string> = {
	main: 'بابلون مول',
	asalet: 'عكد النصارى'
};

export function branchKeyOf(order: Pick<Order, 'shipment'>): string | null {
	const s = order.shipment;
	return s?.branchKey?.trim() || s?.alwaseetAccount?.trim() || null;
}

export function carrierBranchLabel(key: string | null | undefined): string {
	if (!key) return '';
	return LABELS[key] ?? key;
}

/** The branch name for an order, or '' when nothing on it says. */
export const orderBranchLabel = (order: Pick<Order, 'shipment'>) =>
	carrierBranchLabel(branchKeyOf(order));
