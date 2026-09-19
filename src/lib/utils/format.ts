const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

const TZ = 'Asia/Baghdad';

export function formatPrice(value: unknown): string {
	const n = Number(value) || 0;
	return n.toLocaleString('en-US');
}

/** Arabic-grammar piece count: 1 → "قطعة واحدة", 2 → "قطعتان", 3–10 → "N قطع", 11+ → "N قطعة". */
export function formatPieces(value: unknown): string {
	const n = Number(value) || 1;
	if (n === 1) return 'قطعة واحدة';
	if (n === 2) return 'قطعتان';
	if (n <= 10) return `${n} قطع`;
	return `${n} قطعة`;
}

export function formatTime(d: string | Date | undefined | null): string {
	if (!d) return '';
	const date = new Date(d);
	const timeStr = date
		.toLocaleTimeString('en-US', {
			timeZone: TZ,
			hour: '2-digit',
			minute: '2-digit',
			hour12: true
		})
		.toLowerCase();
	const dateStr = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
	return `${timeStr} • ${dateStr}`;
}

/**
 * Returns { time, relDay } for the order card.
 * time — "03:45 pm" (LTR, Baghdad TZ)
 * relDay — "اليوم" / "الأمس" / "منذ يومين" / short date like "15 May"
 */
export function formatCardDate(d: string | Date | undefined | null): {
	time: string;
	relDay: string;
} {
	if (!d) return { time: '', relDay: '' };

	const date = new Date(d);

	const time = date
		.toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true })
		.toLowerCase();

	// Compare calendar days in Baghdad TZ
	const nowBaghdad = new Date(
		new Date().toLocaleString('en-US', { timeZone: TZ })
	);
	const dateBaghdad = new Date(
		date.toLocaleString('en-US', { timeZone: TZ })
	);

	const todayMidnight = new Date(nowBaghdad);
	todayMidnight.setHours(0, 0, 0, 0);
	const dateMidnight = new Date(dateBaghdad);
	dateMidnight.setHours(0, 0, 0, 0);

	const diffDays = Math.round(
		(todayMidnight.getTime() - dateMidnight.getTime()) / 86_400_000
	);

	let relDay: string;
	if (diffDays === 0) relDay = 'اليوم';
	else if (diffDays === 1) relDay = 'الأمس';
	else if (diffDays === 2) relDay = 'منذ يومين';
	else if (diffDays <= 6) relDay = `منذ ${diffDays} أيام`;
	else relDay = `${dateBaghdad.getDate()} ${MONTHS[dateBaghdad.getMonth()]}`;

	return { time, relDay };
}

export function formatDateTime(d: string | Date | undefined | null): string {
	if (!d) return '';
	return new Date(d).toLocaleString('en-GB', {
		timeZone: TZ,
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: true
	});
}

/**
 * A timestamp for something that usually just happened.
 *
 * Shows the clock alone when it falls on today's Baghdad date, and adds the date
 * only when it does not. The ERP stock check stamps UTC and the panel renders in
 * Baghdad (UTC+3), so after 21:00 UTC a full date reads as tomorrow — which looks
 * like a bug on a reading that is seconds old.
 */
export function formatCheckedAt(d: string | Date | undefined | null): string {
	if (!d) return '';
	const when = new Date(d);
	const day = (x: Date) => x.toLocaleDateString('en-GB', { timeZone: TZ });
	const time = when.toLocaleTimeString('en-GB', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: true
	});
	return day(when) === day(new Date()) ? time : `${day(when)} ${time}`;
}

/**
 * Calculates live human relative time (seconds / minutes / hours ago).
 */
export function formatStockRelative(
	d: string | Date | undefined | null,
	nowMs: number = Date.now()
): string {
	if (!d) return '';
	const when = new Date(d).getTime();
	if (isNaN(when)) return '';
	const diffSec = Math.max(0, Math.floor((nowMs - when) / 1000));

	if (diffSec < 5) return 'الآن';
	if (diffSec < 11) return `منذ ${diffSec} ثوانٍ`;
	if (diffSec < 60) return `منذ ${diffSec} ثانية`;

	const diffMin = Math.floor(diffSec / 60);
	if (diffMin === 1) return 'منذ دقيقة';
	if (diffMin === 2) return 'منذ دقيقتين';
	if (diffMin >= 3 && diffMin <= 10) return `منذ ${diffMin} دقائق`;
	if (diffMin < 60) return `منذ ${diffMin} دقيقة`;

	const diffHours = Math.floor(diffMin / 60);
	if (diffHours === 1) return 'منذ ساعة';
	if (diffHours === 2) return 'منذ ساعتين';
	if (diffHours >= 3 && diffHours <= 10) return `منذ ${diffHours} ساعات`;
	if (diffHours < 24) return `منذ ${diffHours} ساعة`;

	const diffDays = Math.floor(diffHours / 24);
	if (diffDays === 1) return 'منذ يوم';
	if (diffDays === 2) return 'منذ يومين';
	return `منذ ${diffDays} أيام`;
}

export function formatDiscountLabel(
	code: string | undefined | null,
	amount: string | number | undefined | null
): string {
	if (!code) return '';
	const saved = Number(amount) || 0;
	const amountStr = saved > 0 ? ` (وفّر ${saved.toLocaleString('en-US')} د.ع)` : '';
	if (code.startsWith('OFFER:')) return `عرض تلقائي${amountStr}`;
	if (code.includes(';LOYALTY:') || code.startsWith('LOYALTY:')) {
		const pts = code.match(/LOYALTY:(\d+)pts/)?.[1];
		return `نقاط الولاء${pts ? ' (' + pts + ' نقطة)' : ''}${amountStr}`;
	}
	return `كود خصم: ${code}${amountStr}`;
}

/**
 * Strip the storefront's `[Order: ORD-…]` traceability tag from customer notes
 * for display. The tag is kept in the stored value (and forwarded to Alwaseet),
 * just hidden in the ops UI.
 */
export function displayNotes(notes: string | undefined | null): string {
	return (notes ?? '').replace(/\[Order:.*?\]/gi, '').trim();
}

/**
 * Staff notes (`operatorNote`) are one blob of entries joined by a blank line,
 * each headed by "Name (dd/mm/yyyy, hh:mm am):" (see saveNote in OrderDetail).
 * Parse/serialize let the UI edit or delete a single entry.
 */
export type OpNote = { author: string; stamp: string; body: string };

const OP_NOTE_HEADER = /^(.+?) \((\d{1,2}\/\d{1,2}\/\d{4},?[^)]*)\):\s*$/;

/**
 * Orders created before 2026-08-05 had a machine-written "no WhatsApp" line
 * appended to their staff notes at ingest. It is not a note anyone wrote, and
 * the same fact is now shown as a chip beside the phone number itself — so it is
 * stripped on render rather than migrated, leaving the stored text untouched.
 *
 * EVERY render path must go through this: the order screen, the card, and the
 * "previous notes" block in the add-note dialog all read operatorNote, and
 * stripping in only one of them is what let the line keep showing on cards.
 */
const LEGACY_WA_WARNING = /^\s*⚠️\s*لا يمتلك واتساب\s*\([^)]*\)\s*$/;

export function displayOpNotes(raw: string | undefined | null): string {
	if (!raw || !raw.trim()) return '';
	return raw
		.split('\n')
		.filter((line) => !LEGACY_WA_WARNING.test(line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n') // close the gap the removed line leaves behind
		.trim();
}

export function parseOpNotes(raw: string | undefined | null): OpNote[] {
	raw = displayOpNotes(raw);
	if (!raw) return [];
	const out: OpNote[] = [];
	let cur: OpNote | null = null;
	for (const line of raw.split('\n')) {
		const m = line.match(OP_NOTE_HEADER);
		if (m) {
			if (cur) out.push(cur);
			cur = { author: m[1].trim(), stamp: m[2].trim(), body: '' };
		} else if (cur) {
			cur.body += (cur.body ? '\n' : '') + line;
		} else {
			// Legacy note saved without a header
			cur = { author: '', stamp: '', body: line };
		}
	}
	if (cur) out.push(cur);
	return out.map((e) => ({ ...e, body: e.body.replace(/^\n+|\n+$/g, '') })).filter((e) => e.body.trim() || e.author);
}

export function serializeOpNotes(notes: OpNote[]): string {
	return notes
		.map((e) => (e.author ? `${e.author} (${e.stamp}):\n${e.body}` : e.body))
		.join('\n\n');
}

/**
 * Strip emoji/pictographs (and any stray variation selectors) from text the
 * backend stored with leading emoji — e.g. history notes like
 * "✅ أكد الزبون…". The UI conveys state with colored dots/SVG icons instead.
 */
export function stripEmoji(text: string | undefined | null): string {
	return (text ?? '')
		.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * Human-readable Arabic summary of a history entry's `changes` object.
 * Backend stores each change as [oldValue, newValue]. Returns one line per
 * changed field, e.g. "السعر: 90,000 ← 85,000".
 */
const CHANGE_LABELS: Record<string, string> = {
	price: 'السعر',
	packageSize: 'الحجم',
	returnOrder: 'استبدال',
	weight: 'الوزن',
	operatorNote: 'ملاحظة الموظفين',
	itemsNumber: 'عدد القطع',
	typeName: 'النوع',
	customerName: 'اسم الزبون',
	customerPhone: 'الهاتف',
	customerPhone2: 'هاتف إضافي',
	fullAddress: 'العنوان',
	notes: 'الملاحظات',
	cityName: 'المدينة',
	regionName: 'المنطقة',
	items: 'المنتجات'
};
// ID fields are covered by their name counterparts — skip to avoid noise.
const CHANGE_SKIP = new Set(['cityId', 'regionId']);

function changeVal(field: string, v: unknown): string {
	let s = v == null || v === 'null' || v === '' ? '—' : String(v);
	if (field === 'returnOrder') s = s === 'true' ? 'نعم' : s === 'false' ? 'لا' : s;
	if (field === 'price' || field === 'weight') {
		const n = Number(s);
		if (!Number.isNaN(n)) s = n.toLocaleString('en-US');
	}
	if (s.length > 40) s = s.slice(0, 40) + '…';
	return s;
}

/** An item line as the backend's items diff records it. */
type DiffItem = {
	sku?: string;
	name?: string | [string, string];
	quantity?: number | [number, number];
	unitPrice?: number | [number, number];
};
type ItemsDiff = {
	from?: number;
	to?: number;
	added?: DiffItem[];
	removed?: DiffItem[];
	changed?: DiffItem[];
};

const num = (v: unknown) => {
	const n = Number(v);
	return Number.isNaN(n) ? String(v ?? '—') : n.toLocaleString('en-US');
};

/** "13-1 — جوزه سمارت…" for one item line; the name is trimmed to stay one line. */
function itemTitle(it: DiffItem): string {
	const sku = String(it.sku ?? '').trim();
	const rawName = Array.isArray(it.name) ? it.name[1] : it.name;
	let name = String(rawName ?? '').trim();
	if (name.length > 28) name = name.slice(0, 28) + '…';
	if (sku && name && name !== sku) return `${sku} — ${name}`;
	return sku || name || '—';
}

/**
 * Lines for the structured items diff: what was added, what was removed, and
 * per-line quantity / price / name edits. The old format only counted rows, so
 * swapping one variant for another showed nothing at all.
 */
function formatItemsDiff(diff: ItemsDiff, label: string): string[] {
	const lines: string[] = [];
	const qty = (it: DiffItem) => (Array.isArray(it.quantity) ? it.quantity[1] : (it.quantity ?? 1));
	const price = (it: DiffItem) =>
		Array.isArray(it.unitPrice) ? it.unitPrice[1] : (it.unitPrice ?? 0);

	for (const it of diff.added ?? []) {
		lines.push(`${label}: أُضيف ${itemTitle(it)} ×${qty(it)} — ${num(price(it))}`);
	}
	for (const it of diff.removed ?? []) {
		lines.push(`${label}: حُذف ${itemTitle(it)} ×${qty(it)} — ${num(price(it))}`);
	}
	for (const it of diff.changed ?? []) {
		const title = itemTitle(it);
		if (Array.isArray(it.quantity)) {
			lines.push(`${label}: ${title} — الكمية: ${it.quantity[0]} ← ${it.quantity[1]}`);
		}
		if (Array.isArray(it.unitPrice)) {
			lines.push(
				`${label}: ${title} — السعر: ${num(it.unitPrice[0])} ← ${num(it.unitPrice[1])}`
			);
		}
		if (Array.isArray(it.name)) {
			lines.push(`${label}: ${title} — الاسم: ${it.name[0]} ← ${it.name[1]}`);
		}
	}
	const from = diff.from;
	const to = diff.to;
	if (typeof from === 'number' && typeof to === 'number' && from !== to) {
		lines.push(`${label}: عدد الأسطر: ${from} ← ${to}`);
	}
	return lines;
}

export function formatHistoryChanges(
	changes: Record<string, unknown> | null | undefined
): string[] {
	if (!changes || typeof changes !== 'object') return [];
	const lines: string[] = [];
	for (const [field, val] of Object.entries(changes)) {
		if (CHANGE_SKIP.has(field)) continue;
		const label = CHANGE_LABELS[field] ?? field;
		// Current items format: a structured diff of the lines themselves.
		if (field === 'items' && val && typeof val === 'object' && !Array.isArray(val)) {
			lines.push(...formatItemsDiff(val as ItemsDiff, label));
			continue;
		}
		// Legacy items format was ['updated', 'N items']; just say "عُدّلت".
		if (field === 'items' && Array.isArray(val) && val[0] === 'updated') {
			lines.push(`${label}: عُدّلت`);
			continue;
		}
		if (Array.isArray(val) && val.length === 2) {
			const oldD = changeVal(field, val[0]);
			const newD = changeVal(field, val[1]);
			if (oldD === newD) continue; // skip no-op (e.g. null → "")
			lines.push(`${label}: ${oldD} ← ${newD}`);
		} else {
			lines.push(`${label}: ${changeVal(field, val)}`);
		}
	}
	return lines;
}
