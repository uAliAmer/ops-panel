import type { Order } from '$lib/api';

const ORD_RE = /^ORD-(\d{4}-\d+)$/i;

/**
 * Build the URL slug for an order.
 * Prefers the friendly ORD-format key (storefront-generated) — drops the "ORD-"
 * prefix so URLs look like `/ops/order/2026-000353`. Falls back to the
 * first 8 hex chars of submissionId for older orders without an ORD key.
 */
export function orderSlug(order: Pick<Order, 'idempotencyKey' | 'submissionId' | 'id'>): string {
	const key = order.idempotencyKey ?? '';
	const match = key.match(ORD_RE);
	if (match) return match[1];
	return (order.submissionId ?? order.id).slice(0, 8);
}

/**
 * Human-friendly display label for an order (used in headers).
 * Drops the "ORD-" prefix so the UI reads cleanly as "2026-000353".
 * Falls back to "#15a23cea" for older orders without an ORD-format key.
 */
export function orderLabel(order: Pick<Order, 'idempotencyKey' | 'submissionId' | 'id'>): string {
	const key = order.idempotencyKey ?? '';
	const match = key.match(ORD_RE);
	if (match) return match[1];
	return '#' + (order.submissionId ?? order.id).slice(0, 8);
}
