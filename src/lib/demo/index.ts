/**
 * Demo mode — the panel with no backend behind it.
 *
 * `rawFetch` in $lib/api hands every request here when `DEMO` is on, and this
 * module answers it from the fixtures in `./fixtures`. Mutations are applied to
 * the in-memory store, so approving an order really does move it out of the
 * review tab for the rest of the session; a reload resets everything.
 *
 * Scope: the endpoints the panel calls while an operator works — auth, the
 * order list and detail, the lifecycle actions, packing, chat, reminders,
 * drivers and the reference data. Anything else falls through to a generic
 * empty-but-successful answer, which keeps a screen we have not seeded from
 * throwing rather than pretending it has data.
 *
 * Nothing in here runs when DEMO is off; the whole module is behind a dynamic
 * import so a production build does not carry the fixtures.
 */

import type { Order } from '../api';
import {
	demoCities,
	demoConversations,
	demoDrivers,
	demoMessages,
	demoOperators,
	demoOrders,
	demoRegions,
	demoReminders,
	demoRooms,
	demoUser
} from './fixtures';

// Mutable session state. Cloned so a reload is a clean slate.
const orders: Order[] = structuredClone(demoOrders);
const reminders = structuredClone(demoReminders);
const messages = structuredClone(demoMessages);
const conversations = structuredClone(demoConversations);

const ok = (data: unknown, extra: Record<string, unknown> = {}) =>
	json({ success: true, data, ...extra });

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

const fail = (error: string, status = 400) => json({ success: false, error }, status);

const findOrder = (id: string) =>
	orders.find((o) => o.id === id || o.submissionId === id || o.idempotencyKey === id);

const touch = (o: Order) => {
	o.updatedAt = new Date().toISOString();
	return o;
};

/** Network is not instant, and a demo that answers in 0ms hides every spinner. */
const latency = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

type Handler = (ctx: {
	path: string;
	params: URLSearchParams;
	method: string;
	body: Record<string, unknown>;
	seg: string[];
}) => Response | undefined;

/* ── auth ─────────────────────────────────────────────────────────────────── */

/** api.ts reads `accessToken ?? token`; the auth store reads `token`. Send both. */
const session = () => ({
	token: 'demo-access-token',
	accessToken: 'demo-access-token',
	refreshToken: 'demo-refresh-token',
	user: demoUser
});

const auth: Handler = ({ path, method }) => {
	if (path === '/auth/login' && method === 'POST')
		return ok(session());
	if (path === '/auth/sso' && method === 'POST')
		return ok(session());
	if (path === '/auth/refresh' && method === 'POST')
		return ok(session());
	if (path === '/auth/me') return ok(demoUser);
	if (path === '/auth/logout') return ok(null);
	return undefined;
};

/* ── reference data ───────────────────────────────────────────────────────── */

const reference: Handler = ({ path, seg }) => {
	if (path === '/public/cities') return ok(demoCities);
	if (path.startsWith('/public/regions/')) return ok(demoRegions[Number(seg[2])] ?? []);
	return undefined;
};

/* ── orders: list, detail, lifecycle ──────────────────────────────────────── */

const orderRoutes: Handler = ({ path, params, method, body, seg }) => {
	// GET /admin/shipments — the list.
	//
	// Every filter the board sends is honoured, because the counts it derives
	// from them are visible: ignoring one does not degrade quietly, it puts the
	// full set behind a label that promises a subset — eight orders under
	// "failed delivery" when none failed.
	if (path === '/admin/shipments' && method === 'GET') {
		let rows = [...orders];

		const status = params.get('status');
		if (status) {
			const wanted = status.split(',').map((s) => s.trim());
			rows = rows.filter((o) => wanted.includes(o.status));
		}

		// The carrier's own reading, which lives on the shipment, not the order.
		const carrierClass = params.get('carrierClass');
		if (carrierClass) {
			const wanted = carrierClass.split(',').map((s) => s.trim());
			rows = rows.filter((o) => !!o.shipment?.carrierClass && wanted.includes(o.shipment.carrierClass));
		}

		if (params.get('returns') === '1') rows = rows.filter((o) => !!o.returnOrder);

		// Channel: a reseller's storefront versus our own. Both directions are
		// used — the dropship tab includes, the store tab excludes.
		const storeName = params.get('storeName');
		if (storeName) {
			const wanted = storeName.split(',').map((s) => s.trim().toLowerCase());
			rows = rows.filter((o) => wanted.includes((o.storeName ?? '').toLowerCase()));
		}
		const excludeStoreName = params.get('excludeStoreName');
		if (excludeStoreName) {
			const unwanted = excludeStoreName.split(',').map((s) => s.trim().toLowerCase());
			rows = rows.filter((o) => !unwanted.includes((o.storeName ?? '').toLowerCase()));
		}

		const q = params.get('search')?.trim() || params.get('q')?.trim();
		if (q)
			rows = rows.filter((o) =>
				[o.customerName, o.customerPhone, o.idempotencyKey, o.submissionId, o.cityName]
					.filter(Boolean)
					.some((v) => String(v).toLowerCase().includes(q.toLowerCase()))
			);

		const sortKey = params.get('sortBy') === 'updatedAt' ? 'updatedAt' : 'createdAt';
		rows.sort((a, b) => {
			const av = (a[sortKey] as string) ?? a.createdAt;
			const bv = (b[sortKey] as string) ?? b.createdAt;
			return av < bv ? 1 : -1;
		});

		const page = Number(params.get('page') || 1);
		const limit = Number(params.get('limit') || 20);
		const total = rows.length;
		const slice = rows.slice((page - 1) * limit, page * limit);
		// The list is deliberately lighter than the detail — same as the backend.
		return json({
			success: true,
			data: slice.map(({ history, ...rest }) => rest),
			pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
		});
	}

	// POST /admin/shipments — create
	if (path === '/admin/shipments' && method === 'POST') {
		const n = orders.length + 1;
		const created: Order = {
			id: `o-new-${n}`,
			submissionId: crypto.randomUUID(),
			idempotencyKey: `ORD-2026-${String(400 + n).padStart(6, '0')}`,
			source: 'ADMIN_PANEL',
			customerName: String(body.customerName ?? 'زبون جديد'),
			customerPhone: String(body.customerPhone ?? '07700000000'),
			cityId: Number(body.cityId ?? 1),
			cityName: demoCities.find((c) => c.id === Number(body.cityId))?.name ?? 'بغداد',
			regionId: Number(body.regionId ?? 101),
			regionName:
				demoRegions[Number(body.cityId ?? 1)]?.find((r) => r.id === Number(body.regionId))?.name ??
				'الكرادة',
			fullAddress: String(body.fullAddress ?? ''),
			price: Number(body.price ?? 0),
			itemsNumber: Number(body.itemsNumber ?? 1),
			status: 'PENDING_REVIEW',
			createdAt: new Date().toISOString(),
			items: (body.items as Order['items']) ?? []
		};
		orders.unshift(created);
		return ok(created);
	}

	if (!path.startsWith('/admin/shipments/')) return undefined;

	// Literal sub-routes come before /:id, exactly as the real API mounts them.
	if (path === '/admin/shipments/pickup-counts')
		return ok({
			branches: [
				{
					key: '612',
					name: 'بابلون',
					count: 2,
					drivers: [{ id: 'd-1', name: 'حيدر', phone: '07700000001', count: 2 }],
					orders: orders.slice(0, 2).map((o) => ({
						slug: o.idempotencyKey ?? o.id,
						label: o.idempotencyKey ?? `#${o.id}`,
						customerName: o.customerName,
						cityName: o.cityName,
						price: o.price
					}))
				}
			],
			total: 2
		});

	if (path === '/admin/shipments/wallets')
		return ok([
			{ operator: 'حساب تجريبي', email: 'demo@example.com', balance: 250000, orders: 4 },
			{ operator: 'سارة', email: 'sara@example.com', balance: 80000, orders: 2 }
		]);

	if (path === '/admin/shipments/local-drivers' && method === 'GET') return ok(demoDrivers);
	if (path === '/admin/shipments/settlement/invoices') return ok({ batches: [], invoices: [] });
	if (path === '/admin/shipments/sticker/validate')
		return ok({ valid: true, labelId: String(body.labelId ?? '4470999'), status: 'AVAILABLE' });
	if (path.startsWith('/admin/shipments/search-products')) return ok([]);
	if (path.startsWith('/admin/shipments/contact-lookup/')) return ok(null);

	if (path.startsWith('/admin/shipments/local-drivers/')) {
		const driver = demoDrivers.find((d) => d.id === seg[3]);
		if (!driver) return fail('Driver not found', 404);
		if (seg[4] === 'ledger' || seg[4] === 'day-sheet' || seg[4] === 'page')
			return ok({ driver, orders: [], totals: { outstanding: driver.outstanding ?? 0 } });
		return ok(driver);
	}

	// /admin/shipments/:id[/action]
	const order = findOrder(seg[2]);
	if (!order) return fail('Order not found', 404);
	const action = seg[3];

	if (!action) {
		if (method === 'GET') return ok(order);
		if (method === 'PATCH') {
			Object.assign(order, body);
			return ok(touch(order));
		}
		if (method === 'DELETE') {
			orders.splice(orders.indexOf(order), 1);
			return ok(null);
		}
	}

	switch (action) {
		case 'approve':
			order.status = 'APPROVED';
			order.approvedAt = new Date().toISOString();
			return ok(touch(order));
		case 'reject':
			order.status = 'REJECTED';
			order.rejectedAt = new Date().toISOString();
			if (body.reason) order.notes = String(body.reason);
			return ok(touch(order));
		case 'pack':
			order.status = 'PACKED';
			order.packedAt = new Date().toISOString();
			return ok(touch(order));
		case 'cancel':
			order.status = 'CANCELLED';
			return ok(touch(order), { carrier: null, invoice: null });
		case 'status':
			order.status = String(body.status ?? order.status);
			return ok(touch(order));
		case 'customer-history':
			return json({
				success: true,
				data: {
					orders: orders
						.filter((o) => o.customerPhone === order.customerPhone && o.id !== order.id)
						.map((o) => ({
							id: o.id,
							submissionId: o.submissionId,
							status: o.status,
							price: o.price,
							createdAt: o.createdAt,
							cityName: o.cityName
						})),
					total: 1
				}
			});
		case 'whatsapp-check':
			return ok({ hasWhatsApp: true, checked: true });
		case 'sticker-live-status':
			return ok({ status: 'AVAILABLE', labelId: order.shipment?.stickerLabelId ?? null });
		case 'confirm-customer':
			order.customerConfirmation = 'CONFIRMED';
			return ok(touch(order));
		case 'resend-confirmation':
			return ok({ sent: true });
		case 'erp-retry':
			order.erpInvoiceStatus = 'SETTLED';
			return ok({ status: 'SETTLED' });
		case 'reprint':
			return ok({ message: 'أُرسل الطلب إلى الطابعة (تجريبي)' });
		default:
			// Any other lifecycle verb: acknowledge without inventing a state change.
			return ok(touch(order));
	}
};

/* ── chat ─────────────────────────────────────────────────────────────────── */

/**
 * Chat. Every order gets its own thread, created on first open exactly as the
 * real API does, so the line an operator sees on an order card and the thread
 * behind it are the same conversation rather than two unrelated fixtures.
 *
 * The envelopes matter here: `chatOrderThread` answers with a bare
 * `{ conversationId }`, and a page of messages carries its own conversation and
 * read state alongside them. Returning a plain array instead renders as a
 * thread with nothing in it.
 */
function orderConversationId(submissionId: string): string {
	const order = findOrder(submissionId);
	const key = order?.id ?? submissionId;
	const id = `c-order-${key}`;
	if (!conversations.some((c) => c.id === id)) {
		conversations.push({
			id,
			kind: 'ORDER',
			lastMessageAt: null,
			mutedUntil: null,
			order: order
				? {
						id: order.id,
						submissionId: order.submissionId,
						idempotencyKey: order.idempotencyKey,
						customerName: order.customerName,
						cityName: order.cityName,
						price: order.price
					}
				: null,
			members: demoOperators.slice(0, 3)
		} as never);
	}
	return id;
}

const chat: Handler = ({ path, method, body, seg }) => {
	if (!path.startsWith('/chat')) return undefined;
	if (path === '/chat/users') return ok(demoOperators);
	if (path === '/chat/conversations')
		return ok({
			conversations: conversations.filter((c) => c.kind !== 'ROOM'),
			rooms: demoRooms,
			roomId: demoRooms[0]?.id ?? null
		});
	if (path === '/chat/mentions') return ok({ count: 0, items: [] });
	if (path === '/chat/push/key') return ok({ publicKey: null });
	if (path.startsWith('/chat/push/subscribe')) return ok(null);

	// GET /chat/order/:submissionId — the thread id, created on first open.
	if (path.startsWith('/chat/order/')) {
		return ok({ conversationId: orderConversationId(decodeURIComponent(seg[2])) });
	}

	if (seg[1] === 'conversations' && seg[3] === 'messages') {
		const id = seg[2];
		if (method === 'POST') {
			const msg = {
				id: `m-${Date.now()}`,
				conversationId: id,
				authorId: demoUser.id,
				body: String(body.body ?? ''),
				createdAt: new Date().toISOString(),
				author: demoOperators[0],
				mentions: ((body.mentions as string[]) ?? []).map((userId) => ({ userId }))
			};
			(messages[id] ??= []).push(msg as never);
			const conv = conversations.find((c) => c.id === id);
			if (conv) conv.lastMessageAt = msg.createdAt;
			return ok(msg);
		}
		const conv = conversations.find((c) => c.id === id);
		return ok({
			messages: messages[id] ?? [],
			hasMore: false,
			lastReadAt: null,
			conversation: {
				id,
				kind: conv?.kind ?? 'ORDER',
				name: null,
				messageTtlMinutes: null,
				pruneByAnyMember: false
			},
			readers: demoOperators.slice(0, 3).map((u) => ({
				userId: u.id,
				name: u.name,
				lastReadAt: null
			}))
		});
	}

	if (seg[1] === 'conversations') return ok(null); // read / lock / prune / passcode
	if (seg[1] === 'messages') return ok(null); // edit / delete / pin
	return undefined;
};

/* ── reminders ────────────────────────────────────────────────────────────── */

const reminderRoutes: Handler = ({ path, params, method, body, seg }) => {
	if (!path.startsWith('/reminders')) return undefined;
	if (path === '/reminders/assignable-users') return ok(demoOperators);
	if (path === '/reminders' && method === 'GET') {
		// The order detail asks by submissionId and the header chip by status.
		// Ignoring either puts the same reminder on every order.
		let rows = reminders;
		const submissionId = params.get('submissionId');
		if (submissionId) rows = rows.filter((r) => r.submissionId === submissionId);
		const status = params.get('status');
		if (status) {
			const wanted = status.split(',').map((x) => x.trim());
			rows = rows.filter((r) => wanted.includes(r.status));
		}
		return ok(rows);
	}
	if (path === '/reminders' && method === 'POST') {
		const r = {
			...structuredClone(demoReminders[0]),
			id: `r-${Date.now()}`,
			message: String(body.message ?? ''),
			dueAt: String(body.dueAt ?? new Date().toISOString()),
			status: 'PENDING' as const,
			createdAt: new Date().toISOString()
		};
		reminders.push(r);
		return ok(r);
	}
	const r = reminders.find((x) => x.id === seg[1]);
	if (!r) return fail('Reminder not found', 404);
	if (method === 'DELETE') {
		reminders.splice(reminders.indexOf(r), 1);
		return ok(null);
	}
	Object.assign(r, body);
	return ok(r);
};

const handlers: Handler[] = [auth, reference, orderRoutes, chat, reminderRoutes];

/**
 * Answer one API call from the fixtures. `endpoint` is the path as api.ts
 * builds it — already relative to /api, with its query string attached.
 */
export async function demoRespond(endpoint: string, opts: RequestInit): Promise<Response> {
	await latency();

	const [rawPath, rawQuery = ''] = endpoint.split('?');
	const path = rawPath.replace(/\/+$/, '') || '/';
	const params = new URLSearchParams(rawQuery);
	const method = (opts.method ?? 'GET').toUpperCase();
	const seg = path.split('/').filter(Boolean);

	let body: Record<string, unknown> = {};
	if (typeof opts.body === 'string') {
		try {
			body = JSON.parse(opts.body);
		} catch {
			/* not JSON — handlers that care will read the defaults */
		}
	}

	const ctx = { path, params, method, body, seg };
	for (const h of handlers) {
		const res = h(ctx);
		if (res) return res;
	}

	// Unseeded endpoint: succeed emptily rather than throw. A screen we have not
	// modelled then renders its own empty state, which is the honest answer.
	return ok(method === 'GET' ? [] : null);
}

export { demoImage } from './image';
