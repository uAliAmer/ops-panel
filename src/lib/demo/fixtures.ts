/**
 * Seed data for demo mode.
 *
 * Invented orders, customers and operators — nothing here came from a real
 * shipment. The Arabic is the real operator vocabulary, because the panel's
 * layout only behaves honestly when the strings are the length they will be in
 * production; a demo padded with Lorem Ipsum hides every RTL wrapping bug.
 *
 * Dates are generated relative to load, so a clone is never stale.
 */

import type {
	ChatConversation,
	ChatMessage,
	ChatRoom,
	ChatUser,
	LocalDriver,
	Order,
	Reminder,
	User
} from '../api';

const now = Date.now();
const HOUR = 3600_000;
const ago = (hours: number) => new Date(now - hours * HOUR).toISOString();
const ahead = (hours: number) => new Date(now + hours * HOUR).toISOString();

export const demoUser: User = {
	id: 'u-demo',
	email: 'demo@example.com',
	name: 'حساب تجريبي',
	role: 'ADMIN',
	erpAccount: '612',
	printerless: false,
	alwaseetAccount: 'main',
	finance: true
};

export const demoOperators: ChatUser[] = [
	{ id: 'u-demo', name: 'حساب تجريبي', email: 'demo@example.com', role: 'ADMIN' },
	{ id: 'u-2', name: 'سارة', email: 'sara@example.com', role: 'OPERATOR' },
	{ id: 'u-3', name: 'مصطفى', email: 'mustafa@example.com', role: 'OPERATOR' },
	{ id: 'u-4', name: 'نور', email: 'noor@example.com', role: 'VIEWER' }
];

export const demoCities = [
	{ id: 1, name: 'بغداد' },
	{ id: 2, name: 'البصرة' },
	{ id: 3, name: 'أربيل' },
	{ id: 4, name: 'النجف' },
	{ id: 5, name: 'كربلاء' },
	{ id: 6, name: 'الموصل' }
];

export const demoRegions: Record<number, { id: number; name: string }[]> = {
	1: [
		{ id: 101, name: 'الكرادة' },
		{ id: 102, name: 'المنصور' },
		{ id: 103, name: 'زيونة' },
		{ id: 104, name: 'الجادرية' },
		{ id: 105, name: 'الأعظمية' }
	],
	2: [
		{ id: 201, name: 'العشار' },
		{ id: 202, name: 'الجبيلة' }
	],
	3: [
		{ id: 301, name: 'عنكاوا' },
		{ id: 302, name: 'شقلاوة' }
	],
	4: [{ id: 401, name: 'المركز' }],
	5: [{ id: 501, name: 'المركز' }],
	6: [{ id: 601, name: 'الدواسة' }]
};

export const demoDrivers: LocalDriver[] = [
	{
		id: 'd-1',
		name: 'حيدر',
		phone: '07700000001',
		active: true,
		outstanding: 185000,
		settleable: 110000,
		settleableCount: 2,
		pending: 75000
	},
	{
		id: 'd-2',
		name: 'علي',
		phone: '07700000002',
		active: true,
		outstanding: 0,
		settleable: 0,
		settleableCount: 0,
		pending: 0
	}
];

/** Image filenames are synthetic; the seed is what picks each demo picture. */
const img = (seed: string) => `/api/static/images/${seed}.webp`;

/**
 * The order set is chosen to cover the states an operator actually sorts
 * between — not one of each status for symmetry. In particular there is one
 * single-item order (the packing hero), one dropship order (the two-ledger
 * rule), one local-driver order, and one sticker order.
 */
export const demoOrders: Order[] = [
	{
		id: 'o-1',
		submissionId: 'a1b2c3d4-0000-4000-8000-000000000001',
		idempotencyKey: 'ORD-2026-000341',
		source: 'WEB_FORM',
		customerName: 'أحمد الجبوري',
		customerPhone: '07701234567',
		customerPhoneHasWa: true,
		cityId: 1,
		cityName: 'بغداد',
		regionId: 101,
		regionName: 'الكرادة',
		fullAddress: 'الكرادة داخل، قرب جامع البنية، بناية 12',
		notes: 'الاتصال قبل الوصول بنصف ساعة',
		price: 85000,
		itemsNumber: 3,
		status: 'PENDING_REVIEW',
		storeName: 'المتجر الإلكتروني',
		discountAmount: 5000,
		discountCode: 'WELCOME',
		previousOrders: 2,
		customerConfirmation: 'CONFIRMED',
		createdAt: ago(3),
		items: [
			{ sku: '5-33', name: 'سيروم فيتامين سي', quantity: 2, unitPrice: 25000, imageUrl: img('serum') },
			{ sku: '12-4', name: 'كريم مرطب للوجه', quantity: 1, unitPrice: 30000, imageUrl: img('cream') }
		],
		history: [
			{ id: 'h-1', action: 'CREATED', createdAt: ago(3), actor: null } as never
		],
		chat: {
			body: 'الزبون طلب التوصيل بعد الساعة 4',
			author: 'سارة',
			createdAt: ago(1),
			mentionsMe: true,
			unread: true,
			pinned: false
		}
	},
	{
		id: 'o-2',
		submissionId: 'a1b2c3d4-0000-4000-8000-000000000002',
		idempotencyKey: 'ORD-2026-000342',
		source: 'ADMIN_PANEL',
		customerName: 'زينب العلي',
		customerPhone: '07809876543',
		customerPhoneHasWa: false,
		cityId: 2,
		cityName: 'البصرة',
		regionId: 201,
		regionName: 'العشار',
		fullAddress: 'العشار، شارع الكويت، محل 7',
		price: 45000,
		itemsNumber: 1,
		status: 'APPROVED',
		approvedAt: ago(2),
		customerConfirmation: 'PENDING',
		createdAt: ago(8),
		// Single item on purpose: this is the order that opens the packing hero.
		items: [
			{ sku: '88-2', name: 'مجفف شعر احترافي', quantity: 1, unitPrice: 40000, imageUrl: img('dryer') }
		]
	},
	{
		id: 'o-3',
		submissionId: 'a1b2c3d4-0000-4000-8000-000000000003',
		idempotencyKey: 'ORD-2026-000343',
		source: 'API',
		// The channel is what makes this a dropship order to the panel — the
		// reseller fields alone do not classify it (see utils/source.ts).
		storeName: 'Dropship',
		customerName: 'مريم حسن',
		customerPhone: '07512223333',
		cityId: 3,
		cityName: 'أربيل',
		regionId: 301,
		regionName: 'عنكاوا',
		fullAddress: 'عنكاوا، قرب الكنيسة، بيت 44',
		price: 120000,
		itemsNumber: 4,
		status: 'PACKED',
		packedAt: ago(1),
		approvedAt: ago(5),
		// Dropship: line prices are OUR wholesale rate, the total is what the
		// reseller collects from their own customer. Never subtract one from
		// the other — see CLAUDE.md.
		resellerName: 'متجر النور',
		resellerPhone: '07711112222',
		suppressCustomerContact: true,
		erpCustomerRef: 'reseller-18',
		createdAt: ago(10),
		items: [
			{ sku: '3-91', name: 'طقم عناية بالبشرة', quantity: 2, unitPrice: 32000, imageUrl: img('kit') },
			{ sku: '7-15', name: 'غسول وجه', quantity: 2, unitPrice: 9000, imageUrl: img('wash') }
		]
	},
	{
		id: 'o-4',
		submissionId: 'a1b2c3d4-0000-4000-8000-000000000004',
		idempotencyKey: 'ORD-2026-000344',
		source: 'WEB_FORM',
		customerName: 'عمر الخفاجي',
		customerPhone: '07704445555',
		customerPhoneHasWa: true,
		cityId: 4,
		cityName: 'النجف',
		regionId: 401,
		regionName: 'المركز',
		fullAddress: 'النجف، حي السلام، زقاق 3',
		price: 60000,
		itemsNumber: 2,
		status: 'SENT_TO_CARRIER',
		sentAt: ago(20),
		approvedAt: ago(26),
		packedAt: ago(22),
		erpInvoiceStatus: 'SETTLED',
		createdAt: ago(30),
		items: [
			{ sku: '21-8', name: 'عطر رجالي', quantity: 1, unitPrice: 55000, imageUrl: img('perfume') }
		],
		shipment: {
			id: 's-4',
			alwaseetOrderId: '4471209',
			trackingNumber: '4471209',
			trackingToken: 'c0ffee1234567',
			status: 'SENT_TO_CARRIER',
			carrierMethod: 'OFFICIAL',
			branchKey: '612',
			carrierClass: 'IN_FLIGHT',
			alwaseetStatusName: 'قيد التوصيل',
			alwaseetStatusAt: ago(6),
			pickedUpAt: ago(18)
		}
	},
	{
		id: 'o-5',
		submissionId: 'a1b2c3d4-0000-4000-8000-000000000005',
		idempotencyKey: 'ORD-2026-000345',
		source: 'WEB_FORM',
		customerName: 'ليلى كاظم',
		customerPhone: '07806667777',
		cityId: 1,
		cityName: 'بغداد',
		regionId: 103,
		regionName: 'زيونة',
		fullAddress: 'زيونة، شارع الربيعي، عمارة 9',
		price: 35000,
		itemsNumber: 1,
		status: 'SENT_TO_CARRIER',
		sentAt: ago(48),
		createdAt: ago(60),
		items: [
			{ sku: '44-1', name: 'مرآة مكياج بإضاءة', quantity: 1, unitPrice: 30000, imageUrl: img('mirror') }
		],
		// Our own rider, no carrier at all.
		shipment: {
			id: 's-5',
			status: 'SENT_TO_CARRIER',
			carrierMethod: 'LOCAL',
			localDriverId: 'd-1',
			localDriverName: 'حيدر',
			localDriverPhone: '07700000001',
			localDeliveryFee: 5000
		}
	},
	{
		id: 'o-6',
		submissionId: 'a1b2c3d4-0000-4000-8000-000000000006',
		idempotencyKey: 'ORD-2026-000346',
		source: 'TELEGRAM',
		customerName: 'حسين الساعدي',
		customerPhone: '07508889999',
		cityId: 5,
		cityName: 'كربلاء',
		regionId: 501,
		regionName: 'المركز',
		fullAddress: 'كربلاء، حي الحسين، دار 21',
		price: 72000,
		itemsNumber: 2,
		status: 'SUCCESS',
		sentAt: ago(96),
		erpInvoiceStatus: 'SETTLED',
		createdAt: ago(120),
		items: [
			{ sku: '9-27', name: 'ساعة يد', quantity: 1, unitPrice: 65000, imageUrl: img('watch') }
		],
		shipment: {
			id: 's-6',
			alwaseetOrderId: '4470882',
			trackingNumber: '4470882',
			status: 'SUCCESS',
			// Preprinted sticker: the label id IS the carrier order id.
			carrierMethod: 'APP_STICKER',
			stickerLabelId: '4470882',
			alwaseetAccount: 'asalet',
			branchKey: '2459',
			carrierClass: 'DELIVERED',
			alwaseetStatusName: 'تم التسليم',
			alwaseetStatusAt: ago(72)
		}
	},
	{
		id: 'o-7',
		submissionId: 'a1b2c3d4-0000-4000-8000-000000000007',
		source: 'WEB_FORM',
		customerName: 'فاطمة رشيد',
		customerPhone: '07701112222',
		cityId: 6,
		cityName: 'الموصل',
		regionId: 601,
		regionName: 'الدواسة',
		fullAddress: 'الموصل، الدواسة، قرب الصيدلية',
		price: 28000,
		itemsNumber: 1,
		status: 'REJECTED',
		rejectedAt: ago(14),
		notes: 'توصيل بعد الساعة 4 العصر',
		createdAt: ago(16),
		items: [{ sku: '66-3', name: 'شامبو', quantity: 1, unitPrice: 23000, imageUrl: img('shampoo') }]
	},
	{
		id: 'o-8',
		submissionId: 'a1b2c3d4-0000-4000-8000-000000000008',
		source: 'WEB_FORM',
		customerName: 'كرار عبد الله',
		customerPhone: '07703334444',
		customerPhoneHasWa: true,
		cityId: 1,
		cityName: 'بغداد',
		regionId: 102,
		regionName: 'المنصور',
		fullAddress: 'المنصور، شارع 14 رمضان',
		price: 95000,
		itemsNumber: 5,
		status: 'PENDING_REVIEW',
		freeDelivery: true,
		customerConfirmation: 'NO_RESPONSE',
		createdAt: ago(1),
		items: [
			{ sku: '5-33', name: 'سيروم فيتامين سي', quantity: 3, unitPrice: 25000, imageUrl: img('serum') },
			{ sku: '7-15', name: 'غسول وجه', quantity: 2, unitPrice: 10000, imageUrl: img('wash') }
		],
		duplicateOf: {
			type: 'same_customer',
			id: 'o-1',
			status: 'PENDING_REVIEW',
			createdAt: ago(3),
			price: 85000
		}
	}
];

export const demoReminders: Reminder[] = [
	{
		id: 'r-1',
		message: 'متابعة الزبون أحمد بخصوص وقت التوصيل',
		dueAt: ahead(2),
		status: 'PENDING',
		createdById: 'u-demo',
		assignedToId: 'u-2',
		submissionId: 'o-1',
		notifiedAt: null,
		telegramSentAt: null,
		completedAt: null,
		createdAt: ago(2),
		updatedAt: ago(2),
		createdBy: { id: 'u-demo', name: 'حساب تجريبي' },
		assignedTo: { id: 'u-2', name: 'سارة' },
		submission: {
			id: 'o-1',
			submissionId: 'a1b2c3d4-0000-4000-8000-000000000001',
			customerName: 'أحمد الجبوري',
			status: 'PENDING_REVIEW'
		}
	}
];

export const demoConversations: ChatConversation[] = [
	{
		// Must match orderConversationId() in ./index — the card's chat line and
		// this thread are the same conversation.
		id: 'c-order-o-1',
		kind: 'ORDER',
		lastMessageAt: ago(1),
		mutedUntil: null,
		order: {
			id: 'o-1',
			submissionId: 'a1b2c3d4-0000-4000-8000-000000000001',
			idempotencyKey: 'ORD-2026-000341',
			customerName: 'أحمد الجبوري',
			cityName: 'بغداد',
			price: 85000
		},
		members: demoOperators.slice(0, 3)
	} as ChatConversation,
	{
		id: 'c-2',
		kind: 'ROOM',
		lastMessageAt: ago(5),
		mutedUntil: null,
		order: null,
		members: demoOperators
	} as ChatConversation
];

/** The team room. The conversations drawer opens onto this by default. */
export const demoRooms: ChatRoom[] = [
	{
		id: 'c-2',
		name: 'غرفة الفريق',
		description: 'كل ما يخص الشغل اليومي',
		messageTtlMinutes: null,
		pruneByAnyMember: false,
		restricted: false,
		hasPasscode: false,
		locked: false,
		isOwner: true,
		lastMessageAt: ago(5),
		unread: 0
	}
];

export const demoMessages: Record<string, ChatMessage[]> = {
	'c-order-o-1': [
		{
			id: 'm-1',
			conversationId: 'c-order-o-1',
			authorId: 'u-2',
			body: 'الزبون طلب التوصيل بعد الساعة 4',
			createdAt: ago(1),
			author: demoOperators[1],
			mentions: [{ userId: 'u-demo' }]
		}
	],
	'c-2': [
		{
			id: 'm-2',
			conversationId: 'c-2',
			authorId: 'u-3',
			body: 'الطلبات المجهزة اليوم جاهزة للمندوب',
			createdAt: ago(5),
			author: demoOperators[2],
			mentions: []
		}
	]
};
