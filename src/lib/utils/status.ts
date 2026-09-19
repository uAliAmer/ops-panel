export type StatusClass =
	| 'pending'
	| 'processing'
	| 'packed'
	| 'completed'
	| 'success'
	| 'failed'
	| 'rejected';

const LABELS: Record<string, string> = {
	PENDING_REVIEW: 'بانتظار',
	PROCESSING: 'قيد المعالجة',
	APPROVED: 'تمت الموافقة',
	PACKED: 'مجهّز',
	COMPLETED_MANUAL: 'مكتمل يدوياً',
	SENT_TO_CARRIER: 'تم الإرسال',
	SUCCESS: 'تم',
	FAILED: 'فشل',
	REJECTED: 'مرفوض',
	CANCELLED: 'ملغى'
};

export function getStatusClass(s: string | undefined | null): StatusClass {
	if (s === 'PENDING_REVIEW') return 'pending';
	if (s === 'PROCESSING' || s === 'APPROVED') return 'processing';
	if (s === 'PACKED') return 'packed';
	if (s === 'COMPLETED_MANUAL') return 'completed';
	if (s === 'SENT_TO_CARRIER' || s === 'SUCCESS') return 'success';
	if (s === 'FAILED') return 'failed';
	if (s === 'REJECTED') return 'rejected';
	return 'pending';
}

export function getStatusLabel(s: string | undefined | null): string {
	if (!s) return '';
	return LABELS[s] ?? s;
}

/**
 * Orders still waiting on a physical decision — nothing has left the building yet,
 * so what is on the shelf still determines what happens next.
 *
 * Everything else (sent to the carrier, delivered, failed, rejected, cancelled,
 * fulfilled by hand) is history: its stock question was settled at the time. This
 * is what gates the automatic ERP stock check — a past order must not spend ERP
 * round trips answering a question nobody is asking.
 */
const FULFILLABLE_STATUSES = new Set([
	'PENDING_REVIEW',
	'PENDING',
	'PROCESSING',
	'APPROVED',
	'PACKED'
]);

export function isFulfillable(s: string | undefined | null): boolean {
	return !!s && FULFILLABLE_STATUSES.has(s);
}

const STATUS_COLORS: Record<StatusClass, string> = {
	pending: 'bg-amber-500',
	processing: 'bg-blue-500',
	packed: 'bg-violet-500',
	completed: 'bg-teal-500',
	success: 'bg-emerald-500',
	failed: 'bg-rose-500',
	rejected: 'bg-zinc-400'
};

const STATUS_BADGE_VARIANTS: Record<
	StatusClass,
	{ class: string; label: string }
> = {
	pending: { class: 'bg-amber-500/15 text-amber-700 border-amber-500/30', label: 'بانتظار' },
	processing: { class: 'bg-blue-500/15 text-blue-700 border-blue-500/30', label: 'قيد المعالجة' },
	packed: { class: 'bg-violet-500/15 text-violet-700 border-violet-500/30', label: 'مجهّز' },
	completed: { class: 'bg-teal-500/15 text-teal-700 border-teal-500/30', label: 'مكتمل يدوياً' },
	success: { class: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', label: 'تم' },
	failed: { class: 'bg-rose-500/15 text-rose-700 border-rose-500/30', label: 'فشل' },
	rejected: { class: 'bg-zinc-500/15 text-zinc-700 border-zinc-500/30', label: 'مرفوض' }
};

export function statusDotClass(s: string | undefined | null): string {
	return STATUS_COLORS[getStatusClass(s)];
}

export function statusBadgeProps(s: string | undefined | null) {
	const cls = getStatusClass(s);
	return { class: STATUS_BADGE_VARIANTS[cls].class, label: getStatusLabel(s) };
}
