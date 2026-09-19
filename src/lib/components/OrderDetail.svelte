<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { DEMO } from '$lib/config';
	import { orderSlug } from '$lib/utils/orderSlug';
	import { useRefresh } from '$lib/utils/refresh.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import {
		Phone,
		BellRing,
		ChevronDown,
		Building2,
		Store,
		User,
		MapPin,
		CircleDollarSign,
		Package,
		FileText,
		Hash,
		Link as LinkIcon,
		StickyNote,
		MessageCircleOff,
		CircleCheck,
		CircleX,
		Hourglass,
		Copy,
		Check,
		X,
		Edit3,
		Printer,
		Gift,
		Tag,
		Box,
		Truck,
		Wallet,
		ChevronRight,
		Share2,
		Loader2,
		AlertTriangle,
		Receipt,
		RefreshCw,
		Trash2,
		Warehouse,
		ArrowDown,
		ScanLine
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import PackingPanel from '$lib/components/PackingPanel.svelte';
	import OrderThread from '$lib/components/OrderThread.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import AnimatedNumber from '$lib/components/AnimatedNumber.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import {
		api,
		pathPrefix,
		PUBLIC_ORDER_ORIGIN,
		OPS_APP_BASE,
		type Order,
		type CityOrRegion,
		type ErpStockItem,
		type ErpStockSuggestion,
		type CustomerHistoryResponse,
		type Reminder
	} from '$lib/api';
	import { MessageSquarePlus, UserCheck, UserX, History, Pencil, Bell } from '@lucide/svelte';
	import ReminderComposer from '$lib/components/ReminderComposer.svelte';
	import ReminderRow from '$lib/components/ReminderRow.svelte';
	import { orderLabel } from '$lib/utils/orderSlug';
	import { isWholesaleOrder, orderSource } from '$lib/utils/source';
	import { customerTier, prevOrdersLabel } from '$lib/utils/customerTier';
	import { resolveImage } from '$lib/utils/image';
	import ImageViewer from '$lib/components/ImageViewer.svelte';
	import StickerScanner from '$lib/components/StickerScanner.svelte';
	import WhatsAppIcon from '$lib/components/WhatsAppIcon.svelte';

	let viewerSrc = $state<string | null>(null);
	// Screen rect of the thumbnail the operator tapped, so the viewer can grow
	// the photo out of it instead of fading a panel in over the top.
	let viewerOrigin = $state<DOMRect | null>(null);

	/** Open the photo, measuring whichever thumbnail sits inside the tapped row. */
	function openViewer(e: Event, src: string) {
		const host = e.currentTarget as HTMLElement | null;
		const thumb = host?.querySelector('img') ?? host;
		viewerOrigin = thumb?.getBoundingClientRect() ?? null;
		viewerSrc = src;
	}
	import { formatPrice, formatPieces, formatDateTime, formatCardDate, formatCheckedAt, formatStockRelative, formatDiscountLabel, displayNotes, displayOpNotes, formatHistoryChanges, stripEmoji, parseOpNotes, serializeOpNotes } from '$lib/utils/format';
	import { statusBadgeProps, getStatusLabel, isFulfillable } from '$lib/utils/status';
	import { whatsappHref } from '$lib/utils/phone';
	import { driverAvatar } from '$lib/utils/driverAvatar';
	import { isVagueRegion } from '$lib/utils/region';
	import { branchStyle, sortByBranch } from '$lib/utils/branch';
	import { erpAlertLabel } from '$lib/utils/erpAlert';
	import { copyText, haptic } from '$lib/utils/haptic';
	import { cn } from '$lib/utils';

	type ListTab = 'pending' | 'approved' | 'history';

	interface Props {
		orderId: string;
		/** 'page' = full-screen route (mobile / deep link); 'pane' = embedded in the desktop split. */
		mode?: 'page' | 'pane';
		/** Called in pane mode to close/clear the selection (e.g. after an action). */
		onClose?: () => void;
		/** Called whenever the order changes so the parent list can refresh. */
		onChanged?: () => void;
		/** Called when an action moved the order to another tab (pane mode: pulses it). */
		onMoved?: (tab: ListTab) => void;
		/** Jump the parent list to a tab (toast "عرض" action). */
		onGoToTab?: (tab: ListTab) => void;
	}
	let { orderId, mode = 'page', onClose, onChanged, onMoved, onGoToTab }: Props = $props();

	// Toast "عرض" action: in the desktop pane the parent switches tabs; in page
	// mode (mobile) persist the tab choice and navigate back to the list.
	function jumpTo(tab: ListTab) {
		if (onGoToTab) {
			onGoToTab(tab);
			return;
		}
		try {
			sessionStorage.setItem('opsActiveTab', tab);
		} catch {
			/* ignore */
		}
		void goto(`${base}/`);
	}

	// Which tab a status lands in — mirrors the list's tabForStatus.
	function tabForStatus(s: string): ListTab {
		if (s === 'PENDING_REVIEW' || s === 'FAILED') return 'pending';
		if (s === 'APPROVED' || s === 'PACKED') return 'approved';
		return 'history';
	}
	const TAB_LABELS: Record<ListTab, string> = {
		pending: 'بانتظار',
		approved: 'للتجهيز',
		history: 'سابقة'
	};

	let order = $state<Order | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let cities = $state<CityOrRegion[]>([]);

	let rejectOpen = $state(false);
	let rejectReason = $state('');
	let rejectInputEl = $state<HTMLTextAreaElement | null>(null);
	let submitting = $state(false);

	function toggleReject() {
		haptic(12);
		rejectOpen = !rejectOpen;
		if (rejectOpen) {
			tick().then(() => {
				rejectInputEl?.focus();
			});
		}
	}

	let editOpen = $state(false);
	let packOpen = $state(false);

	// Operator note dialog
	let noteOpen = $state(false);
	let noteDraft = $state('');
	let noteSaving = $state(false);
	let noteEditIndex = $state<number | null>(null); // null = append a new note

	const opNotes = $derived(parseOpNotes(order?.operatorNote));
	// Raw note text minus the legacy machine-written WhatsApp line — used for the
	// "has notes" highlight and the previous-notes preview, which both read the
	// blob directly rather than the parsed entries.
	const opNoteText = $derived(displayOpNotes(order?.operatorNote));

	function openNoteDialog() {
		noteEditIndex = null; // append mode — draft starts empty
		noteDraft = '';
		noteOpen = true;
	}

	function editNote(i: number) {
		noteEditIndex = i;
		noteDraft = opNotes[i]?.body ?? '';
		noteOpen = true;
	}

	async function persistNotes(combined: string, okMsg: string) {
		if (!order) return;
		const res = await api.addOperatorNote(order.id, combined);
		if (res.success && res.data) {
			order = { ...order, operatorNote: (res.data as Order).operatorNote };
		}
		toast.success(okMsg);
	}

	async function saveNote() {
		if (!order) return;
		noteSaving = true;
		try {
			const body = noteDraft.trim();
			if (noteEditIndex !== null) {
				// Edit an existing entry in place — keep its author/stamp.
				const notes = parseOpNotes(order.operatorNote);
				if (notes[noteEditIndex]) notes[noteEditIndex].body = body;
				const filtered = notes.filter((n) => n.body.trim());
				await persistNotes(serializeOpNotes(filtered), 'تم تعديل الملاحظة');
			} else {
				// Append a new entry: name + Baghdad timestamp header.
				const user = auth.user;
				const stamp = new Date().toLocaleString('en-GB', {
					timeZone: 'Asia/Baghdad',
					day: '2-digit', month: '2-digit', year: 'numeric',
					hour: '2-digit', minute: '2-digit', hour12: true
				});
				const prefix = user ? `${user.name} (${stamp}):\n` : '';
				const existing = order.operatorNote ?? '';
				const separator = existing ? '\n\n' : '';
				const combined = body ? `${existing}${separator}${prefix}${body}` : existing;
				await persistNotes(combined, 'تم حفظ الملاحظة');
			}
			noteOpen = false;
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			noteSaving = false;
		}
	}

	async function deleteNote(i: number) {
		if (!order) return;
		const notes = parseOpNotes(order.operatorNote);
		notes.splice(i, 1);
		try {
			await persistNotes(serializeOpNotes(notes), 'تم حذف الملاحظة');
		} catch (err) {
			toast.error((err as Error).message);
		}
	}

	// Manual carrier tracking-status override (ADMIN). Values match the tracking
	// page step titles exactly so the customer stepper advances to the right stage.
	const TRACK_OVERRIDE_PRESETS = [
		'قيد المعالجة والتجهيز',
		'بانتظار استلام شركة الشحن',
		'التوجه الى المحافظة',
		'في مكتب المحافظة',
		'جاري استلام من قبل مندوب التوصيل',
		'بانتظار التسليم',
		'تم التسليم بنجاح'
	];
	let trackOverrideOpen = $state(false);
	let trackOverrideDraft = $state('');
	let trackOverrideSaving = $state(false);

	function openTrackOverride() {
		trackOverrideDraft = order?.shipment?.trackingStatusOverride ?? '';
		trackOverrideOpen = true;
	}

	async function saveTrackOverride(value: string | null) {
		if (!order) return;
		trackOverrideSaving = true;
		try {
			const res = await api.setTrackingOverride(order.id, value);
			if (res.success) {
				const next = value && value.trim() ? value.trim() : null;
				order = { ...order, shipment: { ...order.shipment, trackingStatusOverride: next } };
				toast.success(next ? 'تم تعيين حالة التتبع' : 'تم إلغاء التعيين اليدوي');
				trackOverrideOpen = false;
			} else {
				toast.error(res.error || 'تعذّر الحفظ');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			trackOverrideSaving = false;
		}
	}

	const isAdmin = $derived(auth.user?.role === 'ADMIN');

	// After an action: in page mode return to the list; in pane mode tell the
	// parent to refresh and clear the selection.
	function finishAction() {
		onChanged?.();
		if (mode === 'page') void goto(`${base}/`);
		else onClose?.();
	}

	// ADMIN-only manual status override — safe subset only.
	const MANUAL_STATUSES = ['PENDING_REVIEW', 'CANCELLED', 'FAILED', 'SUCCESS', 'COMPLETED_MANUAL'];
	let statusOpen = $state(false);
	let statusSaving = $state(false);

	// Hard delete (ADMIN, from the status dialog). Type-to-confirm gate.
	const DELETE_WORD = 'تأكيد';
	let deleteOpen = $state(false);
	let deleteWordInput = $state('');
	let deleting = $state(false);

	async function doDelete() {
		if (!order || deleteWordInput.trim() !== DELETE_WORD) return;
		deleting = true;
		const t = toast.loading('جاري الحذف…');
		try {
			await api.deleteOrder(order.id);
			toast.success('تم حذف الطلب نهائياً', { id: t });
			deleteOpen = false;
			onChanged?.();
			if (mode === 'page') void goto(`${base}/`);
			else onClose?.();
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			deleting = false;
		}
	}

	async function doSetStatus(target: string) {
		if (!order || target === order.status) {
			statusOpen = false;
			return;
		}
		statusSaving = true;
		const t = toast.loading('جاري تغيير الحالة…');
		try {
			const res = await api.setStatus(order.id, target);
			if (res.success && res.data) {
				order = { ...order, status: (res.data as Order).status };
			}
			const destTab = tabForStatus(target);
			// Skip the destination suffix when it would just repeat the status
			// label (e.g. «بانتظار» → tab «بانتظار»).
			const statusLabel = getStatusLabel(target);
			const suffix = TAB_LABELS[destTab] === statusLabel ? '' : ` — الطلب الآن في «${TAB_LABELS[destTab]}»`;
			toast.success(`تم تغيير الحالة إلى «${statusLabel}»${suffix}`, {
				id: t,
				action: { label: 'عرض', onClick: () => jumpTo(destTab) }
			});
			onMoved?.(destTab);
			onChanged?.();
			statusOpen = false;
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			statusSaving = false;
		}
	}

	// Only worth flagging while the order can still be fixed — once it is at the
	// carrier the region is already baked into the shipment.
	const vagueRegion = $derived(
		isVagueRegion(order?.regionName) && !order?.shipment?.trackingNumber
	);

	const contactNumbers = $derived(
		[order?.customerPhone, order?.customerPhone2].filter((p): p is string => Boolean(p))
	);

	const isPending = $derived(order?.status === 'PENDING_REVIEW' || order?.status === 'FAILED');
	const hasTracking = $derived(Boolean(order?.shipment?.trackingNumber));

	// Preprinted-sticker orders (printerless branches) can be re-linked to a fresh
	// sticker when the original label is damaged or the order was cancelled by
	// mistake — see doRelink / the relink dialog.
	const printerless = $derived(auth.user?.printerless === true);
	const isStickerOrder = $derived(order?.shipment?.carrierMethod === 'APP_STICKER');
	// Own-driver (LOCAL) delivery — operator-driven stages, no Alwaseet.
	const isLocalOrder = $derived(order?.shipment?.carrierMethod === 'LOCAL');
	const localDelivered = $derived(order?.status === 'SUCCESS');
	// LOCAL return/replacement: the old item comes back to us. Tracked with a
	// separate manual flag, independent of delivery/money.
	const returnReceived = $derived(Boolean(order?.shipment?.returnReceivedAt));
	let returnBusy = $state(false);
	let localBusy = $state(false);
	// The driver's running balance owed (fetched for a LOCAL order). `driverOwed`
	// is everything they hold; `driverSettleable` is the delivered slice — the
	// only part a settle actually clears, so it is the figure the dialog quotes.
	let driverOwed = $state<number | null>(null);
	let driverSettleable = $state(0);
	let driverSettleableCount = $state(0);
	// What stays with the driver after settling THIS order.
	const driverPending = $derived(Math.max(0, (driverOwed ?? 0) - driverSettleable));
	let settling = $state(false);
	// This screen settles THIS order only — the operator is looking at one parcel
	// and one amount. A settle that reached across the driver's whole book from
	// here is what let a 40,000 balance be "settled" for 0 (see driverBalances on
	// the server). The drivers sheet is where a multi-order settlement is picked.
	const orderSettled = $derived(Boolean(order?.shipment?.settledAt));
	const canSettleOrder = $derived(
		isLocalOrder &&
			!orderSettled &&
			Boolean(order?.shipment?.id) &&
			Boolean(order?.shipment?.localDriverId) &&
			(order?.status === 'SUCCESS' || order?.status === 'SENT_TO_CARRIER') &&
			order?.shipment?.carrierClass !== 'RETURNING'
	);

	$effect(() => {
		const driverId = order?.shipment?.localDriverId;
		if (!isLocalOrder || !driverId) {
			driverOwed = null;
			driverSettleable = 0;
			driverSettleableCount = 0;
			return;
		}
		api.listLocalDrivers()
			.then((res) => {
				if (!res.success) return;
				const d = res.data?.find((x) => x.id === driverId);
				driverOwed = d?.outstanding ?? null;
				driverSettleable = d?.settleable ?? 0;
				driverSettleableCount = d?.settleableCount ?? 0;
			})
			.catch(() => {});
	});

	// Settling hands cash back across EVERY unsettled order the driver holds, not
	// just this one, and it is not undone by tapping again — so it asks first, with
	// the figure it is about to close on screen.
	let settleConfirmOpen = $state(false);

	// "Come to the shop." The operator has the driver's name in front of them here
	// as often as anywhere else, and chasing them is a phone call otherwise.
	let paging = $state(false);
	// Third-party image on a shop's network — fall back to the badge if it fails.
	let driverAvatarBroken = $state(false);
	async function pageDriver() {
		const driverId = order?.shipment?.localDriverId;
		if (!driverId || paging) return;
		paging = true;
		haptic(12);
		const t = toast.loading('جاري الاستدعاء…');
		try {
			const res = await api.pageDriver(driverId);
			if (res.success) toast.success(res.message || 'تم الاستدعاء', { id: t });
			else toast.error(res.error || 'تعذّر الاستدعاء', { id: t });
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			paging = false;
		}
	}

	async function settleDriver() {
		const driverId = order?.shipment?.localDriverId;
		const shipmentId = order?.shipment?.id;
		if (!driverId || !shipmentId || settling || !canSettleOrder) return;
		settleConfirmOpen = false;
		settling = true;
		const t = toast.loading('جاري تسوية الحساب…');
		try {
			// One order, by id. Still out for delivery? The server marks it
			// delivered as part of the settlement — cash back IS the delivery.
			const res = await api.settleDriver(driverId, [shipmentId]);
			if (res.success) {
				const total = res.data?.total ?? 0;
				const remaining = res.data?.remaining ?? 0;
				const delivered = (res.data?.autoDeliveredIds ?? []).length > 0;
				toast.success(
					`تمت تسوية الطلب — ${total.toLocaleString()} د.ع` +
						(delivered ? ' · عُلِّم مُسلَّماً' : '') +
						(remaining ? ` · بذمة المندوب ${remaining.toLocaleString()} د.ع` : ''),
					{ id: t }
				);
				// Trust what the server actually cleared, not an assumed zero.
				driverOwed = remaining;
				driverSettleable = 0;
				driverSettleableCount = 0;
				haptic(15);
				onChanged?.(); // the order is now delivered and settled — reload it
			} else {
				toast.error(res.error ?? 'فشلت التسوية', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			settling = false;
		}
	}

	async function toggleReturnReceived() {
		if (!order || returnBusy) return;
		returnBusy = true;
		const next = !returnReceived;
		const t = toast.loading('جاري التحديث…');
		try {
			const res = await api.setReturnReceived(order.id, next);
			if (res.success) {
				toast.success(next ? 'تم استلام الراجع' : 'تم التراجع', { id: t });
				haptic(12);
				onChanged?.();
			} else {
				toast.error(res.error ?? 'تعذّر التحديث', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			returnBusy = false;
		}
	}

	// The own-driver card asks one question at a time: where is this parcel now,
	// and what is the single next thing to do with it. The other stages are still
	// reachable, folded away, because they are corrections rather than the path.
	const LOCAL_FLOW: Record<
		string,
		{ tone: string; next?: { key: 'OUT' | 'DELIVERED'; label: string } }
	> = {
		'تم الاستلام من قبل المندوب': {
			tone: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200 ring-cyan-500/30',
			next: { key: 'OUT', label: 'خرج للتوصيل' }
		},
		'خرج للتوصيل': {
			tone: 'bg-sky-500/15 text-sky-800 dark:text-sky-200 ring-sky-500/30',
			next: { key: 'DELIVERED', label: 'تم التسليم للزبون' }
		},
		'تعذّر التسليم': {
			tone: 'bg-amber-500/15 text-amber-800 dark:text-amber-200 ring-amber-500/30',
			next: { key: 'OUT', label: 'إعادة المحاولة' }
		},
		// Both spellings: orders delivered before the rename still carry the short one.
		'تم التسليم للزبون': { tone: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-500/30' },
		'تم التسليم': { tone: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 ring-emerald-500/30' },
		'راجع للتاجر': { tone: 'bg-rose-500/15 text-rose-800 dark:text-rose-200 ring-rose-500/30' }
	};
	const localStageName = $derived(order?.shipment?.alwaseetStatusName || '');
	const localFlow = $derived(
		LOCAL_FLOW[localStageName] ?? { tone: 'bg-muted text-foreground ring-border' }
	);
	// This order's own money, which is not the same question as the driver's
	// balance: the fee is theirs to keep, the rest comes back to us.
	const localFee = $derived(Number(order?.shipment?.localDeliveryFee) || 0);
	const localNet = $derived(Math.max(0, (Number(order?.price) || 0) - localFee));

	// What the lines themselves add up to. The order total is entered separately
	// (it carries delivery, or a hand-set price), so the two can legitimately
	// differ — the gap is shown rather than hidden, because an unexplained one is
	// exactly what the operator needs to catch before the ERP invoice.
	const itemsSubtotal = $derived(
		(order?.items ?? []).reduce(
			(sum, it) => sum + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 1),
			0
		)
	);
	const discountSaved = $derived(Math.round(Number(order?.discountAmount) || 0));
	const itemsGap = $derived(Math.round((Number(order?.price) || 0) - itemsSubtotal));
	// What the gap is once the storefront's discount is accounted for — delivery,
	// or a hand-edited total. Zero for the ordinary order, and only then silent.
	const itemsResidual = $derived(itemsGap + discountSaved);
	/** Stages other than the obvious next one — corrections, folded by default. */
	const localOtherStages = $derived(
		(
			[
				{ key: 'OUT', label: 'خرج للتوصيل' },
				{ key: 'DELIVERED', label: 'تم التسليم للزبون' },
				{ key: 'FAILED', label: 'تعذّر التسليم' },
				{ key: 'RETURNED', label: 'راجع للتاجر' }
			] as const
		).filter((st) => st.key !== localFlow.next?.key)
	);
	let localMoreOpen = $state(false);

	async function doLocalStatus(status: 'OUT' | 'DELIVERED' | 'FAILED' | 'RETURNED') {
		if (!order || localBusy) return;
		localBusy = true;
		const t = toast.loading('جاري تحديث الحالة…');
		try {
			const res = await api.localStatus(order.id, status);
			if (res.success) {
				toast.success(res.message || 'تم تحديث الحالة', { id: t });
				haptic(12);
				onChanged?.();
			} else {
				toast.error(res.error ?? 'فشل التحديث', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			localBusy = false;
		}
	}
	const canRelink = $derived(printerless && isStickerOrder && hasTracking);
	let relinkOpen = $state(false);
	let relinkId = $state('');
	let relinking = $state(false);
	// Live state of the CURRENT bound order — checked when the dialog opens so the
	// operator sees whether the old label is still an active order before replacing.
	let oldCheck = $state<{ loading: boolean; active?: boolean; found?: boolean; status?: string | null }>({ loading: false });

	async function openRelink() {
		relinkId = '';
		oldCheck = { loading: true };
		relinkOpen = true;
		if (!order) return;
		try {
			const res = await api.stickerLiveStatus(order.id);
			oldCheck = res.success
				? { loading: false, active: res.active, found: res.found, status: res.status }
				: { loading: false };
		} catch {
			oldCheck = { loading: false };
		}
	}

	async function doRelink() {
		if (!order || !relinkId) return;
		relinking = true;
		const t = toast.loading('جاري الربط بالملصق الجديد…');
		try {
			const res = await api.relinkSticker(order.id, relinkId);
			if (res.success) {
				toast.success(res.message || `تم الربط — تتبع: ${res.trackingNumber}`, { id: t });
				relinkOpen = false;
				relinkId = '';
				onChanged?.();
			} else {
				toast.error(res.error ?? 'فشل الربط', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			relinking = false;
		}
	}

	// Has the carrier already received the parcel (picked up)? From then on a
	// carrier delete no longer works — cancelling becomes local-only. Read straight
	// from the fields the poller already saves each cycle (status id / pickedUpAt)
	// — no per-open API call. status_id 2 = تم الاستلام من قبل المندوب.
	const carrierReceived = $derived.by(() => {
		const s = order?.shipment;
		if (!s || s.carrierArchivedAt) return false;
		// LOCAL delivery never involves Alwaseet, but it stamps pickedUpAt at
		// assignment like a carrier pickup would.
		if (s.carrierMethod === 'LOCAL') return false;
		if (s.pickedUpAt) return true;
		const id = parseInt(String(s.alwaseetStatusId ?? ''), 10);
		if (!Number.isNaN(id) && id >= 2) return true;
		return ['DELIVERED', 'RETURNING', 'ATTENTION'].includes(s.carrierClass ?? '');
	});

	// Delete this order at Alwaseet only (works for OFFICIAL + app/sticker, since
	// an official order lands in the same app account). Leaves the local status
	// untouched — a pure carrier-side pull, distinct from local cancel.
	const canCarrierCancel = $derived(
		hasTracking &&
			Boolean(order?.shipment?.alwaseetOrderId) &&
			!order?.shipment?.carrierArchivedAt &&
			!carrierReceived
	);
	let carrierCancelOpen = $state(false);
	let carrierCancelling = $state(false);

	async function doCarrierCancel() {
		if (!order) return;
		carrierCancelling = true;
		const t = toast.loading('جاري الحذف من الوسيط…');
		try {
			const res = await api.carrierCancel(order.id);
			if (res.success) {
				toast.success(res.message || 'تم حذف الطلب من الوسيط', { id: t });
				carrierCancelOpen = false;
				// Reflect the retirement immediately so the button hides without a reload.
				if (order.shipment) {
					order = {
						...order,
						shipment: { ...order.shipment, carrierArchivedAt: new Date().toISOString() }
					};
				}
				onChanged?.();
			} else {
				toast.error(res.error ?? 'فشل الحذف من الوسيط', { id: t });
			}
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			carrierCancelling = false;
		}
	}

	// Returns and replacements are one queue: both leave here as Alwaseet's
	// single `replacement=1` flag, whatever we called them on the way in.
	const isReturn = $derived(Boolean(order?.returnOrder || order?.replacement));
	const carrierNow = $derived(order?.shipment?.alwaseetStatusName ?? null);
	const carrierEvents = $derived(order?.shipment?.carrierEvents ?? []);
	// An operator has closed the book on this return. Needed because Alwaseet
	// archives old orders and answers [] for them forever, so for some returns
	// the carrier never reports the parcel back even once it is on our shelf.
	// A LOCAL return has no carrier to report the item back — the op confirms it by
	// hand (returnReceivedAt). A carrier return closes on the order's own status.
	const returnClosed = $derived(
		isLocalOrder
			? returnReceived
			: ['SUCCESS', 'COMPLETED_MANUAL', 'REJECTED', 'CANCELLED'].includes(String(order?.status))
	);
	// Back in our hands, or written off. Either way nobody needs to chase it,
	// so the blink stops — a signal that never turns off is not a signal.
	const carrierSettled = $derived(
		returnClosed ||
			order?.shipment?.carrierClass === 'DELIVERED' ||
			(order?.shipment?.alwaseetStatusId != null &&
				['15', '17', '12', '13'].includes(String(order.shipment.alwaseetStatusId)))
	);
	const carrierToneClass = $derived(
		order?.shipment?.carrierClass === 'ATTENTION'
			? 'border-red-500 bg-red-500/15 text-red-600 dark:text-red-400'
			: order?.shipment?.carrierClass === 'DELIVERED'
				? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
				: 'border-orange-500 bg-orange-500/15 text-orange-600 dark:text-orange-400'
	);

	// How old the order is decides how urgent it is, so the age leads and the
	// exact timestamp follows it. Same helper the card uses — one relative-day
	// rule for both screens.
	// Past a week the helper switches to a short date ("29 July"), which the
	// exact timestamp beside it already says — so keep counting days instead.
	const createdAge = $derived.by(() => {
		if (!order?.createdAt) return '';
		const rel = formatCardDate(order.createdAt).relDay;
		const days = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 86_400_000);
		if (days <= 6) return rel;
		return days <= 10 ? `منذ ${days} أيام` : `منذ ${days} يوماً`;
	});

	// Background ERP invoice job progress
	const erpStatus = $derived(order?.erpInvoiceStatus ?? null);
	const erpUrl = $derived(order?.erpInvoiceUrl || order?.shipment?.erpInvoiceUrl || null);

	async function retryErp() {
		if (!order) return;
		const t = toast.loading('إعادة جدولة الفاتورة…');
		try {
			await api.erpRetry(order.id);
			order = { ...order, erpInvoiceStatus: 'QUEUED', erpInvoiceUrl: null };
			toast.success('تمت إعادة جدولة إنشاء الفاتورة', { id: t });
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		}
	}
	// Manual customer confirmation: the customer confirmed out-of-band (phone
	// call, plain WhatsApp reply). Marking it stops the retry worker from
	// resending the confirmation message.
	let confirmCustomerOpen = $state(false);
	let confirmingCustomer = $state(false);

	// null = unchecked → assume it has WhatsApp (same convention as the card).
	const hasWhatsapp = $derived(
		Boolean(order?.customerPhone && order.customerPhoneHasWa !== false) ||
		Boolean(order?.customerPhone2 && order.customerPhone2HasWa !== false)
	);

	// A dropship order's customer belongs to the reseller and hears nothing from
	// us — no confirmation, no tracking, no acknowledgement. The backend refuses
	// these sends outright (409), so the buttons are hidden rather than left to
	// fail: an action that cannot succeed should not be offered.
	const noCustomerContact = $derived(Boolean(order?.suppressCustomerContact));

	/**
	 * A dropship order's two figures are not on the same ledger, so they must not
	 * be subtracted from each other.
	 *
	 * Genelog sends the line prices at OUR wholesale rate — they exist to raise
	 * the ERP invoice against the reseller (checkout_service.py: item prices feed
	 * the invoice XLSX and nothing else). The order total is `amount_to_collect`:
	 * the reseller's own retail price plus their delivery charge, which is what
	 * the driver takes from THEIR customer at the door. The gap between the two
	 * is the reseller's margin, not our delivery, and calling it "توصيل / فرق"
	 * tells an operator something false about money that is not ours.
	 *
	 * A wholesale restock is the opposite case and keeps the ordinary treatment:
	 * the recipient IS the wholesaler, the lines are what they owe us, and the
	 * difference really is the delivery.
	 */
	const splitLedger = $derived(noCustomerContact);
	/** Prepaid — from the reseller's balance, or online by their customer. The
	 *  driver collects nothing, and a bare 0 reads as a missing price. */
	const noCollection = $derived((Number(order?.price) || 0) === 0 && itemsSubtotal > 0);
	// The wholesaler's own restock: ships to THEM, so unlike dropship there is
	// no contact suppression to key on. Purple where dropship is gold.
	const isWholesale = $derived(order ? isWholesaleOrder(order) : false);
	// Tap-to-open for the "لا تتصل" explainer. Hover handles a desk with no
	// delay and no state; touch has no hover, and that is where the operators are.
	let noCallOpen = $state(false);

	// Nothing to mark when the confirmation flow can't run at all: with no
	// WhatsApp number no message was ever sent, so there is no resend to stop.
	// Orders that already have a confirmation state keep the action (to correct it).
	const canMarkConfirmed = $derived(
		Boolean(order) &&
		!noCustomerContact &&
		order?.customerConfirmation !== 'CONFIRMED' &&
		(Boolean(order?.customerConfirmation) || hasWhatsapp)
	);

	// --- What this customer ordered before -----------------------------------
	// Loaded per order and rendered collapsed: it is context, not the order, and
	// must not push the order's own details down the screen.
	let custHistory = $state<CustomerHistoryResponse | null>(null);
	let historyOpen = $state(false);
	let historyLoadedFor = '';

	async function loadCustomerHistory(id: string) {
		try {
			const res = await api.customerHistory(id);
			custHistory = res.success ? res : null;
		} catch {
			custHistory = null; // context only — a failure must not disturb the order
		}
	}

	$effect(() => {
		const id = order?.id;
		if (!id || id === historyLoadedFor) return;
		historyLoadedFor = id;
		custHistory = null;
		historyOpen = false;
		void loadCustomerHistory(id);
	});

	// Resending needs a WhatsApp number to send to. Offered whatever the current
	// answer is: the common case is an edit AFTER the customer already replied,
	// and that reply is exactly what is now out of date.
	const canResendConfirmation = $derived(
		Boolean(order) && !noCustomerContact && (hasWhatsapp || Boolean(order?.customerConfirmation))
	);
	let resendConfirmOpen = $state(false);
	let resendingConfirmation = $state(false);

	async function resendConfirmation() {
		if (!order) return;
		resendingConfirmation = true;
		try {
			const res = await api.resendConfirmation(order.id);
			if (res.success) {
				toast.success('تم إرسال رسالة التأكيد بالتفاصيل الجديدة');
				// The customer is being asked again, so the order is awaiting a reply
				// regardless of what it said before.
				order = { ...order, customerConfirmation: 'PENDING' };
				await loadOrder();
			} else {
				toast.error(res.error ?? 'تعذر إرسال رسالة التأكيد');
			}
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			resendingConfirmation = false;
			resendConfirmOpen = false;
		}
	}

	async function markCustomerConfirmed() {
		if (!order) return;
		confirmingCustomer = true;
		const t = toast.loading('جاري تسجيل التأكيد…');
		try {
			await api.confirmCustomer(order.id);
			order = {
				...order,
				customerConfirmation: 'CONFIRMED',
				confirmationRespondedAt: new Date().toISOString()
			};
			toast.success('تم تسجيل تأكيد الزبون — لن تُرسل رسالة التأكيد مجدداً', { id: t });
			confirmCustomerOpen = false;
			onChanged?.();
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			confirmingCustomer = false;
		}
	}

	// Packing is the gate before carrier/ERP: available once approved (or packed
	// but not yet sent). Hidden once a carrier order exists.
	const canPack = $derived(
		!!order &&
			(order.status === 'APPROVED' || order.status === 'PACKED') &&
			!hasTracking &&
			(order.items?.length ?? 0) > 0
	);
	// No items → nothing to pack, but the order still needs fulfillment.
	// Opens the same confirm dialog packing ends with (carrier / ERP choice).
	const canSendNoItems = $derived(
		!!order &&
			(order.status === 'APPROVED' || order.status === 'PACKED') &&
			!hasTracking &&
			(order.items?.length ?? 0) === 0
	);
	let packConfirmDirect = $state(false);

	// Cancel: pre-carrier (APPROVED/PACKED) or a late customer cancel on a SENT
	// order — the latter also deletes it at Alwaseet.
	const canCancel = $derived(
		!!order && ['APPROVED', 'PACKED', 'SENT_TO_CARRIER'].includes(order.status)
	);
	// A sent order still at the carrier (not yet received) → the cancel reaches it.
	const cancelHitsCarrier = $derived(
		order?.status === 'SENT_TO_CARRIER' && hasTracking && !carrierReceived
	);
	// Common cancellation reasons — one tap fills the box (Iraqi ops vocabulary).
	const CANCEL_REASONS = [
		'الزبون ألغى الطلب',
		'الزبون لا يرد',
		'تغيّر رأي الزبون',
		'رقم غير صحيح',
		'العنوان غير صحيح',
		'طلب مكرر',
		'السعر غالي',
		'المنتج غير متوفر'
	];
	let cancelOpen = $state(false);
	let cancelReason = $state('');
	let cancelSaving = $state(false);
	let cancelInvoiceToo = $state(true);
	// Nothing to offer cancelling when no invoice is actually live in the ERP —
	// same status set the ERP progress strip below already understands.
	const hasCancellableInvoice = $derived(
		['SETTLED', 'SUCCESS', 'UNSETTLED', 'PARTIAL'].includes(order?.erpInvoiceStatus ?? '')
	);

	function openCancel() {
		cancelReason = '';
		cancelInvoiceToo = true;
		cancelOpen = true;
		haptic(12);
	}

	async function doCancel() {
		if (!order) return;
		cancelSaving = true;
		const t = toast.loading('جاري الإلغاء…');
		try {
			const res = await api.cancel(order.id, cancelReason.trim(), hasCancellableInvoice && cancelInvoiceToo);
			// The local order always cancels; the carrier delete may not have (the
			// carrier already received the parcel) — surface that as a warning.
			const c = res.carrier;
			const inv = res.invoice;
			if (c?.attempted && !c.deleted) {
				toast.warning(
					'أُلغي محلياً — لكن الوسيط استلم الطلب، احذفه يدوياً من تطبيق الوسيط',
					{ id: t, duration: 9000, action: { label: 'عرض', onClick: () => jumpTo('history') } }
				);
			} else if (inv?.attempted && !inv.cancelled) {
				toast.warning(
					`تم إلغاء الطلب — لكن تعذّر إلغاء فاتورة الـERP (${inv.reason ?? 'خطأ غير معروف'})`,
					{ id: t, duration: 9000, action: { label: 'عرض', onClick: () => jumpTo('history') } }
				);
			} else {
				toast.success(
					c?.deleted
						? 'تم إلغاء الطلب وحذفه من الوسيط'
						: inv?.cancelled
							? 'تم إلغاء الطلب وفاتورة الـERP'
							: 'تم إلغاء الطلب — انتقل إلى «سابقة»',
					{ id: t, action: { label: 'عرض', onClick: () => jumpTo('history') } }
				);
			}
			cancelOpen = false;
			onMoved?.('history');
			finishAction();
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			cancelSaving = false;
		}
	}
	const badge = $derived(statusBadgeProps(order?.status));
	// The header carries identity now — one bar instead of a title pill plus a
	// second strip repeating it — so these are resolved here rather than as
	// {@const}s inside the row that used to hold them.
	const source = $derived(order ? orderSource(order) : null);
	const tier = $derived(order ? customerTier(order) : null);
	const orderRef = $derived(order ? orderLabel(order) : '');

	// An unsettled or empty ERP invoice lives far down the order, well past the
	// fold on a phone — so a banner rides at the top and scrolls to it. Pointing
	// at the problem beats hoping the operator scrolls.
	let erpStripEl = $state<HTMLElement | null>(null);
	const erpAttention = $derived(erpAlertLabel(order?.erpInvoiceStatus));

	function jumpToErpStrip() {
		erpStripEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	async function loadOrder() {
		if (!auth.isAuthenticated || !orderId) return;
		loading = true;
		loadError = null;
		try {
			const res = await api.getOrder(orderId);
			if (res.success && res.data) order = res.data;
			else loadError = res.error ?? 'تعذر تحميل الطلب';
		} catch (err) {
			loadError = (err as Error).message;
		} finally {
			loading = false;
		}
	}

	// Reminders scheduled for this order — shown to every operator who opens it,
	// not just whoever created them (see routes/reminders.js). Loaded once per
	// order; composer/row actions update the local list directly afterwards.
	let orderReminders = $state<Reminder[]>([]);
	let remindComposing = $state(false);
	async function loadOrderReminders() {
		// order.id is the real DB uuid; orderId (the route param) can be a
		// short slug/idempotency key instead — see getOrder's slug resolution.
		if (!order?.id) return;
		try {
			const res = await api.listReminders({ submissionId: order.id });
			if (res.success && res.data) orderReminders = res.data;
		} catch {
			/* best-effort */
		}
	}

	async function loadCities() {
		try {
			const res = await api.getCities();
			cities = res.data ?? [];
		} catch {
			cities = [];
		}
	}

	// --- Live ERP stock per warehouse ------------------------------------------
	// Read on demand from the Gini ERP (one round trip per product), so it is
	// deliberately NOT part of loadOrder: a slow or down ERP must never delay or
	// break the order screen. Loads once per order, refreshable by hand.
	let stock = $state<Record<string, ErpStockItem>>({});
	let stockBranches = $state<string[]>([]);
	let stockSuggestion = $state<ErpStockSuggestion | null>(null);
	let stockLoading = $state(false);
	let stockError = $state<string | null>(null);
	let stockCheckedAt = $state<string | null>(null);
	let stockLoadedFor = '';

	async function loadStock(fresh = false) {
		if (!order || stockLoading) return;
		stockLoading = true;
		stockError = null;
		try {
			const res = await api.erpStock(order.id, fresh);
			const next: Record<string, ErpStockItem> = {};
			for (const item of res.items ?? []) next[item.sku] = item;
			stock = next;
			stockBranches = res.branches ?? [];
			stockSuggestion = res.suggestion ?? null;
			stockCheckedAt = res.checkedAt ?? null;
		} catch (err) {
			stockError = (err as Error).message;
		} finally {
			stockLoading = false;
		}
	}

	// Auto-check only where the answer can still change a decision: new orders and
	// orders being packed. A past order (sent, delivered, cancelled, rejected)
	// opens without touching the ERP — the operator can still press the button,
	// which says so.
	const stockAuto = $derived(isFulfillable(order?.status));

	$effect(() => {
		const id = order?.id;
		if (!id || id === stockLoadedFor) return;
		if (!(order?.items?.length ?? 0)) return;
		stockLoadedFor = id;
		stock = {};
		stockBranches = [];
		stockSuggestion = null;
		stockError = null;
		stockCheckedAt = null;
		if (stockAuto) void loadStock(false);
	});

	// Per-number WhatsApp existence. true/false = checked; null = unknown (check
	// failed or unavailable) → render WhatsApp neutrally without a negative state.
	let waStatus = $state<Record<string, boolean | null>>({});
	let waCheckedKey = '';

	// Legacy backfill: orders created before ingest-time checking have null
	// flags. Resolve + PERSIST once via the order endpoint, then mirror the
	// stored result locally so the next open reads it straight from the order.
	async function backfillWhatsapp(o: Order) {
		try {
			const res = await api.recheckWhatsapp(o.id);
			if (!res.enabled) return; // checking unavailable — keep neutral
			const next = { ...waStatus };
			if (o.customerPhone) next[o.customerPhone] = res.customerPhoneHasWa;
			if (o.customerPhone2) next[o.customerPhone2] = res.customerPhone2HasWa;
			waStatus = next;
			// keep the in-memory order in sync so a background reload won't re-trigger
			order = { ...o, customerPhoneHasWa: res.customerPhoneHasWa, customerPhone2HasWa: res.customerPhone2HasWa };
		} catch {
			/* leave neutral */
		}
	}

	// Prefer the per-number flags stored at ingest; only hit the backfill
	// endpoint when a number is still unknown (null). Runs once per number set.
	$effect(() => {
		if (!order) return;
		// Never look up a number we are not allowed to message. The backend
		// refuses this too; skipping here means opening a dropship order makes no
		// request about the reseller's customer at all.
		if (order.suppressCustomerContact) return;
		const entries: Array<[string, boolean | null]> = [];
		if (order.customerPhone) entries.push([order.customerPhone, order.customerPhoneHasWa ?? null]);
		if (order.customerPhone2)
			entries.push([order.customerPhone2, order.customerPhone2HasWa ?? null]);

		const key = entries.map(([p]) => p).join('|');
		if (!entries.length || key === waCheckedKey) return;
		waCheckedKey = key;

		const seed: Record<string, boolean | null> = {};
		for (const [p, v] of entries) seed[p] = v;
		waStatus = seed;

		if (entries.some(([, v]) => v === null)) void backfillWhatsapp(order);
	});

	let nowMs = $state(Date.now());
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		void loadCities();
		timerInterval = setInterval(() => {
			nowMs = Date.now();
		}, 1000);
	});

	let stopRefresh: (() => void) | null = null;

	$effect(() => {
		if (auth.isAuthenticated && orderId) {
			void loadOrder();
			stopRefresh?.();
			stopRefresh = useRefresh({
				reload: loadOrder,
				// Only react to events for the order currently on screen
				shouldReload: (data) => {
					if (!order) return true;
					return (
						data.submissionId === order.submissionId ||
						data.submissionId === order.id
					);
				}
			});
		}
	});

	onDestroy(() => {
		stopRefresh?.();
		if (timerInterval) clearInterval(timerInterval);
		if (reprintTimer) clearTimeout(reprintTimer);
	});

	// Runs once per order switch (order.id, not the useRefresh polling above) —
	// the reminders list only needs to follow the order itself, not every field
	// refresh, since composer/row actions already update it locally.
	let remindersLoadedFor = '';
	$effect(() => {
		if (order?.id && order.id !== remindersLoadedFor) {
			remindersLoadedFor = order.id;
			void loadOrderReminders();
		}
	});

	async function doCopy(text: string | undefined | null) {
		if (!text) return;
		if (await copyText(text)) toast.success('تم النسخ');
	}

	async function shareLink() {
		// Canonical order URL — correct even when embedded in the desktop pane
		// (where window.location is the list, not /order/…).
		const url = order
			? `${OPS_APP_BASE}/order/${orderSlug(order)}/`
			: window.location.href;
		const title = order?.customerName ? `طلب ${order.customerName}` : 'طلب';
		try {
			if (navigator.share) {
				await navigator.share({ title, url });
				return;
			}
		} catch {
			/* user cancelled or unavailable */
		}
		if (await copyText(url)) toast.success('تم نسخ الرابط');
	}

	async function doApprove() {
		if (!order) return;
		submitting = true;
		// Approve is now a pure greenlight — carrier + ERP happen at pack time.
		const t = toast.loading('جاري الموافقة…');
		try {
			await api.approve(order.id);
			toast.success('تمت الموافقة — انتقل الطلب إلى «للتجهيز»', {
				id: t,
				action: { label: 'عرض', onClick: () => jumpTo('approved') }
			});
			onMoved?.('approved');
			finishAction();
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		} finally {
			submitting = false;
		}
	}

	async function doReject() {
		if (!order) return;
		const reason = rejectReason.trim();
		if (!reason) {
			toast.error('يرجى كتابة سبب الرفض (إجباري)');
			rejectInputEl?.focus();
			return;
		}
		submitting = true;
		try {
			await api.reject(order.id, reason);
			toast.success('تم الرفض — انتقل الطلب إلى «سابقة»', {
				action: { label: 'عرض', onClick: () => jumpTo('history') }
			});
			onMoved?.('history');
			finishAction();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			submitting = false;
		}
	}

	function printReceipt() {
		if (!order?.id) return;
		// Demo mode has no carrier session to fetch a receipt over, so it opens
		// the drawn one instead, built from this order. A real receipt is not
		// shipped with the demo: it carries the recipient's name and address in
		// the clear, and its QR resolves to the rest of their details.
		if (DEMO) {
			const q = new URLSearchParams({
				merchant: auth.user?.name ?? '',
				city: order.cityName ?? '',
				region: order.regionName ?? '',
				address: order.fullAddress ?? '',
				customer: order.customerName ?? '',
				items: String(order.itemsNumber ?? ''),
				price: String(order.price ?? ''),
				notes: order.notes ?? '',
				tracking: order.shipment?.trackingNumber ?? order.idempotencyKey ?? ''
			});
			window.open(`${base}/demo/receipt.html?${q}`, '_blank');
			return;
		}
		// Ask the backend for the receipt rather than opening the stored qrLink:
		// that URL carries the merchant token from the day the order was created,
		// and Alwaseet has rotated it — every one of them now returns the merchant
		// login page, which is what «عرض الوصل» was showing. The endpoint fetches
		// it over a live web session and caches the PDF by tracking number.
		//
		// A new-tab GET can't send the Authorization header, so the token goes in
		// the query (the auth middleware accepts ?token=). pathPrefix keeps it on
		// the shipping backend when the app runs at genelog.nixflow.xyz/ops.
		const token = api.getToken() || '';
		window.open(
			`${pathPrefix()}/api/admin/shipments/${order.id}/receipt?token=${encodeURIComponent(token)}`,
			'_blank'
		);
	}

	function openTracking() {
		// Open the customer-facing tracking page (same URL the customer gets via WhatsApp).
		// Uses the first 13 chars of trackingToken (e.g. "fb40a712-ab2c"); the backend
		// resolves by prefix in /api/public/track/:token.
		const tok = order?.shipment?.trackingToken;
		if (tok) window.open(`${PUBLIC_ORDER_ORIGIN}/track/${tok.slice(0, 13)}`, '_blank');
	}

	// Printing is the one action on this screen that reaches into the physical
	// world the moment it is tapped — paper comes out of a machine in another
	// room, and there is no undo. It sits in a row of otherwise harmless buttons
	// on a phone screen, and a mis-tap was spending labels. So it arms first, the
	// same two-tap the order card uses for quick-approve: one tap asks, the
	// second prints, and the question withdraws itself after three seconds so a
	// forgotten armed button cannot be completed by a later stray tap.
	let reprintArmed = $state(false);
	let reprintTimer: ReturnType<typeof setTimeout> | null = null;

	function disarmReprint() {
		if (reprintTimer) clearTimeout(reprintTimer);
		reprintTimer = null;
		reprintArmed = false;
	}

	async function doReprint() {
		if (!order) return;
		if (!reprintArmed) {
			reprintArmed = true;
			haptic(15);
			if (reprintTimer) clearTimeout(reprintTimer);
			reprintTimer = setTimeout(() => (reprintArmed = false), 3000);
			return;
		}
		disarmReprint();
		haptic([30, 50, 30]);
		const t = toast.loading('جاري إرسال أمر الطباعة…');
		try {
			await api.reprint(order.id);
			toast.success('تم إرسال أمر الطباعة إلى الطابعة', { id: t });
		} catch (err) {
			toast.error((err as Error).message, { id: t });
		}
	}

	function openErpInvoice() {
		const link = order?.erpInvoiceUrl || order?.shipment?.erpInvoiceUrl;
		if (link) window.open(link, '_blank');
	}


	function back() {
		if (history.length > 1) history.back();
		else void goto(`${base}/`);
	}


	function handleSavedFromEdit() {
		void loadOrder();
		onChanged?.();
	}

	function handlePacked() {
		void loadOrder();
		// Packing always ends in the history tab (sent to carrier or completed manually).
		onMoved?.('history');
		onChanged?.();
	}
</script>

<svelte:head>
	{#if mode === 'page'}
		<title>{order?.customerName ? `${order.customerName} — طلبات` : 'طلب — طلبات'}</title>
	{/if}
</svelte:head>

{#if mode === 'page'}
	<Toaster richColors position="top-center" dir="rtl" />
{/if}

{#if mode === 'page' && !auth.isAuthenticated}
	<LoginScreen />
{:else}
	<!-- h-dvh (not min-h-dvh) so the body scrolls internally and the actions
	     footer stays pinned to the bottom of the screen -->
	<!-- A dropship order is gold end to end, not just badged as one. amber-400
	     rather than amber-500 throughout: the 500 is orange enough to read as a
	     warning state, which is a meaning this screen already spends elsewhere. -->
	<div
		class={cn(
			'flex flex-col',
			noCustomerContact
				? 'bg-amber-400/20 dark:bg-amber-400/[0.10]'
				: isWholesale
					? 'bg-violet-400/20 dark:bg-violet-400/[0.10]'
					: 'bg-background',
			mode === 'page' ? 'h-dvh overflow-hidden' : 'h-full'
		)}
	>
		<!-- ONE bar.
		     It was two: a floating pill reading "تفاصيل الطلب" with the order number
		     and status stacked under it, and a strip below repeating that same number
		     and that same status beside the customer's name. Four facts said twice,
		     and the screen opened with furniture instead of with the order. Now one
		     line answers who, which order, how old, and what state — and the title is
		     gone, because a screen showing one order need not announce that it is a
		     screen showing one order. -->
		<header
			class="sticky top-2 z-30 mx-3 my-2 flex shrink-0 items-center gap-2 rounded-3xl border px-2.5 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.06),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-inset backdrop-blur-3xl backdrop-saturate-200 transition-all dark:shadow-[0_8px_30px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.12)] {noCustomerContact
				? 'border-amber-500/30 bg-amber-100/80 ring-amber-500/25 dark:border-amber-400/20 dark:bg-amber-400/[0.12] dark:ring-amber-400/20'
				: isWholesale
					? 'border-violet-500/30 bg-violet-100/80 ring-violet-500/25 dark:border-violet-400/20 dark:bg-violet-400/[0.12] dark:ring-violet-400/20'
					: 'border-black/[0.08] bg-white/80 ring-white/80 dark:border-white/[0.12] dark:bg-[#18181c]/85 dark:ring-white/[0.08]'}"
		>
			{#if mode === 'page'}
				<Button variant="ghost" class="apple-press h-9 shrink-0 rounded-full bg-black/5 px-2.5 text-sm font-bold text-foreground hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 [&_svg]:size-4.5" onclick={back}>
					<ChevronRight class="rotate-180" />
				</Button>
			{:else}
				<Button
					variant="ghost"
					size="icon"
					class="apple-press size-9 shrink-0 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 [&_svg]:size-4.5"
					aria-label="إغلاق"
					onclick={() => onClose?.()}
				>
					<X />
				</Button>
			{/if}

			{#if order}
				<div class="flex min-w-0 flex-1 items-center gap-2">
					<!-- The reseller's name leads on a dropship order — the order is
					     theirs. The recipient is named in the contact block below, beside
					     the address and phone it belongs to. Truncates first: everything
					     after it is an identifier and cannot be shortened. -->
					<h1 class="min-w-0 shrink truncate text-sm font-black tracking-tight sm:text-base">
						{(noCustomerContact ? order.resellerName : order.customerName) ||
							order.customerName ||
							'-'}
					</h1>
					{#if noCustomerContact || isWholesale}
						<!-- The channel, still shouted, in one line's worth of room. It was a
						     display-face headline where the title used to be; it outranks
						     everything on this bar except the name, so it keeps the gradient
						     and the face. Latin on purpose — --font-display is a Latin face
						     and must never be handed Arabic (see app.css). -->
						<span
							class="shrink-0 bg-gradient-to-b bg-clip-text font-extrabold whitespace-nowrap uppercase text-transparent {noCustomerContact
								? 'from-amber-500 to-amber-700 dark:from-amber-200 dark:to-amber-400'
								: 'from-violet-500 to-violet-700 dark:from-violet-200 dark:to-violet-400'}"
							style="font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.06em;"
						>
							{noCustomerContact ? 'Dropshipping' : 'Wholesale'}
						</span>
					{:else if source}
						<span
							class="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap {source.class}"
							title="مصدر الطلب"
						>
							{source.label}
						</span>
					{/if}
					{#if tier}
						<span
							class="hidden shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap sm:inline {tier.class}"
							title="عدد الطلبات المكتملة السابقة: {tier.count}"
						>
							{tier.label} · {prevOrdersLabel(tier.count)}
						</span>
					{/if}

					<span class="bg-border/70 h-4 w-px shrink-0" aria-hidden="true"></span>

					<!-- The reference and copying it are one control now. An operator
					     quoting the number on the phone or pasting it into the ERP taps the
					     number, which is what they were aiming at when they hit the icon
					     beside it anyway. -->
					<button
						type="button"
						class="group inline-flex shrink-0 items-center gap-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
						title="نسخ رقم الطلب"
						aria-label="نسخ رقم الطلب"
						onclick={() => doCopy(orderRef)}
					>
						<Hash class="text-primary size-3.5 shrink-0" />
						<span class="font-mono text-sm font-extrabold tracking-tight tabular-nums">{orderRef}</span>
						<Copy class="size-3 shrink-0 opacity-40 transition-opacity group-hover:opacity-90" />
					</button>

					<!-- Age and date drop below md: the phone keeps one clean line, and
					     the same pair is on the order card the operator arrived from. -->
					<span class="text-muted-foreground hidden shrink-0 items-baseline gap-1.5 text-[11px] md:flex">
						<span class="text-foreground text-xs font-bold">{createdAge}</span>
						<span dir="ltr">{formatDateTime(order.createdAt)}</span>
					</span>
				</div>

				{#if isAdmin}
					<button
						type="button"
						onclick={() => { haptic(10); statusOpen = true; }}
						title="تغيير الحالة"
						class="inline-flex shrink-0 items-center gap-1 rounded-full border-2 px-2.5 py-1 text-xs font-bold whitespace-nowrap transition-opacity active:opacity-70 {badge.class}"
					>
						{badge.label}
						<Pencil class="size-3 opacity-60" />
					</button>
				{:else}
					<span
						class="shrink-0 rounded-full border-2 px-2.5 py-1 text-xs font-bold whitespace-nowrap {badge.class}"
					>
						{badge.label}
					</span>
				{/if}
			{:else}
				<!-- Nothing to identify yet. The title only appears while the order is
				     still loading or failed to. -->
				<h1 class="flex-1 truncate text-center text-sm font-black tracking-tight">تفاصيل الطلب</h1>
			{/if}

			<Button
				variant="ghost"
				size="icon"
				class="apple-press size-9 shrink-0 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 [&_svg]:size-4.5"
				aria-label="مشاركة"
				onclick={shareLink}
			>
				<Share2 />
			</Button>
		</header>

		{#if loading && !order}
			<div class="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
				<Loader2 class="size-4 animate-spin" />
				جاري التحميل…
			</div>
		{:else if loadError}
			<div class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6">
				<AlertTriangle class="size-12 opacity-30" />
				<p class="text-sm">{loadError}</p>
				<Button variant="outline" onclick={loadOrder}>إعادة المحاولة</Button>
			</div>
		{:else if order}
			<!-- Details. Neutral backdrop wash on the scroll area (lg+ only) — soft
			     monochrome slate radials, no colour, so the frosted panels still read
			     as glass without pulling the eye off the order. An ops screen is a
			     focus tool; the depth is subtle on purpose. -->
			<div
				class="flex-1 overflow-y-auto px-4 py-3 lg:[background-image:radial-gradient(45%_45%_at_88%_8%,rgb(148_163_184/0.12),transparent_70%),radial-gradient(48%_48%_at_8%_92%,rgb(100_116_139/0.10),transparent_70%)] [&_.row]:flex [&_.row]:items-start [&_.row]:gap-2.5 [&_.row]:py-2"
			>
				<!-- Column split at lg+: details, products and the conversation side by
				     side to use the horizontal room a desktop/tablet has. In RTL the
				     first grid child sits at the start (right), so details land right,
				     products next, conversation left.

				     Two columns at lg, three at xl. At 1024px a third column would
				     squeeze all three; the conversation instead spans the full width
				     under the other two until there is real room for it. Below lg the
				     grid collapses and the children stack exactly as before — phones
				     stay a single scroll column, in the same order. Carrier, ERP,
				     confirmation and the actions footer live AFTER this grid, so they
				     keep the full width. -->
				<div class="lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 xl:grid-cols-3">
				<!-- Order details column (right at lg+). Frosted-glass panel on mobile and desktop. -->
				<div class="mb-4 rounded-2xl border border-border/60 bg-card/65 p-4 shadow-lg ring-1 ring-white/15 ring-inset backdrop-blur-xl backdrop-saturate-200 lg:mb-0">
				<!-- Points at the ERP problem sitting far below the fold. Tapping
				     scrolls to it; the arrow bounces so it reads as "down there",
				     not as another badge. -->
				{#if erpAttention}
					<button
						type="button"
						onclick={jumpToErpStrip}
						class="mb-3 flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-bold text-amber-700 active:opacity-80 dark:text-amber-400"
					>
						<AlertTriangle class="size-4 shrink-0" />
						<span class="min-w-0 flex-1 text-right">{erpAttention} — اضغط للانتقال</span>
						<ArrowDown class="animate-erp-point size-4 shrink-0" />
					</button>
				{/if}

				{#if order.duplicateOf}
					{@const dup = order.duplicateOf}
					{@const exactDup = dup.type === 'exact'}
					<div
						class={cn(
							'mb-2 rounded-lg border-2 px-3 py-2.5',
							exactDup
								? 'border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300'
								: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
						)}
					>
						<p class="flex items-center gap-1.5 text-sm font-bold">
							<AlertTriangle class="size-4 shrink-0" />
							{exactDup
								? 'طلب مكرر — نفس معلومات طلب سابق خلال 24 ساعة'
								: 'للزبون طلب آخر خلال اليومين الماضيين'}
						</p>
						<div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
							<span>الطلب السابق: {getStatusLabel(dup.status)} · <span dir="ltr">{formatDateTime(dup.createdAt)}</span></span>
							<a
								href="{base}/order/{dup.orderKey || dup.id}/"
								class={cn(
									'rounded-md border px-2 py-1 font-bold underline-offset-2 hover:underline',
									exactDup ? 'border-rose-500/50' : 'border-amber-500/50'
								)}
							>
								فتح الطلب السابق
							</a>
						</div>
					</div>
				{/if}

				<!-- Vague region («اخرى») — Alwaseet mis-routes these, so push the
				     operator to fix it or call the customer before sending. -->
				{#if vagueRegion}
					<div class="mb-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
						<p class="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-400">
							<AlertTriangle class="size-4 shrink-0" />
							المنطقة «{order.regionName}» تسبب مشاكل مع الوسيط
						</p>
						<p class="mt-1 text-xs leading-relaxed text-amber-700/90 dark:text-amber-400/90">
							يرجى تعديلها إلى المنطقة الصحيحة أو الأقرب لها، أو التواصل مع الزبون لمعرفة منطقته.
						</p>
						<div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
							<button
								type="button"
								onclick={() => { haptic(12); editOpen = true; }}
								class="rounded-md border border-amber-500/50 px-2 py-1 font-bold text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
							>
								تعديل المنطقة
							</button>
							<!-- WhatsApp only for numbers known to have it (waStatus); a
							     number without WhatsApp gets a tel: link to call instead. -->
							{#each contactNumbers as num (num)}
								{#if waStatus[num] === false}
									<a
										href="tel:{num}"
										class="flex items-center gap-1 rounded-md border border-sky-500/50 px-2 py-1 font-bold text-sky-700 hover:bg-sky-500/10 dark:text-sky-400"
									>
										<Phone class="size-3" /> اتصال <span dir="ltr">{num}</span>
									</a>
								{:else}
									<a
										href={whatsappHref(num)}
										target="_blank"
										rel="noopener"
										class="flex items-center gap-1 rounded-md border border-emerald-500/50 px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
									>
										<WhatsAppIcon class="size-3" /> <span dir="ltr">{num}</span>
									</a>
								{/if}
							{/each}
						</div>
					</div>
				{/if}

				<!-- Notes are READ-ONLY now, and the card is absent when there are
				     none.
				     Writing about an order happens in its conversation: two places to
				     write meant the two drifted, and on a dropship order the note is
				     the RESELLER's sentence, so an operator adding their own beside it
				     put two different voices under one rose heading. What survives is
				     what arrives with the order — and pinning a message in the thread
				     is how the team now puts something on the card. -->
				{#if opNotes.length}
				<div class="mb-3 rounded-lg border border-rose-500/50 bg-rose-500/10 p-3">
					<div class="flex items-center justify-between gap-2">
						<div
							class={cn(
								'flex items-center gap-2 text-sm font-bold',
								opNoteText && 'text-rose-600 dark:text-rose-400'
							)}
						>
							<StickyNote class="size-4" /> ملاحظات الموظفين
						</div>
						<span class="text-muted-foreground text-[11px] font-bold">من الطلب</span>
					</div>
					{#if opNotes.length}
						<div class="mt-2 space-y-2">
							{#each opNotes as note, i (i)}
								<div class="rounded-md border border-rose-500/30 bg-rose-500/5 p-2">
									{#if note.author}
										<div class="mb-1 flex items-center justify-between gap-2">
											<span class="text-[11px] font-bold text-rose-600/80 dark:text-rose-400/80">{note.author} · {note.stamp}</span>
										</div>
									{/if}
									<div class="whitespace-pre-wrap text-sm font-semibold leading-relaxed text-rose-700 dark:text-rose-300">{note.body}</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
				{/if}

				<!-- Reminders on this order — visible to every operator, not just whoever
				     set them (a follow-up is a team question: "does this need a callback"). -->
				<div class="mb-3 rounded-lg border border-border bg-muted/30 p-3">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 text-sm font-bold">
							<Bell class="size-4" /> تذكير
						</div>
						<Button
							variant={orderReminders.length ? 'outline' : 'default'}
							size="sm"
							class="h-8 gap-1.5 text-xs"
							onclick={() => {
								haptic(10);
								remindComposing = !remindComposing;
							}}
						>
							<MessageSquarePlus class="size-3.5" /> {remindComposing ? 'إلغاء' : 'إضافة'}
						</Button>
					</div>
					{#if remindComposing && order}
						<div class="mt-2">
							<ReminderComposer
								submissionId={order.id}
								onCreated={(r) => {
									orderReminders = [...orderReminders, r];
									remindComposing = false;
								}}
							/>
						</div>
					{/if}
					{#if orderReminders.length}
						<ul class="mt-2 divide-y rounded-md border">
							{#each orderReminders as r (r.id)}
								<ReminderRow
									reminder={r}
									onChanged={(u) => {
										orderReminders = u
											? orderReminders
													.map((x) => (x.id === r.id ? u : x))
													.filter((x) => x.status === 'PENDING')
											: orderReminders.filter((x) => x.id !== r.id);
									}}
								/>
							{/each}
						</ul>
					{/if}
				</div>

				{#snippet phoneLine(num: string, extra: boolean)}
					<div class="row">
						<Phone class="text-primary mt-0.5 size-4 shrink-0" />
						<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
							<span class="font-semibold" dir="ltr">
								{num}{#if extra}&nbsp;<span class="text-muted-foreground text-xs">(إضافي)</span
									>{/if}
							</span>
							<Button
								variant="outline"
								size="sm"
								class="h-7 gap-1 px-2 text-xs"
								onclick={() => doCopy(num)}
							>
								<Copy class="size-3" /> نسخ
							</Button>
							{#if noCustomerContact}
								<!-- The number stays visible: ops needs it to spot duplicates
								     and to read out to a driver, and it is printed on the parcel
								     regardless. What goes is the one-tap way to open a chat with
								     someone who is not our customer. -->
								<!-- The chip states the rule and who covers it instead; the panel
								     answers the questions that follow. Opens on hover with no
								     delay for a desk, and on tap for a phone, where hover does
								     not exist and most of this work happens. -->
								<span class="group relative inline-flex">
									<button
										type="button"
										onclick={(e) => { e.stopPropagation(); noCallOpen = !noCallOpen; }}
										aria-expanded={noCallOpen}
										class="inline-flex cursor-help items-center gap-1 rounded-md border border-amber-600/50 bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300"
									>
										<MessageCircleOff class="size-3" /> لا تتصل — يتابعه الموزع
									</button>
									<!-- Anchored at the chip's inline-END so the panel grows back
									     across the row rather than off the edge. The chip is the
									     last thing in a wrapping flex line, so the free space is all
									     on that side; anchoring the other way clipped it against the
									     scroll container. -->
									<div
										class="pointer-events-none absolute top-full z-50 mt-1 hidden w-[min(20rem,72vw)] rounded-lg border border-amber-600/40 bg-popover p-2.5 text-start shadow-lg group-hover:block {noCallOpen
											? '!block'
											: ''}"
										style="inset-inline-end: 0;"
										role="tooltip"
									>
										<p class="text-xs font-bold text-amber-800 dark:text-amber-300">
											هذا الزبون يخص الموزع
										</p>
										<p class="text-muted-foreground mt-1 text-[11px] leading-relaxed">
											لم تصله أي رسالة منّا — لا تأكيد ولا رابط تتبع — ولا يجب الاتصال به أو
											مراسلته من أرقامنا.
										</p>
										<p class="mt-1.5 text-[11px] font-semibold">
											لأي استفسار أو تعديل: {order?.resellerName || 'الموزع'}{order?.resellerPhone
												? ' · '
												: ''}<span dir="ltr">{order?.resellerPhone ?? ''}</span>
										</p>
									</div>
								</span>
							{:else if waStatus[num] === false}
								<span
									class="text-muted-foreground border-muted-foreground/30 bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold"
									title="هذا الرقم لا يمتلك واتساب"
								>
									<MessageCircleOff class="size-3" /> لا يمتلك واتساب
								</span>
							{:else}
								<a
									href={whatsappHref(num)}
									target="_blank"
									rel="noopener"
									class="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
								>
									<WhatsAppIcon class="size-3" /> واتساب
								</a>
							{/if}
						</div>
					</div>
				{/snippet}

				<!-- The reseller, above their customer, because on these orders they are
				     the only person an operator may actually call. -->
				{#if noCustomerContact && (order.resellerName || order.resellerPhone)}
					<div class="row">
						<Store class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
						<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
							<span class="font-semibold">{order.resellerName || 'موزع'}</span>
							{#if order.resellerPhone}
								<span class="text-muted-foreground text-xs" dir="ltr">{order.resellerPhone}</span>
								<a
									href={whatsappHref(order.resellerPhone)}
									target="_blank"
									rel="noopener"
									class="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
								>
									<WhatsAppIcon class="size-3" /> واتساب
								</a>
								<a
									href="tel:{order.resellerPhone}"
									class="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-400"
								>
									<Phone class="size-3" /> اتصال
								</a>
								<Button
									variant="outline"
									size="sm"
									class="h-7 gap-1 px-2 text-xs"
									onclick={() => doCopy(order?.resellerPhone ?? '')}
								>
									<Copy class="size-3" /> نسخ
								</Button>
							{:else}
								<span class="text-muted-foreground text-xs">لا يوجد رقم للموزع</span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Who the parcel is actually for. The title above names the reseller
				     on these orders, and this was the only other place the recipient
				     appeared — a packer reading nothing but an address and a phone
				     has no name to write on the box or give the driver. -->
				{#if noCustomerContact && order.customerName}
					<div class="row">
						<User class="mt-0.5 size-4 shrink-0 text-sky-500" />
						<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
							<span class="font-semibold">{order.customerName}</span>
							<span class="text-muted-foreground text-xs">زبون الموزع — المستلم</span>
						</div>
					</div>
				{/if}

				{#if order.customerPhone}
					{@render phoneLine(order.customerPhone, false)}
				{:else}
					<div class="row">
						<Phone class="text-primary mt-0.5 size-4 shrink-0" />
						<span class="font-semibold" dir="ltr">-</span>
					</div>
				{/if}

				{#if order.customerPhone2}
					{@render phoneLine(order.customerPhone2, true)}
				{/if}

				<div class="row">
					<Building2 class="mt-0.5 size-4 shrink-0 text-amber-500" />
					<span>{order.cityName || '-'}{order.regionName ? ` — ${order.regionName}` : ''}</span>
				</div>

				{#if order.fullAddress}
					<div class="row">
						<MapPin class="mt-0.5 size-4 shrink-0 text-amber-500" />
						<span>{order.fullAddress}</span>
					</div>
				{/if}

				<div class="row">
					<CircleDollarSign class="mt-0.5 size-5 shrink-0 text-emerald-500" />
					<span class="text-emerald-700 dark:text-emerald-400">
						<span class="text-xl font-extrabold tabular-nums"
							><AnimatedNumber value={Number(order.price) || 0} format={formatPrice} duration={500} /></span
						>
						<span class="text-sm font-semibold">د.ع</span>
					</span>
				</div>

				{#if order.discountCode}
					<div class="row">
						<Tag class="mt-0.5 size-4 shrink-0 text-amber-600" />
						<span class="font-semibold text-amber-700 dark:text-amber-400">
							{formatDiscountLabel(order.discountCode, order.discountAmount)}
						</span>
					</div>
				{/if}

				<!-- The storefront waived delivery (an offer, or a loyalty tier that
				     includes it). The price already excludes it, so this exists to stop
				     an operator "correcting" a total that looks short. -->
				{#if order.freeDelivery}
					<div class="row">
						<Truck class="mt-0.5 size-4 shrink-0 text-emerald-600" />
						<span class="font-semibold text-emerald-700 dark:text-emerald-400">
							توصيل مجاني — من المتجر
						</span>
					</div>
				{/if}

				<div class="row">
					<Package class="text-muted-foreground mt-0.5 size-4 shrink-0" />
					<span>{formatPieces(order.itemsNumber)}</span>
				</div>

				{#if isReturn}
					<!-- A return is the one shipment whose carrier status an operator
					     has to actually watch: it is money and stock coming back, and
					     it can bounce between states for days. Our own lifecycle badge
					     says "أُرسل" the whole time, so the carrier's word gets its own
					     panel here rather than a line among the details. -->
					<div class="mt-1 rounded-lg border-2 border-orange-500/60 bg-orange-500/10 p-3">
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-lg leading-none">🔄</span>
							<span class="text-sm font-bold text-orange-600 dark:text-orange-400">
								طلب إرجاع/استبدال
							</span>
							<span class="text-muted-foreground text-[11px]">
								يُرسل إلى الوسيط كـ replacement
							</span>
						</div>

						{#if isLocalOrder}
							{#if returnReceived}
								<p class="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
									✔ استُلم المرتجع — لا حاجة للمتابعة{#if order.shipment?.returnReceivedAt} · <span class="text-muted-foreground text-[11px]" dir="ltr">{formatDateTime(order.shipment.returnReceivedAt)}</span>{/if}
								</p>
								<button type="button" disabled={returnBusy} onclick={() => void toggleReturnReceived()} class="text-muted-foreground mt-1 text-[11px] underline">تراجع عن الاستلام</button>
							{:else}
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<span class="text-muted-foreground text-xs">حالة المرتجع:</span>
									<span class="animate-blink rounded-md border-2 border-orange-500 bg-orange-500/15 px-2.5 py-1 text-sm font-bold text-orange-600 dark:text-orange-400">لم تُستلم القطعة المرتجعة بعد</span>
								</div>
								<button type="button" disabled={returnBusy} onclick={() => { haptic(12); void toggleReturnReceived(); }} class="mt-2.5 inline-flex h-10 items-center gap-1.5 rounded-lg border-2 border-emerald-600/60 bg-emerald-500/15 px-4 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-400">
									<Check class="size-4" /> {returnBusy ? '…' : 'تم استلام الراجع'}
								</button>
								<p class="text-muted-foreground mt-1 text-[11px]">يدوي — علّمه عندما يُعيد المندوب القطعة إليك.</p>
							{/if}
						{:else}
						{#if carrierNow}
							<!-- Blinking on purpose, and only here: a return that has
							     stopped moving is invisible otherwise. Stops blinking
							     once the carrier reports it back with us — at that point
							     it is done and no longer needs chasing. -->
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<span class="text-muted-foreground text-xs">حالة المندوب الآن:</span>
								<span
									class="rounded-md border-2 px-2.5 py-1 text-sm font-bold {carrierToneClass} {carrierSettled
										? ''
										: 'animate-blink'}"
								>
									{carrierNow}
								</span>
								{#if order.shipment?.alwaseetStatusAt}
									<span class="text-muted-foreground text-[11px]" dir="ltr">
										{formatDateTime(order.shipment.alwaseetStatusAt)}
									</span>
								{/if}
							</div>
							{#if order.shipment?.alwaseetIssueNotes}
								<p class="mt-1.5 text-xs font-semibold text-orange-700 dark:text-orange-300">
									ملاحظة المندوب: {order.shipment.alwaseetIssueNotes}
								</p>
							{/if}
						{:else if !returnClosed}
							<p class="text-muted-foreground mt-2 text-xs">
								لم يصل بعد أي تحديث من المندوب.
							</p>
						{/if}

						<!-- Closing the book by hand is not a workaround, it is the only
						     ending some returns get: Alwaseet archives old orders and
						     answers [] for them forever, so the carrier will never report
						     a parcel back even once it is on our shelf. -->
						{#if returnClosed}
							<p class="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
								✔ استُلم المرتجع — لا حاجة للمتابعة
							</p>
						{:else if isAdmin}
							<button
								type="button"
								disabled={statusSaving}
								onclick={() => { haptic(12); void doSetStatus('COMPLETED_MANUAL'); }}
								class="mt-2.5 inline-flex h-10 items-center gap-1.5 rounded-lg border-2 border-emerald-600/60 bg-emerald-500/15 px-4 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-400"
							>
								<Check class="size-4" />
								استلم المرتجع
							</button>
							<p class="text-muted-foreground mt-1 text-[11px]">
								يُنهي المتابعة ويُخرجه من قائمة الإرجاع.
							</p>
						{/if}
						{/if}

						{#if carrierEvents.length > 0}
							<!-- Every update, one by one, oldest first. The map this
							     replaced could not show a status twice, which is exactly
							     what a failed redelivery looks like. -->
							<ol class="mt-3 space-y-0 border-t border-orange-500/25 pt-2">
								{#each carrierEvents as ev, i (ev.id)}
									<li class="relative flex gap-2.5 pb-2.5 last:pb-0">
										<div class="flex flex-col items-center">
											<span
												class="mt-1 size-2 shrink-0 rounded-full {ev.carrierClass === 'ATTENTION'
													? 'bg-red-500'
													: ev.carrierClass === 'DELIVERED'
														? 'bg-emerald-500'
														: ev.carrierClass === 'RETURNING'
															? 'bg-orange-500'
															: 'bg-muted-foreground/50'}"
											></span>
											{#if i < carrierEvents.length - 1}
												<span class="bg-border w-px flex-1"></span>
											{/if}
										</div>
										<div class="min-w-0 flex-1">
											<p class="text-xs font-semibold">{ev.statusName || '—'}</p>
											<p class="text-muted-foreground text-[11px]" dir="ltr">
												{formatDateTime(ev.statusAt || ev.observedAt)}
											</p>
											{#if ev.issueNotes}
												<p class="mt-0.5 text-[11px] text-orange-700 dark:text-orange-300">
													{ev.issueNotes}
												</p>
											{/if}
										</div>
									</li>
								{/each}
							</ol>
						{/if}
					</div>
				{/if}

				{#if isStickerOrder && hasTracking}
					<!-- Preprinted-sticker order: show the physical sticker id big, so
					     an operator can match the parcel on the shelf to the order. -->
					<div class="flex items-center gap-3 rounded-xl bg-indigo-600 p-3 text-white shadow-sm dark:bg-indigo-500">
						<ScanLine class="size-8 shrink-0 text-white" />
						<div class="min-w-0">
							<div class="text-xs font-bold text-indigo-100">🏷️ ملصق مطبوع مسبقاً</div>
							<div class="text-3xl font-extrabold tabular-nums leading-tight text-white" dir="ltr">
								{order?.shipment?.stickerLabelId || order?.shipment?.trackingNumber}
							</div>
						</div>
					</div>
				{/if}

					{#if order?.preStickerId && !(isStickerOrder && hasTracking)}
						<!-- Preprinted sticker linked at order creation, before the carrier
						     send. Show it so the operator can confirm the id was captured. -->
						<div class="flex items-center gap-3 rounded-xl border-2 border-dashed border-indigo-400/60 bg-indigo-500/10 p-3">
							<ScanLine class="size-7 shrink-0 text-indigo-600 dark:text-indigo-400" />
							<div class="min-w-0">
								<div class="text-xs font-bold text-indigo-700 dark:text-indigo-300">🏷️ ملصق محجوز مسبقاً</div>
								<div class="text-2xl font-extrabold tabular-nums leading-tight text-indigo-800 dark:text-indigo-200" dir="ltr">
									{order.preStickerId}
								</div>
							</div>
						</div>
					{/if}

					{#if isLocalOrder}
						<!-- Own-driver delivery. No carrier API, so the operator IS the
						     tracking system: the card leads with where the parcel is, then
						     the one move that follows from it. -->
						<div class="overflow-hidden rounded-2xl border border-cyan-500/40 bg-cyan-500/[0.07]">
							<!-- Who has it -->
							<div class="flex items-center gap-3 border-b border-cyan-500/20 p-3">
								{#if driverAvatarBroken}
									<div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-lg text-white dark:bg-cyan-500">
										🏍️
									</div>
								{:else}
									<img
										src={driverAvatar(order.shipment?.localDriverName, order.shipment?.localDriverId)}
										alt=""
										class="bg-muted size-12 shrink-0 rounded-full ring-2 ring-cyan-500/40"
										onerror={() => (driverAvatarBroken = true)}
									/>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="text-[11px] font-bold text-cyan-700 dark:text-cyan-300">مندوب محلي</div>
									<div class="truncate text-base font-black">
										{order.shipment?.localDriverName || 'مندوب'}
									</div>
								</div>
								{#if order.shipment?.localDriverPhone}
									<a
										href="tel:{order.shipment.localDriverPhone}"
										class="apple-press flex size-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white dark:bg-cyan-500"
										aria-label="اتصال بالمندوب"
									>
										<Phone class="size-4" />
									</a>
								{/if}
							</div>

							{#if order.shipment?.localDriverPhone}
								<!-- Named on purpose: at the counter the operator is picking one
								     driver out of six, and «واتساب حسام» is unmistakable where a
								     bare icon is not. -->
								<div class="mx-3 mt-2.5 flex items-center gap-2">
									<a
										href={whatsappHref(order.shipment.localDriverPhone)}
										target="_blank"
										rel="noopener"
										class="apple-press flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-sm font-black text-emerald-700 dark:text-emerald-300"
									>
										<WhatsAppIcon class="size-5" />
										واتساب {order.shipment?.localDriverName || 'المندوب'}
									</a>
									<button
										type="button"
										class="apple-press flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm font-black text-amber-700 dark:text-amber-300"
										disabled={paging}
										onclick={() => void pageDriver()}
									>
										<BellRing class="size-4" />
										{paging ? '…' : 'استدعاء'}
									</button>
								</div>
							{/if}

							<!-- Where it is -->
							<div class="flex items-center justify-between gap-3 px-3 py-2.5">
								<span
									class="rounded-full px-3 py-1 text-sm font-black ring-1 ring-inset {localFlow.tone}"
								>
									{localStageName || 'لم تُحدَّد الحالة'}
								</span>
								{#if order.shipment?.alwaseetStatusAt}
									<span class="text-muted-foreground text-xs font-bold">
										{formatStockRelative(order.shipment.alwaseetStatusAt)}
									</span>
								{/if}
							</div>

							<!-- The money on THIS parcel: what the driver collects, what they
							     keep, what comes back to us. -->
							<div class="mx-3 mb-2.5 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-cyan-500/20 text-center">
								<div class="bg-card/70 px-2 py-2">
									<div class="text-muted-foreground text-[10px] font-bold">يحصّل</div>
									<div class="text-sm font-black tabular-nums">{formatPrice(order.price)}</div>
								</div>
								<div class="bg-card/70 px-2 py-2">
									<div class="text-muted-foreground text-[10px] font-bold">أجوره</div>
									<div class="text-sm font-black tabular-nums">{formatPrice(localFee)}</div>
								</div>
								<div class="bg-card/70 px-2 py-2">
									<div class="text-muted-foreground text-[10px] font-bold">يرجع لنا</div>
									<div class="text-sm font-black tabular-nums text-cyan-700 dark:text-cyan-300">
										{formatPrice(localNet)}
									</div>
								</div>
							</div>

							<!-- The one move that follows from the stage above -->
							<div class="space-y-2 px-3 pb-3">
								{#if localFlow.next}
									<Button
										class="h-12 w-full bg-cyan-600 text-base font-black text-white hover:bg-cyan-700"
										disabled={localBusy}
										onclick={() => void doLocalStatus(localFlow.next!.key)}
									>
										{localBusy ? '…' : localFlow.next.label}
									</Button>
								{:else if localDelivered}
									<div class="rounded-xl bg-emerald-500/15 py-2 text-center text-sm font-black text-emerald-700 dark:text-emerald-300">
										تم التسليم ✓
									</div>
								{/if}

								{#if canSettleOrder}
									<button
										type="button"
										class="apple-press flex w-full items-center justify-between gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2.5 text-start"
										disabled={settling}
										onclick={() => {
											haptic(12);
											settleConfirmOpen = true;
										}}
									>
										<span class="flex flex-col text-start">
											<span class="text-xs font-bold text-cyan-800 dark:text-cyan-200">
												استلام مبلغ هذا الطلب
											</span>
											<!-- The driver's whole book stays visible, but only as context. -->
											<span class="text-[10px] font-bold text-cyan-800/70 dark:text-cyan-200/70">
												{driverOwed === null
													? 'من المندوب'
													: `بذمة المندوب كاملاً: ${formatPrice(driverOwed)} د.ع`}
											</span>
										</span>
										<span class="flex items-center gap-2">
											<span class="text-sm font-black tabular-nums">{formatPrice(localNet)} د.ع</span>
											<span class="rounded-lg bg-cyan-600 px-2 py-1 text-[11px] font-bold text-white dark:bg-cyan-500">
												{settling ? '…' : 'تسوية'}
											</span>
										</span>
									</button>
								{:else if orderSettled}
									<div class="text-muted-foreground text-center text-[11px] font-bold">
										تمت تسوية مبلغ هذا الطلب
									</div>
								{:else if driverOwed !== null && driverOwed > 0}
									<div class="text-muted-foreground text-center text-[11px] font-bold">
										بذمة المندوب {formatPrice(driverOwed)} د.ع
									</div>
								{/if}

								<!-- Corrections, not the path: folded until asked for. -->
								<button
									type="button"
									class="apple-press text-muted-foreground flex w-full items-center justify-center gap-1 py-1 text-xs font-bold"
									onclick={() => (localMoreOpen = !localMoreOpen)}
								>
									<ChevronDown
										class="size-3.5 transition-transform duration-200 {localMoreOpen ? '' : '-rotate-90'}"
									/>
									تغيير الحالة يدوياً
								</button>
								{#if localMoreOpen}
									<div class="grid grid-cols-2 gap-2">
										{#each localOtherStages as st (st.key)}
											<Button
												size="sm"
												variant="outline"
												class="h-10 text-xs font-bold"
												disabled={localBusy}
												onclick={() => void doLocalStatus(st.key)}
											>
												{st.label}
											</Button>
										{/each}
									</div>
								{/if}

								{#if order.shipment?.trackingToken}
									<button
										type="button"
										class="flex w-full items-center justify-center gap-1.5 text-xs font-bold text-cyan-700 underline underline-offset-2 dark:text-cyan-300"
										onclick={openTracking}
									>
										<LinkIcon class="size-3.5" /> صفحة تتبع الزبون
									</button>
								{/if}
							</div>
						</div>
					{/if}

				{#if hasTracking}
					{@const trackToken = order.shipment?.trackingToken?.slice(0, 13) ?? ''}
					{@const trackUrl = trackToken ? `${PUBLIC_ORDER_ORIGIN}/track/${trackToken}` : ''}
					<div class="row">
						<LinkIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" />
						<div class="flex flex-wrap items-center gap-2">
							<button
								type="button"
								class="font-mono font-semibold underline-offset-2 hover:underline disabled:no-underline"
								onclick={openTracking}
								disabled={!trackToken}
								title="فتح صفحة تتبع الزبون"
							>
								{order?.shipment?.trackingNumber}
							</button>
							{#if trackToken}
								<Button
									variant="outline"
									size="sm"
									class="h-7 gap-1 px-2 text-xs"
									onclick={openTracking}
								>
									<LinkIcon class="size-3" /> تتبع
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="h-7 gap-1 px-2 text-xs"
									onclick={() => doCopy(trackUrl)}
									title={trackUrl}
								>
									<Copy class="size-3" /> نسخ رابط الزبون
								</Button>
							{/if}
							{#if isAdmin}
								<Button
									variant="outline"
									size="sm"
									class="h-7 gap-1 px-2 text-xs {order.shipment?.trackingStatusOverride ? 'border-violet-500/60 text-violet-700 dark:text-violet-300' : ''}"
									onclick={openTrackOverride}
									title={order.shipment?.trackingStatusOverride ? `حالة يدوية: ${order.shipment.trackingStatusOverride}` : 'تعديل حالة التتبع'}
								>
									<Pencil class="size-3" /> تعديل
								</Button>
							{/if}
						</div>
					</div>
				{/if}

				{#if displayNotes(order.notes)}
					<div class="row">
						<FileText class="mt-1 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
						<div class="flex-1 rounded-lg border-2 border-amber-500/50 bg-amber-500/10 px-3 py-2">
							<p class="mb-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">ملاحظة الزبون</p>
							<p class="whitespace-pre-wrap text-lg font-bold leading-snug text-amber-900 dark:text-amber-200">
								{displayNotes(order.notes)}
							</p>
						</div>
					</div>
				{/if}

				</div>
				<!-- end order details column -->

				<!-- Products column (left at lg+). Frosted-glass panel on mobile and desktop. -->
				<div class="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-lg ring-1 ring-white/15 ring-inset backdrop-blur-xl backdrop-saturate-200">
				{#if order.items && order.items.length > 0}
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 text-sm font-bold">
							<Box class="size-4" /> المنتجات ({order.items.length})
						</div>
						<button
							type="button"
							onclick={() => loadStock(true)}
							disabled={stockLoading}
							title={stockAuto ? 'إعادة قراءة الكميات من الـ ERP' : 'هذا طلب سابق — لم يتم فحص المخزون تلقائياً'}
							class={cn(
								'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold active:opacity-70 disabled:opacity-50',
								// A past order has NOT been checked, so the button is the only way to
								// see stock — make it read as an invitation, not a refresh.
								!stockAuto && !stockCheckedAt
									? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400'
									: 'text-muted-foreground'
							)}
						>
							{#if stockLoading}
								<Loader2 class="size-3.5 animate-spin" /> جاري التحقق من المخزون…
							{:else}
								<Warehouse class="size-3.5" /> تحقق من المخزون
							{/if}
						</button>
					</div>

					{#if stockError}
						<div class="mt-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
							<AlertTriangle class="size-3.5 shrink-0" />
							<span class="min-w-0 flex-1">تعذر قراءة المخزون من الـ ERP — {stockError}</span>
						</div>
					{/if}

					<!-- Past orders skip the automatic check, so say so where it is actually
					     readable — a title tooltip never appears on the phones ops runs on. -->
					{#if !stockAuto && !stockCheckedAt && !stockLoading}
						<div class="text-muted-foreground mt-2 text-[11px]">
							طلب سابق — لم يتم فحص المخزون تلقائياً
						</div>
					{/if}

					<!-- Which single warehouse can ship the whole order. A recommendation
					     only: nothing here changes the order, the operator decides. -->
					<!-- Placeholder for the shipping suggestion while the ERP is being
					     read. Same height and shape as the real strip, so the items list
					     below it does not shift when the answer arrives. -->
					{#if stockLoading}
						<div class="mt-2 rounded-md border px-2.5 py-2">
							<div class="flex items-center gap-1.5">
								<Warehouse class="text-muted-foreground/50 size-3.5 shrink-0" />
								<span class="wave inline-block h-3.5 w-40 rounded"></span>
								<span class="wave inline-block h-[19px] w-24 rounded-md" style="animation-delay:160ms"></span>
							</div>
						</div>
					{/if}

					{#if stockSuggestion && !stockLoading}
						{#if stockSuggestion.suggested}
							<!-- Every warehouse that could ship the whole order, on one line.
							     They are alternatives, so none is ranked above the others here. -->
							<div class="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
								<div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-bold">
									<Warehouse class="size-3.5 shrink-0" />
									<span>بالإمكان شحن الطلب كاملاً من:</span>
									{#each sortByBranch(stockSuggestion.coveredBy, (n) => n) as name, i (name)}
										{#if i > 0}<span class="font-normal opacity-70">أو</span>{/if}
										<span
											class={cn(
												'rounded-md px-1.5 py-0.5 text-[11px] font-bold',
												branchStyle(name).pill
											)}
										>
											{branchStyle(name).label}
										</span>
									{/each}
								</div>
								{#if stockSuggestion.partial}
									<div class="mt-1 flex items-center gap-1 text-amber-700 dark:text-amber-400">
										<AlertTriangle class="size-3 shrink-0" />
										عدا {stockSuggestion.unknown.join('، ')} — غير موجود في الـ ERP
									</div>
								{/if}
							</div>
						{:else if stockSuggestion.perBranch.length}
							<div class="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-700 dark:text-rose-400">
								<div class="flex items-center gap-1.5 font-bold">
									<AlertTriangle class="size-3.5 shrink-0" />
									لا يوجد مستودع واحد يغطي الطلب — يحتاج الى مناقلة مخزنية
								</div>
								<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 opacity-90">
									{#each sortByBranch(stockSuggestion.perBranch, (b) => b.name) as b (b.name)}
										<span>{branchStyle(b.name).label}: {b.covers}/{b.of}</span>
									{/each}
								</div>
							</div>
						{/if}
					{/if}

					<ul class="mt-2 space-y-3">
						{#each order.items as item, i (i)}
							{@const unit = Number(item.unitPrice) || 0}
							{@const qty = Number(item.quantity) || 1}
							{@const lineTotal = unit * qty}
							{@const free = !item.isComponent && unit === 0}
							{@const imgSrc = resolveImage(item.imageUrl)}
							{@const st = item.sku ? stock[item.sku] : undefined}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
							<li
								class="bg-muted/40 ring-border/60 rounded-md p-2 text-sm ring-1 transition-colors"
								class:cursor-zoom-in={!!imgSrc}
								class:active:bg-muted={!!imgSrc}
								onclick={(e) => imgSrc && openViewer(e, imgSrc)}
							>
								<div class="flex items-center gap-3">
									<div class="bg-muted flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md">
										{#if imgSrc}
											<img src={imgSrc} alt="" class="size-full object-cover" />
										{:else}
											<Package class="text-muted-foreground size-6" />
										{/if}
									</div>
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1">
											<span class="font-semibold">{item.name || item.sku || '-'}</span>
											{#if free}
												<Gift class="size-3.5 text-emerald-500" />
											{/if}
										</div>
										{#if item.sku && item.sku !== item.name}
											<div class="text-muted-foreground text-xs">{item.sku}</div>
										{/if}
									</div>
									<!-- The line total is the number the operator reconciles against the
									     order total, so it carries the weight; the unit price stays under
									     it and only when the quantity makes the two differ. -->
									<div class="shrink-0 text-right">
										<div class="text-base font-extrabold tabular-nums leading-none">×{qty}</div>
										<div class="mt-1 text-sm font-bold tabular-nums whitespace-nowrap">
											<AnimatedNumber value={lineTotal} format={formatPrice} duration={500} /> د.ع
										</div>
										{#if qty > 1}
											<div class="text-muted-foreground text-[11px] font-medium tabular-nums whitespace-nowrap">
												<AnimatedNumber value={unit} format={formatPrice} duration={500} /> × {qty}
											</div>
										{/if}
									</div>
								</div>

								<!-- Live per-warehouse stock from the ERP. Absent while loading, and
								     absent entirely for a line with no SKU — nothing to look up. -->
								{#if item.sku}
									{#if st?.found}
										<div class="mt-1.5 ms-[4.25rem] flex flex-wrap items-center gap-1.5">
											{#each sortByBranch(st.branches ?? [], (b) => b.name) as branch (branch.name)}
												<!-- The branch keeps its own colour so it stays recognisable
												     down the list; an empty branch is dimmed, not recoloured.
												     branch.qty is already sellable (showroom/demo units already
												     subtracted, Genelog/backend/app/models/product_showroom_unit.py) —
												     branch.unsellable, present only when a deduction applied, is
												     shown alongside so the operator sees why the number is lower
												     than the ERP's raw count. -->
												<span
													class={cn(
														'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
														branch.qty > 0
															? branchStyle(branch.name).chip
															: 'border-muted-foreground/25 text-muted-foreground opacity-60'
													)}
													title={branch.unsellable
														? `${branch.rawQty} في الـ ERP — ${branch.unsellable} غير قابل للبيع (عرض/تالف)`
														: undefined}
												>
													{branchStyle(branch.name).label}
													<span class="font-mono">{branch.qty}</span>
													{#if branch.unsellable}
														<span class="font-mono font-normal opacity-70">(−{branch.unsellable})</span>
													{/if}
												</span>
											{/each}
											<!-- No running total: the per-branch numbers ARE the answer. Only a
											     shortfall earns a chip, because that one changes what the
											     operator does next. -->
											{#if !st.enough}
												<span
													class="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 dark:text-rose-400"
												>
													<AlertTriangle class="size-3" />
													مطلوب {st.needed} — متوفر <span class="font-mono">{st.total}</span>
												</span>
											{/if}
											<!-- Flag ONLY a genuinely different ERP code (recycled-SKU risk):
											     the operator should eyeball the name. A cosmetic difference
											     (case/whitespace, e.g. STAND↔stand) is not flagged. -->
											{#if st.approx}
												<span
													class="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
													title={st.erpName ?? ''}
												>
													مطابقة تقريبية: {st.erpName}
												</span>
											{/if}
										</div>
									{:else if st}
										<div class="text-muted-foreground mt-1.5 ms-[4.25rem] flex items-center gap-1.5 text-[11px]">
											<AlertTriangle class="size-3 shrink-0 text-amber-500" />
											{st.error ?? 'لا توجد بيانات مخزون'}
										</div>
									{:else if stockLoading}
										<!-- Skeletons shaped like the chips that will replace them, so the
										     row does not jump when the numbers land. Widths are staggered
										     per item to read as content rather than a progress bar. -->
										<div class="mt-1.5 ms-[4.25rem] flex flex-wrap items-center gap-1.5">
											{#each [72, 64, 56] as w, k (k)}
												<span
													class="wave inline-block h-[19px] rounded-md"
													style="width:{w - (i % 3) * 6}px; animation-delay:{k * 140}ms"
												></span>
											{/each}
										</div>
									{/if}
								{/if}
							</li>
						{/each}
						</ul>

					<!-- The lines' own arithmetic, closed off against the order total. -->
					<div class="mt-2 space-y-1 border-t pt-2">
						<div class="flex items-center justify-between gap-2 text-sm">
							<span class="font-semibold text-muted-foreground">
								{splitLedger ? 'مجموع المنتجات (جملة)' : 'مجموع المنتجات'}
							</span>
							<span class="font-extrabold tabular-nums">
								<AnimatedNumber value={itemsSubtotal} format={formatPrice} duration={500} /> د.ع
							</span>
						</div>
						{#if discountSaved > 0 && !splitLedger}
							<div class="flex items-center justify-between gap-2 text-xs">
								<span class="flex min-w-0 items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
									<Tag class="size-3 shrink-0" />
									<span class="truncate">{formatDiscountLabel(order.discountCode, null) || 'خصم'}</span>
								</span>
								<span class="font-bold tabular-nums text-amber-700 dark:text-amber-400">
									−<AnimatedNumber value={discountSaved} format={formatPrice} duration={500} /> د.ع
								</span>
							</div>
						{/if}
						<!-- Prepaid: the driver collects nothing. Said plainly, because the
						     alternative is a total of 0 that reads as a missing price and
						     invites an operator to type one in. -->
						{#if noCollection}
							<div class="flex items-center justify-between gap-2 text-xs">
								<span class="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
									<Wallet class="size-3 shrink-0" />
									مدفوع مسبقاً — لا تحصيل عند التسليم
								</span>
							</div>
						{:else if itemsResidual !== 0 && !splitLedger}
							<div class="flex items-center justify-between gap-2 text-xs">
								<span class="text-muted-foreground font-medium">
									{itemsResidual > 0 ? 'توصيل / فرق' : 'فرق'}
								</span>
								<span class="text-muted-foreground font-bold tabular-nums">
									{itemsResidual > 0 ? '+' : '−'}<AnimatedNumber
										value={Math.abs(itemsResidual)}
										format={formatPrice}
										duration={500}
									/> د.ع
								</span>
							</div>
						{/if}
						<!-- The storefront waived delivery: the total is short on purpose, and
						     this is the line where that would otherwise look like an error. -->
						{#if order.freeDelivery}
							<div class="flex items-center justify-between gap-2 text-xs">
								<span class="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
									<Truck class="size-3 shrink-0" />
									توصيل مجاني — من المتجر
								</span>
								<span class="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">0 د.ع</span>
							</div>
						{/if}
						<div class="flex items-center justify-between gap-2 text-sm">
							<span class="font-semibold text-muted-foreground">
								{splitLedger ? 'يُحصّل من زبون الموزع' : 'المجموع الكلي'}
							</span>
							<span class="font-black tabular-nums text-emerald-700 dark:text-emerald-400">
								<AnimatedNumber
									value={Number(order.price) || 0}
									format={formatPrice}
									duration={500}
								/> د.ع
							</span>
						</div>
						<!-- Said once, here, so nobody spends a minute trying to make the two
						     numbers meet. -->
						{#if splitLedger}
							<p class="text-muted-foreground pt-0.5 text-[11px] leading-snug">
								سعر الجملة هو ما يُحاسب عليه الموزع (فاتورة الـERP)، والمبلغ المُحصّل هو سعر الموزع لزبونه — الفرق ربح الموزع، لا توصيل.
							</p>
						{/if}
					</div>

					{#if stockCheckedAt && !stockLoading}
						<div class="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs font-medium">
							<span>آخر تحقق من المخزون:</span>
							<span class="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 font-bold text-foreground ring-1 ring-border/50">
								{formatStockRelative(stockCheckedAt, nowMs)}
							</span>
						</div>
					{/if}
				{/if}
				</div>
				<!-- end products column -->
				<!-- The order's conversation as the third column. It was below the
				     actions footer, then below the split — both left it off the
				     screen until you scrolled for it, and a thread nobody sees is a
				     thread nobody writes in. Beside the products it is simply there
				     when the order opens. It is taller here than it was stacked,
				     because a column has the height to spend. -->
				{#if order?.id}
					<div class="lg:col-span-2 xl:col-span-1">
						<OrderThread submissionId={order.id} heightClass="max-h-44 xl:max-h-[30rem]" />
					</div>
				{/if}
				</div>
				<!-- end column split -->

				<!-- ERP invoice (background job) progress -->
				{#if erpStatus}
					<Separator class="my-3" />
					<div bind:this={erpStripEl}></div>
					{#if erpStatus === 'QUEUED' || erpStatus === 'PROCESSING'}
						<div class="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-sm text-blue-700 dark:text-blue-400">
							<Loader2 class="size-4 animate-spin" />
							<span class="font-semibold">جاري إنشاء فاتورة ERP في الخلفية…</span>
						</div>
					{:else if erpStatus === 'SUCCESS' || erpStatus === 'SETTLED'}
						<button
							type="button"
							onclick={openErpInvoice}
							class="flex w-full items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm font-semibold text-emerald-700 active:opacity-90 dark:text-emerald-400"
						>
							<Receipt class="size-4 shrink-0" />
							<span class="min-w-0 flex-1 text-right">فاتورة ERP جاهزة — فتح</span>
							<!-- Only SETTLED proves the print page was opened and the ERP
							     posted the invoice. A plain SUCCESS had nothing to settle, or
							     predates auto-settling — so it must not make this claim. -->
							{#if erpStatus === 'SETTLED'}
								<span class="shrink-0 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[11px] font-bold text-white dark:bg-emerald-500">
									تم ترحيلها تلقائياً
								</span>
							{/if}
						</button>
					{:else if erpStatus === 'PARTIAL'}
						<!-- The invoice EXISTS but carries no line items. Amber, not red:
						     red reads as "nothing happened", and something did — there is a
						     live empty invoice that has to be filled or voided. No retry
						     button here on purpose: re-running creation would make a second
						     invoice, since nothing keys on the reference. -->
						<button
							type="button"
							onclick={openErpInvoice}
							class="flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm font-semibold text-amber-700 active:opacity-90 dark:text-amber-400"
						>
							<AlertTriangle class="size-4 shrink-0" />
							<span class="min-w-0 flex-1 text-right">فاتورة أُنشئت بدون أصناف — الفاتورة فارغة</span>
							<Receipt class="size-4 shrink-0" />
						</button>
					{:else if erpStatus === 'UNSETTLED'}
						<!-- Invoice created and filled correctly; only the print/settle step
						     did not run, so the ERP has not marked it packed. Links to the
						     invoice edit page — the operator settles it from there. -->
						<button
							type="button"
							onclick={openErpInvoice}
							class="flex w-full items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-sm font-semibold text-sky-700 active:opacity-90 dark:text-sky-400"
						>
							<AlertTriangle class="size-4 shrink-0" />
							<span class="min-w-0 flex-1 text-right">الفاتورة جاهزة لكن غير مرحّلة — افتحها ورحلها</span>
							<Receipt class="size-4 shrink-0" />
						</button>
					{:else if erpStatus === 'FAILED'}
						<div class="flex items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">
							<span class="flex items-center gap-2 font-semibold"><AlertTriangle class="size-4" /> فشل إنشاء فاتورة ERP</span>
							<Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" onclick={retryErp}>
								<RefreshCw class="size-3.5" /> إعادة
							</Button>
						</div>
					{:else if erpStatus === 'CANCELLED'}
						<div class="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
							<Receipt class="size-4 shrink-0" />
							<span class="font-semibold">فاتورة الـERP أُلغيت</span>
						</div>
					{/if}

					<!-- The invoice is real but sits on the wrong debtor: it went to the
					     branch instead of this reseller. Said here rather than left to
					     bookkeeping, because from the ERP side it looks like an ordinary
					     branch invoice. Two causes, and they do not have the same fix: with
					     no ref on the order nobody linked this reseller in Genelog, while a
					     ref that IS there means the link exists on our side and the ERP
					     account no longer carries that mark — telling an operator to link an
					     account they can already see linked sends them nowhere. -->
					{#if order.erpBilledToBranch}
						<div class="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
							<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
							<span>
								{#if order.erpCustomerRef}
									سُجّلت الفاتورة على حساب الفرع لا على حساب {order.resellerName || 'الموزع'} —
									حسابه مربوط في Genelog لكن الـERP لا يعرف علامة الربط ({order.erpCustomerRef})،
									غالباً لأن حساباً آخر أخذها. أعد ربط حسابه من صفحة الموزعين في Genelog.
								{:else}
									سُجّلت الفاتورة على حساب الفرع لا على حساب {order.resellerName || 'الموزع'} —
									اربط حسابه في الـERP من صفحة الموزعين في Genelog لتذهب فواتيره القادمة إليه.
								{/if}
							</span>
						</div>
					{/if}
				{/if}

				<!-- Dropship: the customer is the reseller's, and we never contact them.
				     Stated plainly, because the absence of the confirmation block and
				     the resend button otherwise reads as something being broken. -->
				{#if noCustomerContact}
					<Separator class="my-3" />
					<div class="flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-500/15 px-3 py-2.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
						<MessageCircleOff class="mt-0.5 size-4 shrink-0" />
						<span>لا تُرسل أي رسالة إلى هذا الزبون — طلب دروبشيبنغ، والزبون يخص الموزع. يتابع الموزع حالة الطلب من حسابه.</span>
					</div>
				{/if}

				<!-- Customer WhatsApp confirmation -->
				{#if order.customerConfirmation || canMarkConfirmed}
					<Separator class="my-3" />
					{#if order.customerConfirmation === 'CONFIRMED'}
						<div class="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-700 ring-1 ring-emerald-500/20 ring-inset backdrop-blur-xl dark:text-emerald-400">
							<CircleCheck class="animate-approve-beat size-4 shrink-0" /> أكد الزبون الطلب عبر واتساب
						</div>
					{:else if order.customerConfirmation === 'CANCELLED'}
						<div class="animate-reject-shake flex items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm font-bold text-rose-700 ring-1 ring-rose-500/20 ring-inset backdrop-blur-xl dark:text-rose-400">
							<CircleX class="animate-pop-in size-4 shrink-0" /> ألغى الزبون الطلب عبر واتساب
						</div>
					{:else if order.customerConfirmation === 'NO_RESPONSE'}
						<div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-bold text-amber-700 ring-1 ring-amber-500/20 ring-inset backdrop-blur-xl dark:text-amber-400">
							<div class="flex items-center gap-2">
								<Hourglass class="size-4 shrink-0" />
								<span>لم يرد الزبون على رسالة التأكيد</span>
							</div>
							{#if canMarkConfirmed}
								<button
									type="button"
									onclick={() => { haptic(10); confirmCustomerOpen = true; }}
									class="apple-press inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-600 px-3 text-xs font-bold text-white shadow-xs ring-1 ring-white/25 ring-inset transition-all hover:bg-emerald-500 active:bg-emerald-700"
								>
									<UserCheck class="size-3.5" /> تأكيد يدوياً
								</button>
							{/if}
						</div>
					{:else if order.customerConfirmation}
						<div class="animate-wait-pulse flex flex-col gap-2.5 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm font-bold text-sky-700 ring-1 ring-sky-500/20 ring-inset backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between dark:text-sky-300">
							<div class="flex items-center gap-2">
								<Hourglass class="size-4 shrink-0" />
								<span>بانتظار تأكيد الزبون عبر واتساب</span>
							</div>
							<div class="flex flex-wrap items-center gap-1.5 sm:ms-auto">
								{#if canResendConfirmation}
									<button
										type="button"
										onclick={() => { haptic(10); resendConfirmOpen = true; }}
										disabled={resendingConfirmation}
										class="apple-press inline-flex h-8 items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/20 px-3 text-xs font-bold text-sky-800 ring-1 ring-sky-500/20 ring-inset transition-all hover:bg-sky-500/30 active:opacity-80 disabled:opacity-50 dark:text-sky-200"
									>
										{#if resendingConfirmation}
											<Loader2 class="size-3.5 animate-spin" /> جاري الإرسال…
										{:else}
											<MessageSquarePlus class="size-3.5" /> إعادة إرسال
										{/if}
									</button>
								{/if}
								{#if canMarkConfirmed}
									<button
										type="button"
										onclick={() => { haptic(10); confirmCustomerOpen = true; }}
										class="apple-press inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-600 px-3 text-xs font-bold text-white shadow-xs ring-1 ring-white/25 ring-inset transition-all hover:bg-emerald-500 active:bg-emerald-700"
									>
										<UserCheck class="size-3.5" /> تأكيد الزبون يدوياً
									</button>
								{/if}
							</div>
						</div>
					{:else if canMarkConfirmed}
						<button
							type="button"
							onclick={() => { haptic(10); confirmCustomerOpen = true; }}
							class="apple-press flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-500/20 ring-inset transition-all hover:bg-emerald-500/20 active:opacity-80 dark:text-emerald-400"
						>
							<UserCheck class="size-4" /> تأكيد الزبون يدوياً
						</button>
					{/if}
				{/if}

				<!-- What this customer ordered before. Collapsed: the summary line is
				     the decision ("2 returned"), the orders are the detail. -->
				{#if custHistory?.summary && custHistory.summary.total > 0}
					{@const s = custHistory.summary}
					{@const risky = s.returned + s.cancelled + s.failed}
					<Separator class="my-3" />
					<button
						type="button"
						onclick={() => { haptic(8); historyOpen = !historyOpen; }}
						class="flex w-full items-center gap-2 text-sm font-bold"
					>
						<UserCheck class="size-4 shrink-0" />
						<span class="flex-1 text-right">طلبات الزبون السابقة ({s.total})</span>
						<ChevronRight
							class={cn('size-4 shrink-0 transition-transform', historyOpen && '-rotate-90')}
						/>
					</button>

					<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
						{#if s.completed > 0}
							<span class="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
								{s.completed} مكتمل
							</span>
						{/if}
						{#if s.returned > 0}
							<span class="rounded-md border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 font-bold text-rose-700 dark:text-rose-400">
								{s.returned} راجع
							</span>
						{/if}
						{#if s.cancelled > 0}
							<span class="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
								{s.cancelled} ملغى
							</span>
						{/if}
						{#if s.failed > 0}
							<span class="text-muted-foreground border-muted-foreground/30 rounded-md border px-1.5 py-0.5 font-semibold">
								{s.failed} فاشل
							</span>
						{/if}
						{#if s.totalSpent > 0}
							<span class="text-muted-foreground">
								· اشترى بـ <AnimatedNumber value={Number(s.totalSpent) || 0} format={formatPrice} /> د.ع
							</span>
						{/if}
					</div>

					<!-- A history of refusals is the thing worth interrupting for, since
					     every one of those was a package paid to ship both ways. -->
					{#if risky > 0 && risky >= s.completed}
						<div class="mt-2 flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400">
							<AlertTriangle class="size-3.5 shrink-0" />
							زبون أغلب طلباته لم تكتمل — راجع قبل الإرسال
						</div>
					{/if}

					{#if historyOpen}
						<ul class="mt-2 space-y-2">
							{#each custHistory.orders as h (h.id)}
								{@const hb = statusBadgeProps(h.status)}
								<li class="bg-muted/40 rounded-md p-2 text-xs">
									<div class="flex items-center gap-2">
										<a
											href="{base}/order/{orderSlug(h)}/"
											class="font-mono font-semibold hover:underline"
										>
											{orderLabel(h)}
										</a>
										<span class="rounded-full border px-1.5 py-0.5 text-[10px] font-bold {hb.class}">
											{hb.label}
										</span>
										{#if h.shipmentStatus === 'RETURNED'}
											<span class="rounded-full border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-400">
												راجع
											</span>
										{/if}
										<span class="text-muted-foreground ms-auto whitespace-nowrap">
											{formatCheckedAt(h.createdAt)}
										</span>
									</div>
									<div class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2">
										<span class="font-semibold">{formatPrice(h.price)} د.ع</span>
										{#if h.cityName}<span>· {h.cityName}</span>{/if}
									</div>
									{#if h.items.length}
										<div class="text-muted-foreground mt-1">
											{h.items.map((it) => `${it.name} ×${it.quantity}`).join('، ')}
										</div>
									{/if}
								</li>
							{/each}
							{#if custHistory.summary.total > custHistory.orders.length}
								<li class="text-muted-foreground text-center text-[11px]">
									و {custHistory.summary.total - custHistory.orders.length} طلب أقدم
								</li>
							{/if}
						</ul>
					{/if}
				{/if}

				<!-- History / Audit Trail -->
				{#if order.history && order.history.length > 0}
					<Separator class="my-3" />
					<div class="flex items-center gap-2 text-sm font-bold">
						<History class="size-4" /> سجل الطلب
					</div>
					<ol class="mt-2 space-y-2">
						{#each order.history as entry (entry.id)}
							{@const actionColors: Record<string, string> = {
								APPROVED: 'bg-emerald-500',
								REJECTED: 'bg-rose-500',
								SENT: 'bg-blue-500',
								CREATED: 'bg-zinc-400',
								SAVED: 'bg-amber-500',
								FAILED: 'bg-rose-400',
								RETRIED: 'bg-orange-500',
								PACKED: 'bg-violet-500',
								CALLBACK_RECEIVED: 'bg-sky-500'
							}}
							{@const actionLabels: Record<string, string> = {
								APPROVED: 'موافقة',
								REJECTED: 'رفض',
								SENT: 'إرسال وسيط',
								CREATED: 'إنشاء',
								SAVED: 'تعديل',
								FAILED: 'فشل',
								RETRIED: 'إعادة محاولة',
								PACKED: 'تجهيز',
								CALLBACK_RECEIVED: 'تحديث الحالة'
							}}
							<li class="flex items-start gap-3">
								<div class="mt-1.5 flex flex-col items-center">
									<span class="size-2.5 rounded-full {actionColors[entry.action] ?? 'bg-zinc-400'}"></span>
								</div>
								<div class="flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<span class="text-sm font-semibold">
											{actionLabels[entry.action] ?? entry.action}
										</span>
										{#if entry.changedBy}
											<span class="text-muted-foreground text-xs">
												— {entry.changedBy.name}
											</span>
										{/if}
									</div>
									{#if entry.note && stripEmoji(entry.note)}
										<p class="text-muted-foreground mt-0.5 text-xs">{stripEmoji(entry.note)}</p>
									{/if}
									{#each formatHistoryChanges(entry.changes) as line}
										<p class="text-muted-foreground mt-0.5 text-xs">{line}</p>
									{/each}
									<p class="text-muted-foreground mt-0.5 text-xs" dir="ltr">
										{formatDateTime(entry.createdAt)}
									</p>
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			</div>

			<!-- Floating Apple Liquid Glass Action Dock Island -->
			<div class="sticky bottom-2 z-30 mx-3 my-2 pointer-events-auto" style="padding-bottom: max(0.25rem, env(safe-area-inset-bottom));">
				<div class="rounded-3xl border border-black/[0.08] bg-white/85 p-3 shadow-[0_12px_44px_-6px_rgba(0,0,0,0.16),0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-white/80 ring-inset backdrop-blur-3xl backdrop-saturate-200 dark:border-white/[0.14] dark:bg-[#18181c]/88 dark:shadow-[0_16px_50px_-8px_rgba(0,0,0,0.6),0_6px_20px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:ring-white/[0.10]">
					{#if order?.customerConfirmation === 'CANCELLED' && (isPending || canPack || canSendNoItems)}
						<!-- Sits right on the action dock, not just in the confirmation
						     section further up the page — the op is looking at THIS row
						     the moment before tapping تجهيز/إرسال, which is exactly the
						     moment this has to land. -->
						<div class="animate-reject-shake mb-3 flex items-center gap-2 rounded-2xl border-2 border-rose-500/50 bg-rose-500/15 p-3 text-sm font-extrabold text-rose-700 ring-1 ring-rose-500/25 ring-inset dark:text-rose-300">
							<CircleX class="animate-pop-in size-5 shrink-0" />
							<span>⚠️ الزبون ألغى الطلب — لا ترسله للوسيط أو المندوب</span>
						</div>
					{/if}
					{#if rejectOpen}
						<div class="mb-3 space-y-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 ring-1 ring-rose-500/20 ring-inset backdrop-blur-xl">
							<div class="flex items-center justify-between">
								<span class="text-xs font-extrabold text-rose-700 dark:text-rose-300">سبب الرفض <span class="text-rose-500">* (إجباري)</span></span>
								<span class="text-[11px] text-muted-foreground">اختر سبباً أو اكتب</span>
							</div>
							<!-- Quick reason pills -->
							<div class="flex flex-wrap gap-1.5">
								{#each ['طلب إلغاء من الزبون', 'مكرر', 'الرقم مغلق / لا يرد', 'تغيير بالطلب', 'نفذ المخزون', 'خارج التغطية'] as r}
									<button
										type="button"
										class="apple-press rounded-full border border-rose-500/30 bg-background/80 px-2.5 py-1 text-[11px] font-bold text-rose-700 shadow-xs hover:bg-rose-500/20 active:scale-95 dark:text-rose-300 transition-all"
										onclick={() => {
											rejectReason = r;
											rejectInputEl?.focus();
										}}
									>
										{r}
									</button>
								{/each}
							</div>
							<Textarea
								bind:ref={rejectInputEl}
								bind:value={rejectReason}
								placeholder="اكتب سبب الرفض هنا…"
								rows={2}
								class="rounded-xl border-rose-500/30 bg-background/90 text-sm focus:border-rose-500 focus:ring-rose-500/30"
							/>
							<Button
								class="apple-press h-11 w-full rounded-xl border border-rose-400/30 bg-rose-600 text-sm font-bold text-white shadow-[0_4px_16px_rgba(225,29,72,0.35)] ring-1 ring-white/25 ring-inset transition-all hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50"
								onclick={doReject}
								disabled={submitting || !rejectReason.trim()}
							>
								{#if submitting}
									<Loader2 class="size-4 animate-spin" /> جاري الرفض…
								{:else}
									<CircleX class="size-4" /> تأكيد الرفض
								{/if}
							</Button>
						</div>
					{/if}

					{#if isPending}
						<div class="grid grid-cols-3 gap-2">
							<Button
								class="apple-press h-13 flex-col gap-1 rounded-2xl border border-rose-500/30 bg-rose-500/15 text-xs font-bold text-rose-700 ring-1 ring-rose-500/10 ring-inset transition-all hover:bg-rose-500/25 active:bg-rose-500/35 dark:text-rose-300 sm:text-sm [&_svg]:size-5"
								onclick={toggleReject}
							>
								<X /> رفض
							</Button>
							<Button
								variant="outline"
								class="apple-press h-13 flex-col gap-1 rounded-2xl border border-border/60 bg-secondary/70 text-xs font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] ring-1 ring-white/10 ring-inset backdrop-blur-md transition-all hover:bg-secondary/90 active:bg-secondary dark:ring-white/10 sm:text-sm [&_svg]:size-5"
								onclick={() => { haptic(12); editOpen = true; }}
							>
								<Edit3 /> تعديل
							</Button>
							<Button
								class="apple-press h-13 flex-col gap-1 rounded-2xl border border-emerald-400/30 bg-emerald-600 text-xs font-bold text-white shadow-[0_4px_20px_rgba(16,185,129,0.4)] ring-1 ring-white/25 ring-inset transition-all hover:bg-emerald-500 active:bg-emerald-700 sm:text-sm [&_svg]:size-5"
								onclick={() => { haptic(15); void doApprove(); }}
								disabled={submitting}
							>
								<Check /> موافقة
							</Button>
						</div>
					{:else}
						<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
							<Button
								variant="outline"
								class="apple-press h-13 flex-col gap-1 rounded-2xl border border-border/60 bg-secondary/70 text-xs font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] ring-1 ring-white/10 ring-inset backdrop-blur-md transition-all hover:bg-secondary/90 active:bg-secondary dark:ring-white/10 sm:text-sm [&_svg]:size-5"
								onclick={() => { haptic(12); editOpen = true; }}
							>
								<Edit3 /> تعديل
							</Button>
							{#if canPack}
								<Button
									class="apple-press h-13 flex-col gap-1 rounded-2xl border border-emerald-400/30 bg-emerald-600 text-xs font-bold text-white shadow-[0_4px_20px_rgba(16,185,129,0.4)] ring-1 ring-white/25 ring-inset transition-all hover:bg-emerald-500 active:bg-emerald-700 sm:text-sm [&_svg]:size-5"
									onclick={() => { haptic(12); packOpen = true; }}
								>
									<Box /> تجهيز
								</Button>
							{/if}
							{#if canSendNoItems}
								<Button
									class="apple-press h-13 flex-col gap-1 rounded-2xl border border-emerald-400/30 bg-emerald-600 text-xs font-bold text-white shadow-[0_4px_20px_rgba(16,185,129,0.4)] ring-1 ring-white/25 ring-inset transition-all hover:bg-emerald-500 active:bg-emerald-700 sm:text-sm [&_svg]:size-5"
									onclick={() => { haptic(12); packConfirmDirect = true; }}
								>
									<Truck /> إرسال
								</Button>
							{/if}
							{#if canCancel}
								<Button
									class="apple-press h-13 flex-col gap-1 rounded-2xl border border-rose-500/30 bg-rose-500/15 text-xs font-bold text-rose-700 ring-1 ring-rose-500/10 ring-inset transition-all hover:bg-rose-500/25 active:bg-rose-500/35 dark:text-rose-300 sm:text-sm [&_svg]:size-5"
									onclick={openCancel}
								>
									<X /> إلغاء
								</Button>
							{/if}
							{#if erpUrl}
								<Button
									variant="outline"
									class="apple-press h-13 flex-col gap-1 rounded-2xl border border-border/60 bg-secondary/70 text-xs font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] ring-1 ring-white/10 ring-inset backdrop-blur-md transition-all hover:bg-secondary/90 active:bg-secondary dark:ring-white/10 sm:text-sm [&_svg]:size-5"
									onclick={openErpInvoice}
								>
									<LinkIcon /> فاتورة ERP
								</Button>
							{:else if erpStatus === 'QUEUED' || erpStatus === 'PROCESSING'}
								<Button
									variant="outline"
									disabled
									class="animate-wait-pulse h-13 flex-col gap-1 rounded-2xl border border-sky-500/40 bg-sky-500/15 text-xs font-bold text-sky-700 ring-1 ring-sky-500/15 ring-inset disabled:opacity-90 dark:text-sky-300 sm:text-sm [&_svg]:size-5"
								>
									<Loader2 class="animate-spin" /> ERP قيد الإنشاء
								</Button>
							{/if}
							{#if hasTracking}
								<!-- Opens the receipt PDF in a tab (does not print). Gated on
								     having a tracking number, not on qrLink: the receipt is
								     fetched by tracking number now, and qrLink is a dead URL
								     kept only for the record. -->
								<Button
									variant="outline"
									class="apple-press h-13 flex-col gap-1 rounded-2xl border border-border/60 bg-secondary/70 text-xs font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] ring-1 ring-white/10 ring-inset backdrop-blur-md transition-all hover:bg-secondary/90 active:bg-secondary dark:ring-white/10 sm:text-sm [&_svg]:size-5"
									onclick={printReceipt}
								>
									<Receipt /> عرض الوصل
								</Button>
							{/if}
							{#if hasTracking && !isStickerOrder}
								<!-- Sends a print job to the physical printer via the print agent.
								     Two taps: the first turns this into the question, the second
								     prints. See doReprint. -->
								<Button
									variant="outline"
									aria-label={reprintArmed ? 'تأكيد طباعة الوصل' : 'طباعة الوصل'}
									class={cn(
										'apple-press h-13 flex-col gap-1 rounded-2xl border text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)] ring-1 ring-inset backdrop-blur-md transition-all sm:text-sm [&_svg]:size-5',
										reprintArmed
											// The dark: variants are not redundant: the outline button
											// carries its own dark:bg-input/30, which twMerge keeps
											// (different variant prefix) and which then wins in dark
											// mode — leaving the armed state looking like the resting one.
											? 'border-sky-600 bg-sky-600 text-white ring-sky-400/30 hover:bg-sky-600 active:bg-sky-700 dark:border-sky-600 dark:bg-sky-600 dark:hover:bg-sky-600 dark:active:bg-sky-700'
											: 'border-border/60 bg-secondary/70 text-foreground ring-white/10 hover:bg-secondary/90 active:bg-secondary dark:ring-white/10'
									)}
									onclick={doReprint}
								>
									<Printer /> {reprintArmed ? 'تأكيد الطباعة؟' : 'طباعة الوصل'}
								</Button>
							{/if}
							{#if canRelink}
								<!-- Printerless sticker order: rebind to a fresh preprinted
								     sticker when the original label is damaged or lost. -->
								<Button
									variant="outline"
									class="apple-press h-13 flex-col gap-1 rounded-2xl border border-border/60 bg-secondary/70 text-xs font-bold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] ring-1 ring-white/10 ring-inset backdrop-blur-md transition-all hover:bg-secondary/90 active:bg-secondary dark:ring-white/10 sm:text-sm [&_svg]:size-5"
									onclick={openRelink}
								>
									<ScanLine /> ملصق بديل
								</Button>
							{/if}
							{#if canCarrierCancel}
								<!-- App/sticker order: delete it at Alwaseet only (local status
								     stays as-is). -->
								<Button
									variant="outline"
									class="apple-press h-13 flex-col gap-1 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-xs font-bold text-rose-700 ring-1 ring-rose-500/15 ring-inset backdrop-blur-md transition-all hover:bg-rose-500/20 active:bg-rose-500/25 dark:text-rose-300 sm:text-sm [&_svg]:size-5"
									onclick={() => (carrierCancelOpen = true)}
								>
									<Trash2 /> حذف من الوسيط
								</Button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<EditPanel
		{order}
		bind:open={editOpen}
		onClose={() => (editOpen = false)}
		onSaved={handleSavedFromEdit}
		{cities}
	/>

	<PackingPanel
		{order}
		bind:open={packOpen}
		bind:confirmOnly={packConfirmDirect}
		onClose={() => (packOpen = false)}
		onPacked={handlePacked}
		onGoToHistory={() => jumpTo('history')}
	/>

	{#if viewerSrc}
		<ImageViewer src={viewerSrc} origin={viewerOrigin} onClose={() => (viewerSrc = null)} />
	{/if}

	<!-- Re-link to a fresh preprinted sticker (damaged/lost label) -->
	<Dialog bind:open={relinkOpen}>
		<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
			<DialogHeader>
				<DialogTitle class="text-right font-bold">ربط ملصق بديل</DialogTitle>
			</DialogHeader>
			<p class="text-muted-foreground text-xs leading-relaxed">
				سيُلغى الطلب القديم أولاً ثم يُنشأ طلب جديد على الملصق البديل. رقم التتبع سيتغيّر ولا يمكن التراجع.
			</p>

			<!-- Check: current bound order's live state before replacing it -->
			<div class="rounded-lg border bg-muted/30 p-2.5 text-center text-xs">
				<span class="text-muted-foreground">الطلب الحالي</span>
				<span class="font-bold tabular-nums">{order?.shipment?.trackingNumber}</span>:
				{#if oldCheck.loading}
					<span class="text-muted-foreground">جاري الفحص…</span>
				{:else if oldCheck.active}
					<span class="font-semibold text-emerald-600 dark:text-emerald-400">فعّال</span>
					<span class="text-muted-foreground">— سيُلغى عند الربط</span>
				{:else if oldCheck.found}
					<span class="font-semibold text-muted-foreground">{oldCheck.status || 'غير فعّال'}</span>
				{:else}
					<span class="text-muted-foreground">تعذّر الفحص</span>
				{/if}
			</div>

			<!-- Step 1: check — scan/type a fresh sticker; the scanner validates it -->
			<StickerScanner onValid={(id) => (relinkId = id)} onReset={() => (relinkId = '')} />

			<!-- Step 2: confirm — spell out old → new before the irreversible bind -->
			{#if relinkId}
				<div class="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-center">
					<p class="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
						<AlertTriangle class="size-3.5" /> تأكيد الاستبدال
					</p>
					<p class="text-[11px] tabular-nums">
						<span class="text-muted-foreground line-through">{order?.shipment?.trackingNumber}</span>
						<span class="mx-1">←</span>
						<span class="font-bold">{relinkId}</span>
					</p>
				</div>
			{/if}
			<DialogFooter class="grid grid-cols-2 gap-2">
				<Button
					variant="outline"
					class="h-11 font-semibold"
					onclick={() => { relinkId = ''; relinkOpen = false; }}
					disabled={relinking}
				>
					إلغاء
				</Button>
				<Button
					class="h-11 font-semibold"
					disabled={relinking || !relinkId}
					onclick={() => { haptic(15); void doRelink(); }}
				>
					{relinking ? '…' : relinkId ? `تأكيد الربط بـ ${relinkId}` : 'امسح الملصق'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>

	<!-- Operator Note Dialog -->
	<Dialog bind:open={noteOpen}>
		<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
			<DialogHeader>
				<DialogTitle class="text-right font-bold">{noteEditIndex !== null ? 'تعديل ملاحظة' : 'إضافة ملاحظة'}</DialogTitle>
			</DialogHeader>
			{#if noteEditIndex === null && opNoteText}
				<div class="max-h-32 overflow-y-auto rounded-md border bg-muted/40 p-2">
					<p class="text-muted-foreground mb-1 text-[11px] font-bold">الملاحظات السابقة</p>
					<p class="text-muted-foreground whitespace-pre-wrap text-xs leading-relaxed">
						{opNoteText}
					</p>
				</div>
			{/if}
			<Textarea
				bind:value={noteDraft}
				placeholder={noteEditIndex !== null ? 'عدّل نص الملاحظة' : 'اكتب ملاحظة جديدة — تُضاف إلى الملاحظات السابقة'}
				rows={4}
				class="text-sm"
			/>
			<DialogFooter class="grid grid-cols-2 gap-2">
				<Button
					variant="outline"
					class="h-11 font-semibold"
					onclick={() => (noteOpen = false)}
					disabled={noteSaving}
				>
					إلغاء
				</Button>
				<Button
					class="h-11 font-semibold"
					onclick={saveNote}
					disabled={noteSaving || !noteDraft.trim()}
				>
					{noteSaving ? '…' : 'حفظ'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>

	<!-- Tracking-status override (ADMIN) -->
	<Dialog bind:open={trackOverrideOpen}>
		<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
			<DialogHeader>
				<DialogTitle class="text-right font-bold">تعديل حالة التتبع يدوياً</DialogTitle>
			</DialogHeader>
			<p class="text-muted-foreground text-xs leading-relaxed">
				الحالة المحددة تظهر للزبون في صفحة التتبع وتتجاوز حالة الوسيط المباشرة. اتركها فارغة أو اضغط «إرجاع للتلقائي» للعودة لحالة الوسيط.
			</p>
			<div class="flex flex-wrap gap-1.5">
				{#each TRACK_OVERRIDE_PRESETS as preset (preset)}
					<button
						type="button"
						onclick={() => (trackOverrideDraft = preset)}
						class={cn(
							'rounded-md border px-2 py-1 text-xs font-semibold transition-colors',
							trackOverrideDraft === preset
								? 'border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-300'
								: 'border-border hover:bg-accent'
						)}
					>
						{preset}
					</button>
				{/each}
			</div>
			<Input bind:value={trackOverrideDraft} placeholder="أو اكتب حالة مخصصة…" class="text-sm" />
			<DialogFooter class="grid grid-cols-2 gap-2">
				<Button
					variant="outline"
					class="h-11 font-semibold"
					onclick={() => saveTrackOverride(null)}
					disabled={trackOverrideSaving || !order?.shipment?.trackingStatusOverride}
				>
					إرجاع للتلقائي
				</Button>
				<Button
					class="h-11 font-semibold"
					onclick={() => saveTrackOverride(trackOverrideDraft)}
					disabled={trackOverrideSaving || !trackOverrideDraft.trim()}
				>
					{trackOverrideSaving ? '…' : 'حفظ'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>

	<!-- Cancel confirm (APPROVED/PACKED → CANCELLED) -->
	<!-- Settle confirm: the figure is the whole point, so it is the biggest thing
	     in the dialog. Covers every unsettled order the driver holds. -->
	<Dialog bind:open={settleConfirmOpen}>
		<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
			<DialogHeader>
				<DialogTitle class="text-center text-lg font-bold">تسوية حساب المندوب</DialogTitle>
			</DialogHeader>
			<div class="space-y-1 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-center">
				<div class="text-xs font-bold text-cyan-800 dark:text-cyan-200">
					استلمت من {order?.shipment?.localDriverName || 'المندوب'}
				</div>
				<div class="text-4xl font-black tabular-nums text-cyan-800 dark:text-cyan-100">
					{formatPrice(localNet)}
					<span class="text-base font-bold">د.ع</span>
				</div>
				<div class="text-[11px] font-bold text-cyan-800/70 dark:text-cyan-200/70">
					مبلغ هذا الطلب وحده ({formatPrice(order?.price ?? 0)} − {formatPrice(localFee)} أجرة)
				</div>
			</div>
			{#if !localDelivered}
				<!-- Cash back IS the delivery: say plainly that confirming moves the
				     order to تم التسليم on the customer's tracking page too. -->
				<p class="rounded-xl bg-amber-500/10 px-3 py-2 text-center text-xs font-bold text-amber-700 dark:text-amber-400">
					هذا الطلب قيد التوصيل — سيُعلَّم «تم التسليم للزبون» عند التأكيد
				</p>
			{/if}
			{#if driverPending > 0 || (driverOwed ?? 0) > localNet}
				<p class="text-muted-foreground rounded-xl bg-muted/60 px-3 py-2 text-center text-[11px] font-bold">
					بذمة المندوب {formatPrice(driverOwed ?? 0)} د.ع على طلبات أخرى — تُسوّى من صفحة
					المندوبين
				</p>
			{/if}
			<p class="text-muted-foreground text-center text-xs leading-relaxed">
				تُسوّى هنا مبالغ هذا الطلب فقط. لا يمكن التراجع إلا من صفحة المندوبين.
			</p>
			<DialogFooter class="flex-row gap-2">
				<Button
					variant="outline"
					class="h-11 flex-1 font-bold"
					onclick={() => (settleConfirmOpen = false)}
				>
					إلغاء
				</Button>
				<Button
					class="h-11 flex-1 bg-cyan-600 font-bold text-white hover:bg-cyan-700"
					disabled={settling || !canSettleOrder}
					onclick={() => void settleDriver()}
				>
					{settling ? '…' : 'تأكيد الاستلام'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>

	<Dialog bind:open={cancelOpen}>
		<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
			<DialogHeader>
				<DialogTitle class="text-center text-lg font-bold">إلغاء الطلب</DialogTitle>
			</DialogHeader>
			<p class="text-muted-foreground text-center text-sm">
				سيتم نقل الطلب إلى «سابقة» بحالة «ملغى»
			</p>
			{#if cancelHitsCarrier}
				<p class="flex items-start justify-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-center text-xs font-semibold text-amber-700 dark:text-amber-400">
					<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
					سيُحذف الطلب من الوسيط أيضاً. إن كان المندوب قد استلمه فلن يُحذف — احذفه يدوياً من تطبيق الوسيط.
				</p>
			{:else if carrierReceived}
				<!-- The carrier already picked it up — a delete no longer works, so this
				     cancel is purely local and may never take effect at Alwaseet. -->
				<div class="space-y-1.5 rounded-2xl border-2 border-red-500 bg-red-500/10 p-4 text-center">
					<div class="flex items-center justify-center gap-2 text-base font-extrabold text-red-700 dark:text-red-300">
						<AlertTriangle class="size-5 shrink-0" /> الوسيط استلم الطلب بالفعل
					</div>
					<p class="text-sm font-bold leading-relaxed text-red-700 dark:text-red-300">
						لا يمكن حذفه من الوسيط الآن. الإلغاء هنا <span class="underline">محلي فقط</span> —
						الطلب قد يبقى فعّالاً لدى الوسيط وربما يُسلَّم فعلاً. تابعه يدوياً.
					</p>
				</div>
			{/if}
			{#if hasCancellableInvoice}
				<div class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
					<div class="min-w-0">
						<p class="text-sm font-semibold">إلغاء فاتورة الـERP أيضاً</p>
						<p class="text-muted-foreground text-xs leading-relaxed">
							يُلغي الفاتورة ويُعيد المخزون — أوقفه إن كنت تريد إصلاح الفاتورة يدوياً بدلاً من إلغائها.
						</p>
					</div>
					<Switch bind:checked={cancelInvoiceToo} />
				</div>
			{/if}
			<!-- Quick reasons — one tap fills the box; still editable after. -->
			<div class="flex flex-wrap justify-center gap-1.5">
				{#each CANCEL_REASONS as r (r)}
					<button
						type="button"
						onclick={() => { cancelReason = r; haptic(8); }}
						class={cn(
							'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
							cancelReason === r
								? 'border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-300'
								: 'border-border text-muted-foreground hover:bg-muted'
						)}
					>
						{r}
					</button>
				{/each}
			</div>
			<Textarea
				bind:value={cancelReason}
				placeholder="سبب الإلغاء…"
				rows={3}
				class="text-sm"
			/>
			<DialogFooter class="grid grid-cols-2 gap-2">
				<Button
					variant="outline"
					class="h-12 text-base font-bold"
					onclick={() => (cancelOpen = false)}
					disabled={cancelSaving}
				>
					رجوع
				</Button>
				<Button
					class="h-12 bg-rose-600 text-base font-bold text-white hover:bg-rose-700"
					onclick={() => { haptic(15); void doCancel(); }}
					disabled={cancelSaving || !cancelReason.trim()}
				>
					{cancelSaving ? '…' : carrierReceived ? 'إلغاء محلي فقط' : 'تأكيد الإلغاء'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>

	<!-- Delete at Alwaseet only (app/sticker order) — local status untouched -->
	<Dialog bind:open={carrierCancelOpen}>
		<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
			<DialogHeader>
				<DialogTitle class="text-center text-lg font-bold">حذف الطلب من الوسيط</DialogTitle>
			</DialogHeader>
			<p class="text-muted-foreground text-center text-sm leading-relaxed">
				سيُلغى الطلب في نظام الوسيط فقط (لن يستلمه المندوب). حالة الطلب هنا لن تتغيّر
				— عدّلها يدوياً إن لزم. لا يمكن التراجع.
			</p>
			{#if order?.shipment?.alwaseetOrderId}
				<p class="text-center text-sm font-bold tabular-nums" dir="ltr">
					#{order.shipment.alwaseetOrderId}
				</p>
			{/if}
			<DialogFooter class="grid grid-cols-2 gap-2">
				<Button
					variant="outline"
					class="h-12 text-base font-bold"
					onclick={() => (carrierCancelOpen = false)}
					disabled={carrierCancelling}
				>
					رجوع
				</Button>
				<Button
					class="h-12 bg-rose-600 text-base font-bold text-white hover:bg-rose-700"
					onclick={() => { haptic(15); void doCarrierCancel(); }}
					disabled={carrierCancelling}
				>
					{carrierCancelling ? '…' : 'حذف من الوسيط'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>

	<!-- Manual customer confirmation (OPERATOR + ADMIN) -->
	<Dialog bind:open={confirmCustomerOpen}>
		<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
			<DialogHeader>
				<DialogTitle class="text-center text-lg font-bold">تأكيد الزبون يدوياً</DialogTitle>
			</DialogHeader>
			<p class="text-muted-foreground text-center text-sm leading-relaxed">
				سجّل أن الزبون أكد الطلب (اتصال هاتفي أو رد مباشر). لن تُرسل رسالة التأكيد
				عبر واتساب مرة أخرى لهذا الطلب.
			</p>
			<DialogFooter class="grid grid-cols-2 gap-2">
				<Button
					variant="outline"
					class="h-12 text-base font-bold"
					onclick={() => (confirmCustomerOpen = false)}
					disabled={confirmingCustomer}
				>
					رجوع
				</Button>
				<Button
					class="h-12 bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700"
					onclick={() => { haptic(15); void markCustomerConfirmed(); }}
					disabled={confirmingCustomer}
				>
					{confirmingCustomer ? '…' : 'تأكيد'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>

	<!-- Resend confirmation. Not a one-tap action: it messages a real customer and
	     throws away whatever answer they already gave. -->
	<Dialog bind:open={resendConfirmOpen}>
		<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
			<DialogHeader>
				<DialogTitle class="text-center text-lg font-bold">إعادة إرسال رسالة التأكيد</DialogTitle>
			</DialogHeader>
			<p class="text-muted-foreground text-center text-sm leading-relaxed">
				سترسل للزبون رسالة جديدة بتفاصيل الطلب الحالية عبر واتساب.
			</p>
			{#if order?.customerConfirmation === 'CONFIRMED' || order?.customerConfirmation === 'CANCELLED'}
				<p
					class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-sm font-semibold text-amber-700 dark:text-amber-400"
				>
					⚠️ سيُلغى رد الزبون السابق ({order.customerConfirmation === 'CONFIRMED'
						? 'أكد الطلب'
						: 'ألغى الطلب'}) وسيعود الطلب بانتظار رده من جديد.
				</p>
			{/if}
			<DialogFooter class="grid grid-cols-2 gap-2">
				<Button
					variant="outline"
					class="h-12 text-base font-bold"
					onclick={() => (resendConfirmOpen = false)}
					disabled={resendingConfirmation}
				>
					رجوع
				</Button>
				<Button
					class="h-12 bg-sky-600 text-base font-bold text-white hover:bg-sky-700"
					onclick={() => { haptic(15); void resendConfirmation(); }}
					disabled={resendingConfirmation}
				>
					{resendingConfirmation ? '…' : 'إرسال'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>

	<!-- Approve Modal -->
	<!-- Manual Status Override (ADMIN only) -->
	{#if isAdmin}
		<Dialog bind:open={statusOpen}>
			<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
				<DialogHeader>
					<DialogTitle class="text-center text-lg font-bold">تغيير حالة الطلب</DialogTitle>
				</DialogHeader>
				<p class="text-muted-foreground text-center text-sm">
					الحالة الحالية: <span class="font-bold">{getStatusLabel(order?.status)}</span>
				</p>
				<div class="grid grid-cols-2 gap-2">
					{#each MANUAL_STATUSES as s (s)}
						{@const active = order?.status === s}
						<button
							type="button"
							disabled={statusSaving || active}
							onclick={() => { haptic(12); void doSetStatus(s); }}
							class={cn(
								'flex h-12 items-center justify-center rounded-xl border-2 text-sm font-bold transition-colors',
								active
									? 'border-primary bg-primary/10 text-primary cursor-default'
									: 'border-border text-foreground hover:border-primary/60 active:opacity-70'
							)}
						>
							{getStatusLabel(s)}
						</button>
					{/each}
				</div>
				<Separator />
				<button
					type="button"
					class="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-rose-500/50 bg-rose-500/10 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-400"
					onclick={() => { haptic(12); deleteWordInput = ''; statusOpen = false; deleteOpen = true; }}
				>
					<Trash2 class="size-4" /> حذف الطلب نهائياً
				</button>
				<DialogFooter>
					<Button
						variant="outline"
						class="h-11 w-full font-semibold"
						onclick={() => (statusOpen = false)}
						disabled={statusSaving}
					>
						إغلاق
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>

		<!-- Hard delete: type-to-confirm -->
		<Dialog bind:open={deleteOpen}>
			<DialogContent class="max-w-sm gap-4 rounded-3xl border border-border/60 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl">
				<DialogHeader>
					<DialogTitle class="text-center text-lg font-bold text-rose-600 dark:text-rose-400">
						حذف الطلب نهائياً
					</DialogTitle>
				</DialogHeader>
				<p class="text-muted-foreground text-center text-sm">
					سيُحذف الطلب وكل سجلاته نهائياً — لا يمكن التراجع.
					<br />اكتب الكلمة التالية للمتابعة:
				</p>
				<div class="flex items-center justify-center gap-2">
					<span class="rounded-md border px-3 py-1 text-lg font-bold tracking-wide select-all">{DELETE_WORD}</span>
					<Button
						variant="outline"
						size="sm"
						class="h-8 gap-1 px-2 text-xs"
						onclick={() => doCopy(DELETE_WORD)}
					>
						<Copy class="size-3" /> نسخ
					</Button>
				</div>
				<Input bind:value={deleteWordInput} placeholder="اكتب الكلمة هنا…" class="text-center font-bold" />
				<DialogFooter class="grid grid-cols-2 gap-2">
					<Button
						variant="outline"
						class="h-12 text-base font-bold"
						onclick={() => (deleteOpen = false)}
						disabled={deleting}
					>
						رجوع
					</Button>
					<Button
						class="h-12 bg-rose-600 text-base font-bold text-white hover:bg-rose-700"
						onclick={() => { haptic(15); void doDelete(); }}
						disabled={deleting || deleteWordInput.trim() !== DELETE_WORD}
					>
						{deleting ? '…' : 'حذف نهائي'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	{/if}
{/if}

<style>
	/* Shimmer used for the ERP stock placeholders. The sweep runs right-to-left
	   to match the RTL reading direction — transforms ignore `dir`, so it has to
	   be done in the keyframes rather than left to the layout. */
	:global(.wave) {
		position: relative;
		overflow: hidden;
		background-color: color-mix(in oklab, currentColor 10%, transparent);
	}

	:global(.wave::after) {
		content: '';
		position: absolute;
		inset: 0;
		transform: translateX(100%);
		background-image: linear-gradient(
			90deg,
			transparent,
			color-mix(in oklab, currentColor 16%, transparent),
			transparent
		);
		animation: stock-wave 1.3s ease-in-out infinite;
	}

	@keyframes stock-wave {
		to {
			transform: translateX(-100%);
		}
	}

	/* Respect the OS setting: hold a steady tint instead of sweeping. */
	@media (prefers-reduced-motion: reduce) {
		:global(.wave::after) {
			animation: none;
			transform: none;
			background-image: none;
		}
	}
</style>
