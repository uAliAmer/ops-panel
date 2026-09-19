/**
 * Reminders are scheduled in Baghdad wall-clock time (UTC+3, fixed — Iraq has
 * had no DST since 2007), never the viewing device's own timezone. An
 * operator opening the ops panel from anywhere else must still get "9am" to
 * mean 9am in Baghdad, not 9am wherever their phone thinks it is.
 *
 * dueAt is stored/transmitted as a UTC ISO string throughout (backend, api.ts,
 * sockets) — only this module's picker-facing helpers know about the +3
 * offset, and only for turning a Baghdad y/m/d/h/m the operator picked into
 * that ISO instant, and back.
 */
const BAGHDAD_OFFSET_MIN = 3 * 60;

export type BaghdadParts = { y: number; m: number; d: number; hh: number; mm: number };

/** Baghdad wall-clock parts -> UTC ISO instant. Date.UTC normalizes overflow
 *  (day 32, hour 25, ...) so callers can add days/hours without carrying. */
export function baghdadPartsToIso(y: number, m: number, d: number, hh: number, mm: number): string {
	return new Date(Date.UTC(y, m - 1, d, hh, mm) - BAGHDAD_OFFSET_MIN * 60_000).toISOString();
}

/** UTC ISO instant -> the Baghdad wall-clock parts it represents. */
export function isoToBaghdadParts(iso: string): BaghdadParts {
	const t = new Date(new Date(iso).getTime() + BAGHDAD_OFFSET_MIN * 60_000);
	return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}

export function nowBaghdadParts(): BaghdadParts {
	return isoToBaghdadParts(new Date().toISOString());
}

const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS_AR = [
	'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
	'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'
];

/** "الثلاثاء ٨ أيلول · ٩:٠٠ ص" — always Baghdad time, regardless of viewer tz. */
export function formatBaghdad(iso: string): string {
	const { y, m, d, hh, mm } = isoToBaghdadParts(iso);
	const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	const period = hh < 12 ? 'ص' : 'م';
	const h12 = hh % 12 || 12;
	return `${WEEKDAYS_AR[dow]} ${arDigits(d)} ${MONTHS_AR[m - 1]} · ${arDigits(h12)}:${arDigits(String(mm).padStart(2, '0'))} ${period}`;
}

/** Short form for list rows: "٨ أيلول ٩:٠٠ ص" (no weekday). */
export function formatBaghdadShort(iso: string): string {
	const { d, m, hh, mm } = isoToBaghdadParts(iso);
	const period = hh < 12 ? 'ص' : 'م';
	const h12 = hh % 12 || 12;
	return `${arDigits(d)} ${MONTHS_AR[m - 1]} ${arDigits(h12)}:${arDigits(String(mm).padStart(2, '0'))} ${period}`;
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Western digits -> Arabic-Indic. The operator UI is Arabic throughout, and
 *  the preset labels were already written in Arabic-Indic, so every number the
 *  reminder UI renders goes through here to stop the two sets mixing. */
export function arDigits(s: string | number): string {
	return String(s).replace(/[0-9]/g, (d) => AR_DIGITS[+d]);
}

/** Arabic counts after بعد / متأخر, which take the accusative: one and two are
 *  carried by the noun itself (ساعة / ساعتين, no numeral), 3-10 take the
 *  plural, 11+ back to the singular. */
function arCount(n: number, [one, two, few, many]: [string, string, string, string]): string {
	if (n === 1) return one;
	if (n === 2) return two;
	if (n <= 10) return `${arDigits(n)} ${few}`;
	return `${arDigits(n)} ${many}`;
}

const MINUTES: [string, string, string, string] = ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'];
const HOURS: [string, string, string, string] = ['ساعة', 'ساعتين', 'ساعات', 'ساعة'];
const DAYS: [string, string, string, string] = ['يوم', 'يومين', 'أيام', 'يومًا'];

/** How far off the instant is, in words: "بعد ساعتين و٣٠ دقيقة", "متأخر ٥ دقائق".
 *  The picker shows this next to the absolute time so the operator can sanity
 *  check a date without doing the arithmetic themselves. */
export function formatRelative(iso: string, from: number = Date.now()): string {
	const diff = new Date(iso).getTime() - from;
	const late = diff < 0;
	const mins = Math.round(Math.abs(diff) / 60_000);
	const prefix = late ? 'متأخر' : 'بعد';
	if (mins < 1) return 'الآن';
	if (mins < 60) return `${prefix} ${arCount(mins, MINUTES)}`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) {
		const rem = mins % 60;
		return `${prefix} ${arCount(hours, HOURS)}${rem ? ` و${arCount(rem, MINUTES)}` : ''}`;
	}
	const days = Math.floor(hours / 24);
	const rem = hours % 24;
	if (days < 3 && rem) return `${prefix} ${arCount(days, DAYS)}${` و${arCount(rem, HOURS)}`}`;
	return `${prefix} ${arCount(days, DAYS)}`;
}

/** True when the instant has already passed — the one thing the picker must
 *  never let an operator save by accident. */
export function isPast(iso: string, from: number = Date.now()): boolean {
	return new Date(iso).getTime() <= from;
}
