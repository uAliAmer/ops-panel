/**
 * Ops API client — typed wrapper around the backend.
 * Same wire format as the legacy frontend/ops/js/api.js.
 */
import { redirectToPortal, isLoggingOut, wantsLocalLogin } from './ssoRedirect';
import { DEMO } from './config';

// Demo mode answers from fixtures instead of the network. Loaded lazily and
// cached, so a production build never pulls the fixture set into a chunk that
// ships. The first call awaits the import; every later one is synchronous.
let demoModule: typeof import('./demo') | null = null;
async function demoFetch(endpoint: string, opts: RequestInit): Promise<Response> {
	demoModule ??= await import('./demo');
	return demoModule.demoRespond(endpoint, opts);
}

// Path-aware prefix so one codebase works both at confirm.gstar1959.com/admin
// (prefix '') and genelog.nixflow.xyz/ops (prefix '/ops'). The edge nginx routes
// /ops/api and /ops/socket.io to the shipping backend, avoiding Genelog's /api.
export function pathPrefix(): string {
	if (typeof window === 'undefined') return '';
	return window.location.pathname.startsWith('/ops') ? '/ops' : '';
}

// Canonical origin for customer-facing links (tracking), and the base for links
// that open the ops app itself (one operator shares an order with another).
// Both are fixed rather than derived from window.location: the panel also runs
// mounted under another domain's /ops, and a tracking link built there goes to a
// customer, not into the operator's own tab. See $lib/config.
export { PUBLIC_ORDER_ORIGIN, OPS_APP_BASE } from './config';

const API_BASE = pathPrefix() + '/api';
const TOKEN_KEY = 'authToken';
const REFRESH_KEY = 'refreshToken';
const USER_KEY = 'user';

export type User = {
	id: string;
	email: string;
	name: string;
	role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
	erpAccount?: string | null;
	/** Branch has no label printer → the pack flow offers preprinted-sticker binding. */
	printerless?: boolean;
	/** Alwaseet carrier account this operator sends under ('main', 'asalet', …). */
	alwaseetAccount?: string | null;
	/** May open the settlement screen — a backend FINANCE_EMAILS allowlist, not a role. */
	finance?: boolean;
};

/** One batch Alwaseet pays the merchant for. `received` = the carrier's own receipt flag. */
export type SettlementInvoice = {
	id: string;
	merchantPrice: number;
	deliveredCount: number;
	replacementCount: number;
	status: string;
	received: boolean;
	updatedAt: string | null;
	/** From the app API's own record of the batch — null when it doesn't know it. */
	feesTotal: number | null;
	deliveredPrice: number | null;
	replacementPrice: number | null;
	windowFrom: string | null;
	windowTo: string | null;
	/** The money went to the Alwaseet wallet rather than being handed over in cash. */
	toWallet: boolean | null;
	payoutStatus: string | null;
};

/**
 * What the operator has to do about one line of a settlement batch.
 *  MATCH          — ERP total == carrier net (customer paid delivery on top), still unpaid
 *  MATCH_ABSORBED — ERP total == what the customer paid, and the carrier's fee came
 *                   out of our margin. Also a match; the cash is `net`, not `erp.total`
 *  DELIVERY_GAP   — the customer was charged a smaller delivery fee than the carrier
 *                   deducted (fees are 5,000 / 7,500 / 10,000 by parcel size); the gap
 *                   is what we absorbed. Payable like a MATCH
 *  PAID           — the ERP already shows it settled (due 0)
 *  MISMATCH       — neither equation holds; `diff` is ERP total − carrier net
 *  RETURNED       — a return: the carrier only deducts its fee, nothing to pay in the ERP
 *  NO_ERP / ERP_LEGACY / ERP_MISSING / ERP_ERROR / ERP_CANCELLED / UNKNOWN_ORDER — can't be verified here
 */
export type SettlementVerdict =
	| 'MATCH'
	| 'MATCH_ABSORBED'
	| 'DELIVERY_GAP'
	| 'PAID'
	| 'MISMATCH'
	| 'RETURNED'
	| 'NO_ERP'
	| 'ERP_LEGACY'
	| 'ERP_MISSING'
	| 'ERP_ERROR'
	| 'ERP_CANCELLED'
	| 'UNKNOWN_ORDER';

export type SettlementLine = {
	orderId: string;
	clientName: string;
	clientMobile: string;
	cityName: string;
	regionName: string;
	status: string;
	statusId: string | null;
	replacement: boolean;
	price: number;
	deliveryPrice: number;
	/** price − deliveryPrice: what the carrier actually pays us for this parcel. */
	net: number;
	createdAt: string | null;
	updatedAt: string | null;
	merchantNotes: string;
	issueNotes: string;
	order: {
		id: string | null;
		submissionId: string | null;
		idempotencyKey: string | null;
		customerName: string | null;
		storeName: string | null;
		status: string | null;
		price: number;
		erpInvoiceId: string | null;
		erpInvoiceUrl: string | null;
		erpInvoiceStatus: string | null;
		carrierMethod: string | null;
	} | null;
	erp: {
		id: string;
		serial: string | null;
		total: number;
		totalPaid: number;
		due: number;
		status: string;
		isCanceled: boolean;
		isPosted: boolean;
		url: string | null;
		publicPrintUrl: string | null;
		trackingNumber: string | null;
	} | null;
	erpError: string | null;
	verdict: SettlementVerdict;
	diff: number | null;
};

export type SettlementDetail = {
	invoice: SettlementInvoice;
	/**
	 * The batch that closed just before this one. Consecutive batches are often
	 * moved into the wallet together, so their sum — not this batch alone — is
	 * what the carrier's app shows as received.
	 */
	previousBatch: {
		id: string;
		merchantPrice: number;
		toWallet: boolean;
		windowTo: string | null;
	} | null;
	totals: {
		orders: number;
		sumPrice: number;
		sumDelivery: number;
		net: number;
		matched: number;
		paid: number;
		/** Lines where the carrier's fee came out of our margin, whole or in part. */
		absorbed: number;
		/** How much of the carrier's fee we absorbed across the batch. */
		absorbedAmount: number;
		toRecord: number;
		/** Sum of the ERP invoices still to be marked paid. */
		toRecordAmount: number;
		/** The cash those same lines actually bring in (net of carrier fees). */
		toRecordCash: number;
		returned: number;
		attention: number;
	};
	lines: SettlementLine[];
	erpConfigured: boolean;
};

export type ApiResponse<T> = {
	success: boolean;
	data?: T;
	error?: string;
	/** PATCH /admin/shipments/:id only — true when a price edit reached the assigned local driver. */
	driverNotified?: boolean;
};

export type ReminderStatus = 'PENDING' | 'DONE' | 'DISMISSED';

export type Reminder = {
	id: string;
	message: string;
	dueAt: string;
	status: ReminderStatus;
	createdById: string;
	assignedToId: string | null;
	submissionId: string | null;
	notifiedAt: string | null;
	telegramSentAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
	createdBy: { id: string; name: string } | null;
	assignedTo: { id: string; name: string } | null;
	submission: { id: string; submissionId: string; customerName: string | null; status: string } | null;
};

export type OrderItem = {
	sku?: string;
	name?: string;
	nameAr?: string;
	quantity: number;
	unitPrice: number;
	imageUrl?: string;
	isComponent?: boolean;
};

/** What Alwaseet itself last said about the parcel. See carrierStatusService. */
export type CarrierClass = 'DELIVERED' | 'ATTENTION' | 'RETURNING' | 'IN_FLIGHT';

/**
 * One observed carrier state change. Append-only, in order.
 *
 * Distinct from `trackingHistory`, which is a name → time map and therefore
 * cannot hold the same status twice — the exact shape a return has when a
 * redelivery is attempted and fails again.
 */
export type CarrierStatusEvent = {
	id: string;
	statusId?: string | null;
	statusName?: string | null;
	carrierClass?: CarrierClass | null;
	issueNotes?: string | null;
	statusAt?: string | null;   // carrier's own clock
	observedAt: string;         // ours — the only monotonic ordering
};

export type Shipment = {
	/** Our own shipment row id — what the settle/unsettle endpoints address. */
	id?: string;
	/** Alwaseet's own order id — needed to delete/cancel the order at the carrier. */
	alwaseetOrderId?: string | null;
	trackingNumber?: string;
	trackingToken?: string;    // Internal UUID; first 13 chars used in /track/ URL
	qrLink?: string;           // Alwaseet print URL (authenticated)
	erpInvoiceUrl?: string;
	status?: string;
	trackingStatusOverride?: string | null;
	/** 'OFFICIAL' (printed label) | 'APP_STICKER' (bound preprinted sticker) | 'LOCAL' (own driver). */
	carrierMethod?: string;
	/** Which branch sent it. Written at fulfillment and rewritten when a local
	 *  driver changes, so it follows the parcel — the backend's own first choice
	 *  when it groups by branch (see adminShipments/list.js). */
	branchKey?: string | null;
	/** The Alwaseet app account used, which IS a branch. Set on every sticker
	 *  order, and the fallback for rows that predate branchKey. */
	alwaseetAccount?: string | null;
	stickerLabelId?: string | null;
	/** LOCAL delivery — the own driver carrying this order. */
	localDriverId?: string | null;
	localDriverName?: string | null;
	localDriverPhone?: string | null;
	localDeliveryFee?: number | null;
	/** Set once the driver has handed this order's COD back. */
	settledAt?: string | null;
	// Cached carrier reading. `status` above is ours and goes no finer than
	// SENT_TO_CARRIER; these are the carrier's own words, and the only place a
	// failed delivery attempt appears.
	carrierClass?: CarrierClass | null;
	alwaseetStatusId?: string | null;
	alwaseetStatusName?: string | null;
	alwaseetStatusAt?: string | null;
	alwaseetIssueNotes?: string | null;
	/** Set when the driver picked up the parcel (status 2) — from then on the
	 *  carrier has it and a carrier delete no longer works. */
	pickedUpAt?: string | null;
	/** LOCAL return/replacement: when the op confirmed the returned item is back. */
	returnReceivedAt?: string | null;
	/** Set once the order is retired at the carrier (deleted/archived) — hides the
	 *  carrier-delete action so it can't be re-run on a gone order. */
	carrierArchivedAt?: string | null;
	/** Present on the detail read only — the list does not carry it. */
	carrierEvents?: CarrierStatusEvent[];
};

export type LocalDriver = {
	id: string;
	name: string;
	phone?: string | null;
	active: boolean;
	notes?: string | null;
	/** COD the driver is currently responsible for (unsettled). */
	outstanding?: number;
	/** The delivered slice of `outstanding` — the only part a settle can clear. */
	settleable?: number;
	settleableCount?: number;
	/** outstanding − settleable: cash still out on undelivered orders. */
	pending?: number;
};

export type PickupDriver = { id: string | null; name: string; phone: string | null; count: number };

/** One line of the chip's hover preview — enough to recognise a parcel. */
export type PickupOrder = {
	/** URL slug for /order/<slug> — the ORD key when there is one. */
	slug: string;
	/** What to show: '2026-000353' or '#8a57d027'. */
	label: string;
	submissionId: string;
	name: string;
	city: string;
	price: number;
	kind: 'awaiting' | 'toPack' | 'local';
	/** LOCAL lines only. */
	driver?: string | null;
	/** Alwaseet parcels only. */
	tracking?: string | null;
};

export type PickupBranch = {
	/** Alwaseet app-account key: 'main', 'asalet', … or 'unassigned'. */
	key: string;
	label: string;
	alwaseet: {
		/** Greenlit, no label yet (APPROVED/PACKED). */
		toPack: number;
		/** Labelled at Alwaseet, their driver has not taken it yet. */
		awaitingPickup: number;
	};
	local: { total: number; drivers: PickupDriver[] };
	/** Capped list for the preview; ordersTotal is the true count. */
	orders: PickupOrder[];
	ordersTotal: number;
};

/** What is still on our shelf when a driver walks in — see /pickup-counts.
 *  Split per branch (the viewer's own comes first); the flat figures are the
 *  same numbers summed, for the header chip. */
export type PickupCounts = {
	myBranch: string;
	branches: PickupBranch[];
	alwaseet: { toPack: number; awaitingPickup: number };
	local: { total: number; drivers: PickupDriver[] };
};

export type DriverLedgerOrder = {
	shipmentId: string;
	submissionId: string | null;
	customerName: string | null;
	cityName: string | null;
	address: string | null;
	price: number;
	fee: number;
	net: number;
	statusName: string | null;
	delivered: boolean;
	/** ERP invoice link for this order, if one was created. Used to do قبض in ERP. */
	erpInvoiceUrl: string | null;
	erpInvoiceStatus: string | null;
	/** When the driver took the order (falls back to assignment time). */
	receivedAt: string;
	createdAt: string;
	/** Present on already-settled orders. */
	settledAt?: string | null;
};

export type DriverLedger = {
	driver: { id: string; name: string; phone?: string | null };
	orders: DriverLedgerOrder[];
	outstanding: number;
	settleable: number;
	settleableCount: number;
	/** Last 20 settled orders (most recent first). */
	settled: DriverLedgerOrder[];
};

export type SubmissionSource = 'WEB_FORM' | 'ADMIN_PANEL' | 'API' | 'TELEGRAM';

export type HistoryAction =
	| 'CREATED' | 'SAVED' | 'APPROVED' | 'REJECTED' | 'SENT'
	| 'CALLBACK_RECEIVED' | 'FAILED' | 'RETRIED' | 'PACKED';

export type OrderHistory = {
	id: string;
	action: HistoryAction;
	note?: string | null;
	changes?: Record<string, unknown> | null;
	createdAt: string;
	changedBy?: { id: string; name: string } | null;
};

export type OrderActor = { id: string; name: string; email: string } | null;

export type Order = {
	id: string;
	submissionId: string;
	idempotencyKey?: string | null;
	source?: SubmissionSource;
	customerName: string;
	customerPhone: string;
	customerPhone2?: string;
	customerPhoneHasWa?: boolean | null; // per-number WhatsApp, checked at ingest
	customerPhone2HasWa?: boolean | null;
	cityId: number;
	cityName: string;
	regionId?: number;
	regionName?: string;
	fullAddress: string;
	notes?: string;
	operatorNote?: string | null;
	// Preprinted sticker bound at order creation (printerless express path); packing
	// pre-fills its scanner from this.
	preStickerId?: string | null;
	price: string | number;
	itemsNumber: number;
	status: string;
	storeName?: string;
	discountCode?: string;
	discountAmount?: string | number;
	/** Genelog waived delivery on this order (offer or loyalty tier). */
	freeDelivery?: boolean;
	returnOrder?: boolean;
	replacement?: number;
	packedAt?: string | null;
	// QUEUED | PROCESSING | SETTLED | SUCCESS | UNSETTLED | PARTIAL | FAILED
	//   SETTLED   = created, items imported, print page opened → posted in the ERP
	//   SUCCESS   = created, but nothing was auto-settled (no line items, or the
	//               invoice predates auto-settling)
	//   UNSETTLED = created with items, but the settle step failed
	//   PARTIAL   = created, line items failed to import — the invoice is empty
	erpInvoiceStatus?: string | null;
	erpInvoiceUrl?: string | null;
	/** True when a reseller's order was invoiced to the shipping branch instead
	 *  of the reseller. The invoice is real, it is just raised against the wrong
	 *  debtor. Read it together with erpCustomerRef: no ref means nobody linked
	 *  the reseller in Genelog, while a ref that is present says the link exists
	 *  here but the ERP account no longer carries that mark. */
	erpBilledToBranch?: boolean;
	/** The reseller's ERP account as the external_ref Genelog stamped on it
	 *  (`reseller-<id>`). Null on retail orders and on unlinked resellers. */
	erpCustomerRef?: string | null;
	/** The newest thing said on this order's thread, for the card in the list.
	 *  Resolved for the CALLER: the same message is an ordinary remark to one
	 *  operator and an unanswered question to the one it names. */
	chat?: {
		body: string;
		author: string;
		createdAt: string;
		mentionsMe: boolean;
		unread: boolean;
		/** True when this is the thread's pinned message rather than its newest. */
		pinned: boolean;
	} | null;
	previousOrders?: number; // other completed orders by the same phone (loyalty tag)
	customerConfirmation?: string | null; // PENDING | CONFIRMED | CANCELLED | NO_RESPONSE
	confirmationRespondedAt?: string | null;
	// Dropship: the customer belongs to the reseller and we never message them.
	// The backend refuses the sends; the UI hides the buttons and says why.
	suppressCustomerContact?: boolean;
	// Creator turned off the customer WhatsApp on the new-order form. A default,
	// not a lock — seeds the packing tracking-notify toggle to off, overridable.
	customerWaOptOut?: boolean;
	// Who to call instead — the reseller who sold this order. Null on retail.
	resellerName?: string | null;
	resellerPhone?: string | null;
	approvedAt?: string | null;
	rejectedAt?: string | null;
	sentAt?: string | null;
	approvedBy?: OrderActor;
	rejectedBy?: OrderActor;
	createdBy?: OrderActor;
	history?: OrderHistory[];
	items?: OrderItem[];
	shipment?: Shipment;
	createdAt: string;
	updatedAt?: string;
	/** Set by the backend for orders under review when an earlier order from the
	 *  same phone exists. 'exact' = same price/items/city within 24h. */
	duplicateOf?: {
		type: 'exact' | 'same_customer';
		id: string;
		orderKey?: string | null;
		status: string;
		createdAt: string;
		price?: string | number | null;
	} | null;
	[k: string]: unknown;
};

export type Product = {
	sku: string;
	name: string;
	price: number;
	imageUrl?: string | null;
};

// Live per-warehouse stock for one order line, read straight from the Gini ERP.
export type ErpStockItem = {
	sku: string;
	/** Units this order needs — summed across duplicate lines with the same SKU. */
	needed: number;
	found: boolean;
	error?: string;
	stockId?: string;
	/** The ERP's own product name (warehouse shorthand, not the storefront name). */
	erpName?: string;
	/** How the SKU was resolved — 'exact' is the trustworthy one. */
	matchedBy?: 'exact' | 'normalized' | 'search';
	/** True only when the matched ERP code differs beyond cosmetics (recycled-SKU
	 *  risk). A case/whitespace-only difference (STAND↔stand) is NOT approximate. */
	approx?: boolean;
	total?: number;
	enough?: boolean;
	branches?: Array<{
		name: string;
		/** Sellable quantity — showroom/demo/damaged units already subtracted
		 *  (Genelog/backend/app/models/product_showroom_unit.py) when present. */
		qty: number;
		/** The ERP's raw quantity before that subtraction. Present only
		 *  alongside `unsellable`. */
		rawQty?: number;
		/** Units at this branch curated as not actually sellable. */
		unsellable?: number;
	}>;
	prices?: Array<{ label: string; price: number }>;
};

// Which single warehouse could fulfil the whole order, computed server-side.
export type ErpStockSuggestion = {
	/** Branch that covers every resolved line, or null when none does. */
	suggested: string | null;
	coveredBy: string[];
	/** True when no single branch holds the whole order — it must be split. */
	splitRequired: boolean;
	perBranch: Array<{ name: string; covers: number; of: number; missing: string[]; slack: number }>;
	/** SKUs the ERP could not resolve; excluded from the maths above. */
	unknown: string[];
	/** True when `unknown` is non-empty — the suggestion is not the whole picture. */
	partial: boolean;
};

export type ErpStockResponse = {
	success: boolean;
	items: ErpStockItem[];
	/** Union of branch names in ERP order, so the UI can lay out stable columns. */
	branches: string[];
	suggestion: ErpStockSuggestion;
	checkedAt: string;
	error?: string;
};

/** The ERP's sell-price tiers for one SKU, for the per-row price picker. */
export type ErpPriceTier = { label: string; price: number };

/** Stock + prices for a single SKU, as the new-order rows need them. */
export type ErpProductResponse = {
	success: boolean;
	sku: string;
	found: boolean;
	/** The ERP's own product name — the operator's check that the SKU matched. */
	erpName?: string;
	/** The storefront's picture for this exact SKU, if it publishes one. The ERP
	 *  has none, so this is where a hand-typed row gets its image. */
	imageUrl?: string | null;
	/** Units across every branch, the ERP's own sum. */
	total?: number;
	branches: Array<{ name: string; qty: number }>;
	prices: ErpPriceTier[];
	error?: string;
};

// One of the customer's earlier orders, for the history panel.
export type CustomerHistoryOrder = {
	id: string;
	submissionId: string;
	/** Raw key; use orderLabel()/orderSlug() to render it. */
	idempotencyKey: string | null;
	status: string;
	/** Carrier outcome — RETURNED here is the signal worth seeing. */
	shipmentStatus: string | null;
	price: number;
	createdAt: string;
	cityName?: string | null;
	regionName?: string | null;
	items: Array<{ name: string; quantity: number }>;
};

export type CustomerHistoryResponse = {
	success: boolean;
	/** Counted over ALL their orders, not just the ones listed. */
	summary: {
		total: number;
		completed: number;
		cancelled: number;
		failed: number;
		returned: number;
		/** Completed orders only — pending and cancelled are not revenue. */
		totalSpent: number;
	} | null;
	orders: CustomerHistoryOrder[];
};

export type CityOrRegion = {
	id: number;
	name: string;
	nameAr: string;
};

export type ContactAddressSuggestion = {
	id: string;
	cityId: number;
	cityName: string;
	regionId: number | null;
	regionName: string | null;
	fullAddress: string;
	isDefault: boolean;
};

export type ContactLookup = {
	name: string;
	phone: string;
	addresses: ContactAddressSuggestion[];
};

class HttpError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

function getToken(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(TOKEN_KEY);
}

function getRefreshToken(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(REFRESH_KEY);
}

function setToken(token: string) {
	localStorage.setItem(TOKEN_KEY, token);
}

function setTokens(accessToken: string, refreshToken?: string) {
	localStorage.setItem(TOKEN_KEY, accessToken);
	if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

function getUser(): User | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(USER_KEY);
		return raw ? (JSON.parse(raw) as User) : null;
	} catch {
		return null;
	}
}

function setUser(user: User) {
	localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearAuth() {
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(REFRESH_KEY);
	localStorage.removeItem(USER_KEY);
}

// A 401 that a refresh can't fix (refresh token expired after a day, etc.) used
// to just surface "Unauthorized" and strand the user until a manual reload — the
// reload silently re-auths via SSO because the IdP cookie is still valid. Do
// that automatically: clear the dead session and bounce to the SSO portal.
// Guarded against redirect loops (once per 10s) and skipped during logout / the
// break-glass local-login mode.
function forceReauth() {
	clearAuth();
	if (typeof window === 'undefined' || isLoggingOut() || wantsLocalLogin()) return;
	try {
		const now = Date.now();
		const last = Number(sessionStorage.getItem('sso_reauth_at') || 0);
		if (now - last < 10000) return; // already bouncing — don't loop
		sessionStorage.setItem('sso_reauth_at', String(now));
	} catch { /* sessionStorage unavailable — still redirect */ }
	redirectToPortal();
}

// Single-flight refresh: concurrent 401s share one /auth/refresh call.
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
	const refreshToken = getRefreshToken();
	if (!refreshToken) return false;
	if (!refreshInFlight) {
		refreshInFlight = (async () => {
			try {
				const res = await fetch(`${API_BASE}/auth/refresh`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ refreshToken })
				});
				if (!res.ok) return false;
				const data = await res.json().catch(() => ({}));
				if (data?.success && data.data?.accessToken) {
					setTokens(data.data.accessToken, data.data.refreshToken);
					if (data.data.user) setUser(data.data.user);
					return true;
				}
				return false;
			} catch {
				return false;
			} finally {
				// cleared after callers observe the result
				setTimeout(() => (refreshInFlight = null), 0);
			}
		})();
	}
	return refreshInFlight;
}

async function rawFetch(endpoint: string, opts: RequestInit): Promise<Response> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...((opts.headers as Record<string, string>) ?? {})
	};
	const token = getToken();
	if (token) headers['Authorization'] = `Bearer ${token}`;
	if (DEMO) return demoFetch(endpoint, { ...opts, headers });
	return fetch(`${API_BASE}${endpoint}`, { ...opts, headers });
}

// Endpoints that must NOT trigger a silent refresh: refreshing can't fix them
// (login mints the first token; refresh is the refresh itself). Everything else
// under /auth — notably /auth/me — should still refresh-and-retry on 401.
const NO_REFRESH = ['/auth/login', '/auth/refresh'];

async function request<T = unknown>(endpoint: string, opts: RequestInit = {}): Promise<T> {
	let res = await rawFetch(endpoint, opts);

	// Access token expired/invalid → try one silent refresh, then retry once.
	if (res.status === 401 && !NO_REFRESH.some((p) => endpoint.startsWith(p))) {
		const refreshed = await tryRefresh();
		if (refreshed) {
			res = await rawFetch(endpoint, opts);
		}
		if (res.status === 401) {
			forceReauth();
			throw new HttpError('Unauthorized', 401);
		}
	} else if (res.status === 401) {
		forceReauth();
		throw new HttpError('Unauthorized', 401);
	}

	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new HttpError(
			(data as { error?: string })?.error ?? `Request failed (${res.status})`,
			res.status
		);
	}
	return data as T;
}

// Session caches for daily-static reference data (see getCities/getRegions).
let citiesCache: Promise<ApiResponse<CityOrRegion[]>> | null = null;
const regionsCache = new Map<number, Promise<ApiResponse<CityOrRegion[]>>>();

export type ChatUser = {
	id: string;
	name: string;
	email: string;
	role: string;
};

export type ChatMessage = {
	id: string;
	conversationId: string;
	authorId: string;
	/** null when the message was deleted — the row stays so the thread keeps its shape. */
	body: string | null;
	createdAt: string;
	editedAt?: string | null;
	deletedAt?: string | null;
	/** Set on the one message that stands for this conversation — what the order
	 *  card shows in place of the newest line. At most one per conversation. */
	pinnedAt?: string | null;
	pinnedById?: string | null;
	author: ChatUser;
	mentions: { userId: string }[];
};

export type ChatConversation = {
	id: string;
	kind: 'ROOM' | 'DM' | 'ORDER';
	lastMessageAt: string | null;
	mutedUntil: string | null;
	/** Named the way an operator names an order: customer, city, total. */
	order: {
		id: string;
		submissionId: string;
		idempotencyKey?: string | null;
		customerName: string;
		cityName?: string | null;
		price?: number | string | null;
	} | null;
	members: ChatUser[];
	unread: number;
};

export type ChatRoom = {
	id: string;
	name: string;
	description: string;
	messageTtlMinutes: number | null;
	pruneByAnyMember: boolean;
	restricted: boolean;
	hasPasscode: boolean;
	locked: boolean;
	isOwner: boolean;
	lastMessageAt: string | null;
	unread: number;
};

export type ChatMention = {
	id: string;
	readAt: string | null;
	createdAt: string;
	message: ChatMessage & {
		conversation: { id: string; kind: string; submission: { id: string; submissionId: string } | null };
	};
};

export const api = {
	getToken,
	getUser,
	clearAuth,
	isAuthenticated: () => Boolean(getToken()),

	async login(email: string, password: string) {
		const data = await request<
			ApiResponse<{ token: string; accessToken: string; refreshToken: string; user: User }>
		>('/auth/login', {
			method: 'POST',
			body: JSON.stringify({ email, password })
		});
		if (data.success && data.data) {
			setTokens(data.data.accessToken ?? data.data.token, data.data.refreshToken);
			setUser(data.data.user);
		}
		return data;
	},

	// Federated login: exchange a Genelog-minted RS256 assertion for a session.
	async ssoLogin(assertion: string) {
		const data = await request<
			ApiResponse<{ token: string; accessToken: string; refreshToken: string; user: User }>
		>('/auth/sso', {
			method: 'POST',
			body: JSON.stringify({ assertion })
		});
		if (data.success && data.data) {
			setTokens(data.data.accessToken ?? data.data.token, data.data.refreshToken);
			setUser(data.data.user);
		}
		return data;
	},

	// Current user (refreshes the cached user, e.g. to pick up erpAccount).
	async me() {
		const data = await request<ApiResponse<User>>('/auth/me');
		if (data.success && data.data) setUser(data.data);
		return data;
	},

	async logout() {
		const refreshToken = getRefreshToken();
		try {
			await fetch(`${API_BASE}/auth/logout`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
				},
				body: JSON.stringify({ refreshToken })
			});
		} catch {
			/* best-effort */
		}
		clearAuth();
	},

	async listOrders(params: Record<string, string | number> = {}) {
		const q = new URLSearchParams(
			Object.entries(params).map(([k, v]) => [k, String(v)])
		).toString();
		return request<{
			success: boolean;
			data: Order[];
			pagination: { page: number; limit: number; total: number; totalPages: number };
		}>(`/admin/shipments${q ? '?' + q : ''}`);
	},

	async getOrder(id: string) {
		return request<ApiResponse<Order>>(`/admin/shipments/${id}`);
	},

	async approve(id: string, body: Record<string, unknown> = {}) {
		return request<ApiResponse<Order>>(`/admin/shipments/${id}/approve`, {
			method: 'POST',
			body: JSON.stringify(body)
		});
	},

	async reject(id: string, reason: string) {
		return request<ApiResponse<Order>>(`/admin/shipments/${id}/reject`, {
			method: 'POST',
			body: JSON.stringify({ reason })
		});
	},

	// Cancel a greenlit order (APPROVED/PACKED, or a late cancel on SENT_TO_CARRIER).
	// For a sent order it also deletes it at Alwaseet; `carrier` reports whether
	// that succeeded, or whether the carrier already received the parcel.
	// `cancelInvoice` opts into also cancelling the ERP invoice (if one exists) —
	// `invoice` reports whether that was attempted/succeeded.
	async cancel(id: string, reason: string, cancelInvoice = false) {
		return request<
			ApiResponse<Order> & {
				carrier?: { attempted: boolean; deleted: boolean; received: boolean };
				invoice?: { attempted: boolean; cancelled: boolean; reason: string | null };
			}
		>(`/admin/shipments/${id}/cancel`, {
			method: 'POST',
			body: JSON.stringify({ reason, cancelInvoice })
		});
	},

	// Delete/cancel an order at Alwaseet only (app/sticker orders); local status
	// is left untouched.
	async carrierCancel(id: string) {
		return request<{ success: boolean; message?: string; error?: string }>(
			`/admin/shipments/${id}/carrier-cancel`,
			{ method: 'POST' }
		);
	},

	// Hard-delete an order (ADMIN only).
	async deleteOrder(id: string) {
		return request<ApiResponse<unknown>>(`/admin/shipments/${id}`, { method: 'DELETE' });
	},

	// Phone → contact + saved addresses (for the new-order form autocomplete).
	async lookupContact(phone: string) {
		return request<ApiResponse<ContactLookup | null>>(
			`/admin/shipments/contact-lookup/${encodeURIComponent(phone)}`
		);
	},

	// Create a new order from the ops app (employee-entered). source=ADMIN_PANEL.
	async createOrder(data: Record<string, unknown>) {
		return request<ApiResponse<{ submissionId: string; id: string; status: string }>>(
			'/admin/shipments',
			{ method: 'POST', body: JSON.stringify(data) }
		);
	},

	// Manual status override — ADMIN only. Allowed: PENDING_REVIEW, CANCELLED, FAILED, SUCCESS.
	async setStatus(id: string, status: string) {
		return request<ApiResponse<Order>>(`/admin/shipments/${id}/status`, {
			method: 'PATCH',
			body: JSON.stringify({ status })
		});
	},

	// Operator marks the customer as having confirmed out-of-band (phone call etc.)
	// — stops the WhatsApp confirmation retries.
	async confirmCustomer(id: string) {
		return request<ApiResponse<{ customerConfirmation: string; confirmationRespondedAt: string }>>(
			`/admin/shipments/${id}/confirm-customer`,
			{ method: 'POST' }
		);
	},

	// What this customer ordered before. Wider than the loyalty badge: every
	// status (a cancelled or returned history is the useful part) and both phone
	// numbers.
	async customerHistory(id: string) {
		return request<CustomerHistoryResponse>(`/admin/shipments/${id}/customer-history`);
	},

	// Send a fresh confirmation carrying the order's CURRENT details — for after
	// an edit, since the message already sent quotes the old ones and WhatsApp
	// cannot edit it. Discards any answer the customer already gave and restarts
	// the retry cycle, so the caller must confirm first.
	async resendConfirmation(id: string) {
		return request<ApiResponse<{ phone: string; customerConfirmation: string }>>(
			`/admin/shipments/${id}/resend-confirmation`,
			{ method: 'POST' }
		);
	},

	// Manual carrier tracking-status override — ADMIN only. Pass null to clear.
	async setTrackingOverride(id: string, status: string | null) {
		return request<ApiResponse<{ trackingStatusOverride: string | null }>>(
			`/admin/shipments/${id}/tracking-override`,
			{ method: 'PATCH', body: JSON.stringify({ status }) }
		);
	},

	async addOperatorNote(id: string, note: string) {
		return request<ApiResponse<Order>>(`/admin/shipments/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ operatorNote: note })
		});
	},

	async update(id: string, data: Record<string, unknown>) {
		return request<ApiResponse<Order>>(`/admin/shipments/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(data)
		});
	},

	async editAlwaseet(id: string, data: Record<string, unknown>) {
		return request<ApiResponse<Order>>(`/admin/shipments/${id}/edit-alwaseet`, {
			method: 'POST',
			body: JSON.stringify(data)
		});
	},

	async reprint(id: string) {
		return request<ApiResponse<{ message: string }>>(`/admin/shipments/${id}/reprint`, {
			method: 'POST'
		});
	},

	// The current bound order's live carrier state — the "is the old label still
	// active?" check shown before re-linking.
	async stickerLiveStatus(id: string) {
		return request<{ success: boolean; orderId?: string; found?: boolean; active?: boolean; status?: string | null; error?: string }>(
			`/admin/shipments/${id}/sticker-live-status`
		);
	},

	// Alwaseet wallet snapshot per app account (ADMIN only). `safe` = settled/
	// withdrawable balance; `openGross` = gross of the current open settlement
	// batch ("المجموع الكلي للطلبات").
	async alwaseetWallets() {
		return request<
			ApiResponse<
				Array<{
					key: string;
					label: string;
					ok: boolean;
					merchantName?: string;
					safe?: number;
					openGross?: number;
					openCount?: number;
					error?: string;
				}>
			>
		>('/admin/shipments/wallets');
	},

	// Bind a sticker order to a FRESH preprinted sticker (damaged/lost label).
	// Creates a new carrier order on the new sticker, repoints the shipment, and
	// cancels the old order. Printerless + APP_STICKER only.
	async relinkSticker(id: string, qrId: string) {
		return request<{ success: boolean; trackingNumber?: string; oldOrderId?: string; oldCancelled?: boolean; message?: string; error?: string }>(
			`/admin/shipments/${id}/relink-sticker`,
			{ method: 'POST', body: JSON.stringify({ qrId }) }
		);
	},

	// Backfill + persist per-number WhatsApp status for a legacy order whose
	// stored flag is null. Idempotent: only checks unknown numbers, saves the
	// result, and returns the stored flags. enabled:false ⇒ checking unavailable.
	async recheckWhatsapp(id: string) {
		return request<{
			success: boolean;
			enabled: boolean;
			customerPhoneHasWa: boolean | null;
			customerPhone2HasWa: boolean | null;
		}>(`/admin/shipments/${id}/whatsapp-check`, { method: 'POST' });
	},

	async erpRetry(id: string) {
		return request<ApiResponse<{ status: string }>>(`/admin/shipments/${id}/erp-retry`, {
			method: 'POST'
		});
	},

	async pack(id: string, body: Record<string, unknown> = {}) {
		return request<ApiResponse<{ status?: string; trackingNumber?: string | null }>>(
			`/admin/shipments/${id}/pack`,
			{
				method: 'POST',
				body: JSON.stringify(body)
			}
		);
	},

	// Own-driver (LOCAL) delivery directory + manual status updates.
	/** One WhatsApp with everything the driver is leaving with; optionally moves
	 *  those orders to خرج للتوصيل in the same act. */
	async driverDaySheet(driverId: string, markOut: boolean) {
		return request<ApiResponse<{ count: number; movedOut: number }> & { message?: string }>(
			`/admin/shipments/local-drivers/${driverId}/day-sheet`,
			{ method: 'POST', body: JSON.stringify({ markOut }) }
		);
	},
	/** "Come to the shop." */
	async pageDriver(driverId: string, note?: string) {
		return request<ApiResponse<null> & { message?: string }>(
			`/admin/shipments/local-drivers/${driverId}/page`,
			{ method: 'POST', body: JSON.stringify({ note: note || '' }) }
		);
	},
	/** Move a LOCAL order to another own-driver, optionally repricing the drop.
	 *  Refused once it is settled. */
	async setLocalDriver(id: string, localDriverId: string, localDeliveryFee?: number | null) {
		return request<ApiResponse<{ changed: boolean }>>(`/admin/shipments/${id}/local-driver`, {
			method: 'POST',
			body: JSON.stringify(
				localDeliveryFee === undefined
					? { localDriverId }
					: { localDriverId, localDeliveryFee }
			)
		});
	},
	async pickupCounts() {
		return request<ApiResponse<PickupCounts>>('/admin/shipments/pickup-counts');
	},
	async listLocalDrivers() {
		return request<ApiResponse<LocalDriver[]>>('/admin/shipments/local-drivers');
	},
	async createLocalDriver(name: string, phone?: string) {
		return request<ApiResponse<LocalDriver>>('/admin/shipments/local-drivers', {
			method: 'POST',
			body: JSON.stringify({ name, phone: phone || null })
		});
	},
	async updateLocalDriver(id: string, name: string, phone?: string) {
		return request<ApiResponse<LocalDriver>>(`/admin/shipments/local-drivers/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ name, phone: phone || null })
		});
	},
	async deleteLocalDriver(id: string) {
		return request<ApiResponse<null>>(`/admin/shipments/local-drivers/${id}`, {
			method: 'DELETE'
		});
	},
	// Toggle the "returned item received back" flag on a LOCAL return order.
	async setReturnReceived(id: string, received: boolean) {
		return request<{ success: boolean; error?: string; data?: { returnReceivedAt: string | null } }>(
			`/admin/shipments/${id}/return-received`,
			{ method: 'POST', body: JSON.stringify({ received }) }
		);
	},
	async localStatus(id: string, status: 'OUT' | 'DELIVERED' | 'FAILED' | 'RETURNED') {
		return request<{ success: boolean; message?: string; error?: string; data?: { status?: string; statusName?: string } }>(
			`/admin/shipments/${id}/local-status`,
			{ method: 'POST', body: JSON.stringify({ status }) }
		);
	},
	// A driver's unsettled orders + debt totals.
	async driverLedger(driverId: string) {
		return request<ApiResponse<DriverLedger>>(`/admin/shipments/local-drivers/${driverId}/ledger`);
	},
	// Settle a driver's collected cash (marks their delivered orders settled).
	// Settle a driver's cash. Pass `shipmentIds` to settle exactly those orders —
	// any of them still out for delivery is marked delivered as part of the
	// settlement (`autoDeliveredIds` says which). With no ids the server settles
	// every delivered order the driver holds and marks nothing.
	// `remaining` is what the driver still owes after the batch.
	async settleDriver(driverId: string, shipmentIds?: string[]) {
		return request<{ success: boolean; message?: string; error?: string; data?: { count: number; total: number; remaining: number; shipmentIds: string[]; autoDeliveredIds: string[] } }>(
			`/admin/shipments/local-drivers/${driverId}/settle`,
			{ method: 'POST', body: JSON.stringify(shipmentIds ? { shipmentIds } : {}) }
		);
	},
	// Undo a settlement (clear settledAt for the given shipments, or the last batch).
	// `revertDeliveredIds` — the settle's own `autoDeliveredIds` — also puts those
	// orders back to خرج للتوصيل; without it they stay marked delivered.
	async unsettleDriver(driverId: string, shipmentIds?: string[], revertDeliveredIds?: string[]) {
		return request<{ success: boolean; error?: string; data?: { count: number; reverted?: number } }>(
			`/admin/shipments/local-drivers/${driverId}/unsettle`,
			{
				method: 'POST',
				body: JSON.stringify({
					...(shipmentIds ? { shipmentIds } : {}),
					...(revertDeliveredIds?.length ? { revertDeliveredIds } : {})
				})
			}
		);
	},

	// Is a preprinted Alwaseet sticker free to bind? Read-only; printerless
	// operators only. `ok` = free, `used` = already bound.
	async validateSticker(qrId: string) {
		return request<{ success: boolean; ok?: boolean; used?: boolean; errNum?: string; msg?: string; error?: string }>(
			`/admin/shipments/sticker/validate`,
			{ method: 'POST', body: JSON.stringify({ qrId }) }
		);
	},

	async searchProducts(query: string) {
		return request<{ success: boolean; products: Product[] }>(
			`/admin/shipments/search-products?q=${encodeURIComponent(query)}`
		);
	},

	// Live per-warehouse stock for this order's line items, read from the Gini
	// ERP on demand (one ERP round trip per product, ~350ms each, pooled). Pass
	// fresh=true to bypass the backend's 60s per-product cache.
	async erpStock(id: string, fresh = false) {
		return request<ErpStockResponse>(
			`/admin/shipments/${id}/erp-stock${fresh ? '?fresh=1' : ''}`
		);
	},

	// Stock and sell-price tiers for one SKU (مفرد / جمله / توزيع / اخرى + live
	// offers). Works with no order behind it, so the new-order screen can price
	// and stock-check a row before anything is saved. One call feeds both.
	async erpProduct(sku: string, fresh = false) {
		return request<ErpProductResponse>(
			`/admin/shipments/erp-product?sku=${encodeURIComponent(sku)}${fresh ? '&fresh=1' : ''}`
		);
	},

	async getCities() {
		// Cities are synced from Alwaseet once a day, so the list is effectively
		// static within a session. OrderDetail mounts (and refetches) on every
		// order the operator opens — without this cache a busy operator blows the
		// public rate limit (429 on /public/cities). Cache the in-flight promise
		// so concurrent mounts dedupe too.
		if (!citiesCache) {
			citiesCache = request<ApiResponse<CityOrRegion[]>>('/public/cities').catch((e) => {
				citiesCache = null; // let a later mount retry after a failure
				throw e;
			});
		}
		return citiesCache;
	},

	async getRegions(cityId: number) {
		// Same rationale as getCities — regions per city are daily-static.
		const cached = regionsCache.get(cityId);
		if (cached) return cached;
		const p = request<ApiResponse<CityOrRegion[]>>(`/public/regions/${cityId}`).catch((e) => {
			regionsCache.delete(cityId);
			throw e;
		});
		regionsCache.set(cityId, p);
		return p;
	},

	async listReminders(params: Record<string, string> = {}) {
		const q = new URLSearchParams(params).toString();
		return request<ApiResponse<Reminder[]>>(`/reminders${q ? '?' + q : ''}`);
	},

	async createReminder(body: {
		message: string;
		dueAt: string;
		submissionId?: string;
		assignedToId?: string;
	}) {
		return request<ApiResponse<Reminder>>('/reminders', {
			method: 'POST',
			body: JSON.stringify(body)
		});
	},

	async updateReminder(
		id: string,
		body: { action: 'snooze'; dueAt: string } | { action: 'complete' } | { action: 'dismiss' }
	) {
		return request<ApiResponse<Reminder>>(`/reminders/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body)
		});
	},

	async deleteReminder(id: string) {
		return request<ApiResponse<null>>(`/reminders/${id}`, { method: 'DELETE' });
	},

	async getAssignableUsers() {
		return request<ApiResponse<{ id: string; name: string; role: string }[]>>(
			'/reminders/assignable-users'
		);
	},

	// ── Settlement (تسوية الوسيط) — finance allowlist only, 403 for everyone else ──

	async settlementInvoices() {
		return request<
			ApiResponse<{
				invoices: SettlementInvoice[];
				totals: {
					count: number;
					merchantPrice: number;
					pendingCount: number;
					pendingAmount: number;
				};
			}>
		>('/admin/shipments/settlement/invoices');
	},

	/**
	 * Re-reads every ERP invoice behind the batch live. The carrier's own order
	 * list is served from a 60s server cache (a settled batch's rows don't move);
	 * `fresh` skips that, for the manual refresh button.
	 */
	async settlementInvoice(invoiceId: string, opts: { fresh?: boolean } = {}) {
		return request<ApiResponse<SettlementDetail>>(
			`/admin/shipments/settlement/invoices/${encodeURIComponent(invoiceId)}${opts.fresh ? '?fresh=1' : ''}`
		);
	},

	/** Tells Alwaseet the merchant took the money for this batch. */
	async settlementReceive(invoiceId: string) {
		return request<ApiResponse<null> & { message?: string }>(
			`/admin/shipments/settlement/invoices/${encodeURIComponent(invoiceId)}/receive`,
			{ method: 'POST' }
		);
	},

	// ── Chat (docs/OPS_CHAT_PLAN.md) ────────────────────────────────────────

	/** The thread for this order, created on first open. */
	async chatOrderThread(submissionId: string) {
		return request<ApiResponse<{ conversationId: string }>>(
			`/chat/order/${encodeURIComponent(submissionId)}`
		);
	},

	/** A page of messages, oldest first. `before` is a message id to page back from. */
	async chatMessages(conversationId: string, before?: string) {
		const qs = before ? `?before=${encodeURIComponent(before)}` : '';
		return request<
			ApiResponse<{
				messages: ChatMessage[];
				hasMore: boolean;
				lastReadAt: string | null;
				conversation: {
					id: string;
					kind: string;
					name: string | null;
					messageTtlMinutes: number | null;
					pruneByAnyMember: boolean;
				};
				readers: { userId: string; name: string; lastReadAt: string | null }[];
			}>
		>(
			`/chat/conversations/${encodeURIComponent(conversationId)}/messages${qs}`
		);
	},

	async chatSend(conversationId: string, body: string, mentions: string[] = []) {
		return request<ApiResponse<ChatMessage>>(
			`/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
			{ method: 'POST', body: JSON.stringify({ body, mentions }) }
		);
	},

	async chatMarkRead(conversationId: string) {
		return request<ApiResponse<null>>(
			`/chat/conversations/${encodeURIComponent(conversationId)}/read`,
			{ method: 'POST' }
		);
	},

	async chatEdit(messageId: string, body: string) {
		return request<ApiResponse<ChatMessage>>(`/chat/messages/${encodeURIComponent(messageId)}`, {
			method: 'PATCH',
			body: JSON.stringify({ body })
		});
	},

	async chatDelete(messageId: string) {
		return request<ApiResponse<null>>(`/chat/messages/${encodeURIComponent(messageId)}`, {
			method: 'DELETE'
		});
	},

	/** Who can be mentioned — active users, me excluded. */
	async chatUsers() {
		return request<ApiResponse<ChatUser[]>>('/chat/users');
	},

	/** Every conversation I belong to, with unread counts, plus the room's id. */
	async chatConversations() {
		return request<
			ApiResponse<{ conversations: ChatConversation[]; rooms: ChatRoom[]; roomId: string }>
		>('/chat/conversations');
	},

	/** The DM with this user, created on first open. */
	async chatDm(userId: string) {
		return request<ApiResponse<{ conversationId: string }>>(
			`/chat/dm/${encodeURIComponent(userId)}`,
			{ method: 'POST' }
		);
	},

	/** Enter a room's passcode; good for 12 hours. */
	async chatUnlock(conversationId: string, passcode: string) {
		return request<ApiResponse<null>>(
			`/chat/conversations/${encodeURIComponent(conversationId)}/unlock`,
			{ method: 'POST', body: JSON.stringify({ passcode }) }
		);
	},

	/** Lock the room behind you when you leave it. */
	async chatLock(conversationId: string) {
		return request<ApiResponse<null>>(
			`/chat/conversations/${encodeURIComponent(conversationId)}/lock`,
			{ method: 'POST' }
		);
	},

	/** Set or clear a room's passcode. Owner only. */
	async chatSetPasscode(conversationId: string, passcode: string) {
		return request<ApiResponse<{ hasPasscode: boolean }>>(
			`/chat/conversations/${encodeURIComponent(conversationId)}/passcode`,
			{ method: 'PATCH', body: JSON.stringify({ passcode }) }
		);
	},

	/** Wipe a conversation's history. Allowed by the room, or to an ADMIN. */
	async chatPrune(conversationId: string) {
		return request<ApiResponse<{ deleted: number }>>(
			`/chat/conversations/${encodeURIComponent(conversationId)}/prune`,
			{ method: 'POST' }
		);
	},

	/** My mentions, unread first. */
	async chatMentions() {
		return request<ApiResponse<ChatMention[]>>('/chat/mentions');
	},

	// ── Web Push (docs/OPS_CHAT_PLAN.md phase 6) ────────────────────────────

	/** The VAPID public key a browser needs before it can subscribe. */
	/** Pin a message, or release the pin. One per conversation. */
	async chatPin(messageId: string, pinned = true) {
		return request<ApiResponse<ChatMessage>>(
			`/chat/messages/${encodeURIComponent(messageId)}/pin`,
			{ method: 'POST', body: JSON.stringify({ pinned }) }
		);
	},

	async chatPushKey() {
		return request<ApiResponse<{ enabled: boolean; publicKey: string }>>('/chat/push/key');
	},

	/**
	 * Register this browser for notifications. Keyed server-side on the endpoint,
	 * so logging in on a shared phone re-points its subscription to whoever is
	 * using it now.
	 */
	async chatPushSubscribe(sub: PushSubscriptionJSON) {
		return request<ApiResponse<null>>('/chat/push/subscribe', {
			method: 'POST',
			body: JSON.stringify(sub)
		});
	},

	async chatPushUnsubscribe(endpoint: string) {
		return request<ApiResponse<null>>('/chat/push/subscribe', {
			method: 'DELETE',
			body: JSON.stringify({ endpoint })
		});
	}
};

export { HttpError };
