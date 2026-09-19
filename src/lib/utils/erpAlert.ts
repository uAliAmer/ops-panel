/**
 * ERP invoice states that need a human to go and do something.
 *
 * Both mean the invoice EXISTS in the ERP and is wrong in a way no retry can
 * fix from here — so they are surfaced loudly (blinking on the card, an arrow in
 * the order) rather than left for whoever happens to scroll far enough down.
 *
 * FAILED is deliberately not in this set: it already has its own card badge and
 * a retry button, because no invoice was created.
 */
const NEEDS_ATTENTION: Record<string, string> = {
	// Items imported but the ERP refused to post it — usually no stock in the
	// selected warehouse. Nothing is booked, for packing or for money.
	UNSETTLED: 'فاتورة غير مرحّلة',
	// The invoice was created empty: the line items never imported.
	PARTIAL: 'فاتورة بلا أصناف'
};

export function erpNeedsAttention(status: string | null | undefined): boolean {
	return !!status && status in NEEDS_ATTENTION;
}

export function erpAlertLabel(status: string | null | undefined): string {
	return (status && NEEDS_ATTENTION[status]) || '';
}

// Dismissal is a LOCAL acknowledgement ("I've seen it"), not a fix — the ERP is
// still wrong, and the order screen still shows the strip. Keyed by status as
// well as id so that an order which later develops a *different* problem alerts
// again instead of inheriting the old dismissal.
const KEY = 'erpAlertsDismissed';

function readAll(): Record<string, string> {
	if (typeof localStorage === 'undefined') return {};
	try {
		return JSON.parse(localStorage.getItem(KEY) || '{}');
	} catch {
		return {}; // corrupt entry — treat as nothing dismissed
	}
}

export function isErpAlertDismissed(id: string, status: string | null | undefined): boolean {
	if (!id || !status) return false;
	return readAll()[id] === status;
}

export function dismissErpAlert(id: string, status: string | null | undefined): void {
	if (!id || !status || typeof localStorage === 'undefined') return;
	const all = readAll();
	all[id] = status;
	// Keep the store from growing without bound on a long-lived install.
	const entries = Object.entries(all);
	const trimmed = entries.length > 300 ? Object.fromEntries(entries.slice(-300)) : all;
	try {
		localStorage.setItem(KEY, JSON.stringify(trimmed));
	} catch {
		/* storage full or blocked — the alert simply reappears next time */
	}
}
