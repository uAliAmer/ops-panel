<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Building2, MapPin, Package, CircleDollarSign, FileText, StickyNote, Tag, Loader2, AlertTriangle, CircleCheck, CircleX, Hourglass, Phone, X, Truck, MessageSquare, AtSign, Pin } from '@lucide/svelte';
	import { erpAlertLabel, isErpAlertDismissed, dismissErpAlert } from '$lib/utils/erpAlert';
	import WhatsAppIcon from '$lib/components/WhatsAppIcon.svelte';
	import { formatPrice, formatPieces, formatCardDate, displayNotes, displayOpNotes, parseOpNotes } from '$lib/utils/format';
	import { statusDotClass, statusBadgeProps } from '$lib/utils/status';
	import { whatsappHref } from '$lib/utils/phone';
	import { isVagueRegion } from '$lib/utils/region';
	import { isWholesaleOrder, orderSource } from '$lib/utils/source';
	import { customerTier } from '$lib/utils/customerTier';
	import { resolveImage } from '$lib/utils/image';
	import OrderQuickActions from './OrderQuickActions.svelte';
	import { cn } from '$lib/utils';
	import type { Order } from '$lib/api';

	type Props = {
		order: Order;
		onclick?: () => void;
		onQuickActionDone?: (movedTo?: 'approved' | 'history') => void;
		/** Jump the list to a tab (toast "عرض" action on quick approve/reject). */
		onGoToTab?: (tab: 'approved' | 'history') => void;
		/** Highlight as the active row in the desktop master–detail split. */
		selected?: boolean;
		/** Show a status label badge — for mixed-status contexts (search, history). */
		showStatus?: boolean;
		/** Newly arrived order from socket or polling. */
		fresh?: boolean;
	};
	let { order, onclick, onQuickActionDone, onGoToTab, selected = false, showStatus = false, fresh = false }: Props = $props();

	// ERP invoice problems that need a person: blink on the card until dismissed.
	const erpAlert = $derived(erpAlertLabel(order.erpInvoiceStatus));
	// Seeded from the stored dismissal, then flipped locally on dismiss. Keyed by
	// status too, so a NEW problem on the same order alerts again.
	let erpAlertHidden = $state(false);
	$effect(() => {
		erpAlertHidden = isErpAlertDismissed(order.id, order.erpInvoiceStatus);
	});

	const isPending = $derived(order.status === 'PENDING_REVIEW' || order.status === 'FAILED');
	// An own-driver order still sitting with the driver: the card offers the one
	// move it has (خرج للتوصيل) the same way a pending order offers approve.
	const isLocalAssigned = $derived(
		order.shipment?.carrierMethod === 'LOCAL' &&
			order.status === 'SENT_TO_CARRIER' &&
			order.shipment?.alwaseetStatusName === 'تم الاستلام من قبل المندوب'
	);
	// «اخرى» mis-routes at Alwaseet — flag it while the order can still be fixed.
	const vagueRegion = $derived(
		isVagueRegion(order.regionName) && !order.shipment?.trackingNumber
	);
	// Contact shortcut: prefer a number known to have WhatsApp (flags are stored
	// per number at ingest; null = unchecked, treated as "probably has it"). When
	// every number is known NOT to have WhatsApp, fall back to a tel: call link.
	//
	// On a dropship order the button POINTS SOMEWHERE ELSE rather than
	// disappearing. The end customer belongs to the reseller and must not hear
	// from us, but an operator still needs someone to call about a damaged parcel
	// — and that someone is the reseller. Removing the button would leave the
	// most reflexive action on the card either absent or, worse, still aimed at
	// a person who must not be contacted.
	const contact = $derived.by(() => {
		if (order.suppressCustomerContact) {
			return order.resellerPhone
				? { num: order.resellerPhone, mode: 'wa' as const, who: 'reseller' as const }
				: null;
		}
		const nums: Array<[string, boolean | null | undefined]> = [];
		if (order.customerPhone) nums.push([order.customerPhone, order.customerPhoneHasWa]);
		if (order.customerPhone2) nums.push([order.customerPhone2, order.customerPhone2HasWa]);
		if (!nums.length) return null;
		const wa = nums.find(([, has]) => has !== false);
		return wa
			? { num: wa[0], mode: 'wa' as const, who: 'customer' as const }
			: { num: nums[0][0], mode: 'tel' as const, who: 'customer' as const };
	});
	const contactWho = $derived(contact?.who === 'reseller' ? 'الموزع' : 'الزبون');
	const isDropship = $derived(Boolean(order.suppressCustomerContact));
	// The wholesaler's own restock. Read off storeName, not
	// suppressCustomerContact — see isWholesaleOrder for why that flag is false
	// on these and would find nothing.
	const isWholesale = $derived(isWholesaleOrder(order));
	// Carrier could not complete delivery and the parcel is still saveable.
	const carrierStalled = $derived(order.shipment?.carrierClass === 'ATTENTION');
	// Bound to a preprinted Alwaseet sticker (printerless branch) rather than a
	// printed label — flagged so it's distinguishable at a glance.
	const isSticker = $derived(order.shipment?.carrierMethod === 'APP_STICKER');
	// Delivered by our own driver (friend/colleague), not Alwaseet.
	const isLocal = $derived(order.shipment?.carrierMethod === 'LOCAL');

	// Staff notes with the legacy machine-written WhatsApp warning removed.
	const opNote = $derived(displayOpNotes(order.operatorNote));
	/**
	 * Just the words, for the card.
	 *
	 * The stored note keeps a "— who · when" header line per entry, which the
	 * detail shows as its own small grey line. The card was printing that header
	 * as part of the note body, so a one-line remark arrived as four lines of
	 * bold rose text and outweighed the order it was attached to.
	 */
	const opNoteBody = $derived(
		parseOpNotes(order.operatorNote)
			.map((n) => n.body.trim())
			.filter(Boolean)
			.join(' · ')
	);

	const source = $derived(orderSource(order));
	const tier = $derived(customerTier(order));
	// Always the order date. History used to show updatedAt to match its 48h
	// grouping, but that made the same order read as two different dates
	// depending on the tab, and an edit silently reset the date an operator
	// was reading as "when this was ordered".
	const cardDate = $derived(formatCardDate(order.createdAt));

	// Item-image glimpse: up to 3 product thumbnails on the card so the operator
	// gets the gist without opening the order. Tapping a thumb just opens the
	// order like the rest of the card (no zoom).
	const thumbs = $derived(
		(order.items ?? [])
			.map((it) => resolveImage(it.imageUrl))
			.filter((u): u is string => Boolean(u))
	);
	const thumbsShown = $derived(thumbs.slice(0, 3));
	const thumbsMore = $derived((order.items?.length ?? 0) - thumbsShown.length);
</script>

<!-- data-order-card: the chat walkthrough points at the first one of these. -->
<Card
	data-order-card
	class={cn(
		'apple-press relative cursor-pointer overflow-hidden rounded-2xl p-3.5 transition-all duration-150 ease-out',
		'bg-white/78 dark:bg-card/75 backdrop-blur-2xl backdrop-saturate-200',
		'border border-black/[0.08] dark:border-white/[0.12]',
		'ring-1 ring-inset ring-white/90 dark:ring-white/[0.08]',
		'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06),inset_0_1px_0_0_rgba(255,255,255,0.95)]',
		'dark:shadow-[0_4px_16px_rgba(0,0,0,0.35),0_12px_32px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.12)]',
		'hover:bg-white/92 dark:hover:bg-card/85 hover:border-black/15 dark:hover:border-white/20',
		'hover:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_16px_36px_rgba(0,0,0,0.12)]',
		isDropship && 'border-amber-400/40 bg-amber-400/10 dark:bg-amber-400/[0.08]',
		// Purple to dropship's gold, at the same weight, so the two reseller
		// channels are told apart across a scrolling list before either label is
		// read. The two are mutually exclusive: an order carries one storeName.
		isWholesale && 'border-violet-400/45 bg-violet-400/10 dark:bg-violet-400/[0.08]',
		fresh && 'animate-arrival-pulse ring-2 ring-emerald-500/80 bg-emerald-500/15',
		selected && 'ring-primary ring-2 border-primary/50 bg-primary/10 dark:border-primary/60 dark:bg-primary/20 dark:ring-primary/80'
	)}
	{onclick}
>
	<div class="flex items-start justify-between gap-2">
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			<span class="size-2 shrink-0 rounded-full {statusDotClass(order.status)}"></span>
			<!-- On a dropship order the headline name is the RESELLER. The order is
			     theirs; the person it ships to is a detail of theirs, and it is the
			     reseller an operator has to recognise, chase and phone. Their
			     customer's name is on the detail screen with the address it belongs
			     to. -->
			<p class="truncate font-semibold">
				{(isDropship ? order.resellerName : order.customerName) || order.customerName || '-'}
			</p>
			<span
				class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap {source.class}"
				title={isDropship
					? 'طلب دروبشيب — الاسم هو الموزع'
					: isWholesale
						? 'طلب جملة — الموزع يشتري لنفسه، والشحنة تصله هو'
						: 'مصدر الطلب'}
			>
				{source.label}
			</span>
			{#if tier}
				<span
					class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap {tier.class}"
					title="عدد الطلبات المكتملة السابقة: {tier.count}"
				>
					{tier.label} · {tier.count}
				</span>
			{/if}
		</div>
		<div class="flex shrink-0 flex-col items-end gap-0.5">
			<span class="text-foreground/80 text-xs tabular-nums" dir="ltr">{cardDate.time}</span>
			<span class="text-muted-foreground text-[11px]">{cardDate.relDay}</span>
			{#if showStatus}
				{@const badge = statusBadgeProps(order.status)}
				<span class="rounded-full border px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap {badge.class}">
					{badge.label}
				</span>
			{/if}
		</div>
	</div>

	<div class="mt-1.5 flex items-center gap-2">
		<div class="text-muted-foreground flex min-w-0 flex-1 items-center gap-1 text-sm">
			<Building2 class="size-3.5 shrink-0" />
			<span class="truncate">
				{order.cityName || '-'}{order.regionName ? ` — ${order.regionName}` : ''}
			</span>
		</div>
		{#if vagueRegion}
			<span class="shrink-0 rounded-md border-2 border-amber-500 bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
				⚠️ منطقة غير محددة
			</span>
		{/if}
		{#if order.returnOrder || order.replacement}
			<span class="shrink-0 rounded-md border-2 border-orange-500 bg-orange-500/15 px-2 py-0.5 text-xs font-bold text-orange-600 dark:text-orange-400">
				🔄 استبدال
			</span>
		{/if}
		{#if isSticker}
			<span
				class="shrink-0 rounded-md bg-indigo-600 px-2 py-0.5 text-sm font-bold text-white tabular-nums shadow-sm dark:bg-indigo-500"
				title="طلب مرتبط بملصق مطبوع مسبقاً"
			>
				🏷️ ملصق {order.shipment?.stickerLabelId || order.shipment?.trackingNumber}
			</span>
		{:else if isLocal}
			<span
				class="shrink-0 rounded-md bg-cyan-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm dark:bg-cyan-500"
				title={order.shipment?.localDriverName ? `مندوب محلي: ${order.shipment.localDriverName}` : 'توصيل محلي'}
			>
				🏍️ {order.shipment?.localDriverName || 'مندوب محلي'}
			</span>
		{:else if order.preStickerId}
			<!-- Sticker reserved at creation but not yet sent to the carrier — so a
			     printerless operator can match the shelf parcel before packing. -->
			<span
				class="shrink-0 rounded-md border-2 border-dashed border-indigo-400 bg-indigo-500/10 px-2 py-0.5 text-sm font-bold tabular-nums text-indigo-700 dark:text-indigo-300"
				title="ملصق محجوز مسبقاً — لم يُرسل بعد"
			>
				🏷️ {order.preStickerId}
			</span>
		{/if}
		<!-- The carrier tried and could not deliver. Our own status still reads
		     "أُرسل" and will keep reading it until the parcel is written off, so
		     without this the card looks healthy. Red, not amber: amber is the
		     dropship wash on this very card and would disappear into it. -->
		{#if carrierStalled}
			<span
				class="shrink-0 rounded-md border-2 border-red-500 bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-600 dark:text-red-400"
				title={order.shipment?.alwaseetIssueNotes || 'المندوب لم يتمكن من التسليم'}
			>
				🚨 {order.shipment?.alwaseetStatusName || 'تعذّر التسليم'}
			</span>
		{/if}
	</div>

	<div class="mt-2 flex items-end justify-between gap-2">
		<div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
			<span class="inline-flex items-center gap-1">
				<Package class="size-3.5" />
				{formatPieces(order.itemsNumber)}
			</span>
			<span class="text-foreground inline-flex items-center gap-1 font-medium">
				<CircleDollarSign class="size-3.5" />
				{formatPrice(order.price)} د.ع
				{#if order.discountCode}
					<Tag class="size-3" />
				{/if}
				<!-- Delivery was waived by the storefront: the total is short on
				     purpose, which matters when scanning a list of prices. -->
				{#if order.freeDelivery}
					<Truck class="size-3 text-emerald-600 dark:text-emerald-400" />
				{/if}
			</span>
			{#if order.shipment?.trackingNumber}
				<span class="inline-flex items-center gap-1" dir="ltr">
					<MapPin class="size-3.5" />
					{order.shipment.trackingNumber}
				</span>
			{/if}
			{#if order.erpInvoiceStatus === 'QUEUED' || order.erpInvoiceStatus === 'PROCESSING'}
				<span class="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 font-medium text-blue-600 dark:text-blue-400">
					<Loader2 class="size-3 animate-spin" /> الفاتورة قيد الإنشاء
				</span>
			{:else if order.erpInvoiceStatus === 'FAILED'}
				<span class="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 font-medium text-rose-600 dark:text-rose-400">
					<AlertTriangle class="size-3" /> فشل الفاتورة
				</span>
			{:else if erpAlert && !erpAlertHidden}
				<!-- The invoice exists in the ERP and is wrong — blinks until someone
				     acknowledges it. Dismissing is local and only silences the card;
				     the order screen keeps showing the problem until it is fixed. -->
				<span
					class="animate-erp-blink inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 font-bold text-amber-700 dark:text-amber-400"
				>
					<AlertTriangle class="size-3 shrink-0" />
					{erpAlert}
					<button
						type="button"
						aria-label="إخفاء التنبيه"
						class="ms-0.5 rounded-full p-0.5 opacity-70 hover:opacity-100 active:opacity-50"
						onclick={(e) => {
							e.stopPropagation(); // never open the order from the dismiss button
							dismissErpAlert(order.id, order.erpInvoiceStatus);
							erpAlertHidden = true;
						}}
					>
						<X class="size-3" />
					</button>
				</span>
			{/if}

			{#if order.customerConfirmation === 'CONFIRMED'}
				<span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400"><CircleCheck class="animate-approve-beat size-3" /> أكد الزبون</span>
			{:else if order.customerConfirmation === 'CANCELLED'}
				<span class="animate-reject-shake inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 font-medium text-rose-600 dark:text-rose-400"><CircleX class="animate-pop-in size-3" /> ألغى الزبون</span>
			{:else if order.customerConfirmation === 'NO_RESPONSE'}
				<span class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400"><Hourglass class="size-3" /> لا رد من الزبون</span>
			{:else if order.customerConfirmation === 'PENDING'}
				<span class="animate-wait-pulse inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-600 dark:text-sky-400"><Hourglass class="size-3" /> بانتظار تأكيد الزبون</span>
			{/if}
		</div>

		<div class="flex shrink-0 items-center">
			{#if contact}
				<!-- Rounded square + tinted (not a solid circle) so it can't be mistaken
				     for the round approve button next to it. Falls back to a call link
				     when no number on the order has WhatsApp. -->
				{#if contact.mode === 'tel'}
					<a
						href="tel:{contact.num}"
						onclick={(e) => e.stopPropagation()}
						aria-label="اتصال ب{contactWho}"
						class="inline-flex min-h-10 flex-col items-center justify-center gap-0.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-1.5 py-1 transition-colors hover:bg-sky-500/20 active:bg-sky-500/30"
					>
						<Phone class="size-5 text-sky-600 dark:text-sky-400" />
						<span class="text-[9px] font-medium leading-none text-sky-700 dark:text-sky-400">اتصال ب{contactWho}</span>
					</a>
				{:else}
					<a
						href={whatsappHref(contact.num)}
						target="_blank"
						rel="noopener"
						onclick={(e) => e.stopPropagation()}
						aria-label="تواصل مع {contactWho} عبر واتساب"
						class="inline-flex min-h-10 flex-col items-center justify-center gap-0.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-1 transition-colors hover:bg-emerald-500/20 active:bg-emerald-500/30"
					>
						<WhatsAppIcon class="size-5" />
						<span class="text-[9px] font-medium leading-none text-emerald-700 dark:text-emerald-400">تواصل مع {contactWho}</span>
					</a>
				{/if}
			{/if}
			{#if isPending || isLocalAssigned}
				<div class="border-border {contact ? 'ms-2 border-s ps-2' : ''}">
					<OrderQuickActions {order} onDone={(movedTo) => onQuickActionDone?.(movedTo)} onGoTo={onGoToTab} />
				</div>
			{/if}
		</div>
	</div>

	{#if order.duplicateOf}
		{#if order.duplicateOf.type === 'exact'}
			<div class="mt-2 flex items-center gap-1.5 rounded-md border-2 border-rose-500/60 bg-rose-500/10 px-2 py-1.5 text-sm font-bold text-rose-700 dark:text-rose-300">
				<AlertTriangle class="size-4 shrink-0" />
				طلب مكرر — نفس المعلومات خلال 24 ساعة
			</div>
		{:else}
			<div class="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
				<AlertTriangle class="size-3.5 shrink-0" />
				للزبون طلب آخر خلال اليومين الماضيين
			</div>
		{/if}
	{/if}

	{#if displayNotes(order.notes)}
		<div
			class="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-300"
		>
			<FileText class="mt-0.5 size-4 shrink-0" />
			<span class="text-[15px] font-bold leading-snug whitespace-pre-line">{displayNotes(order.notes)}</span>
		</div>
	{/if}

	{#if opNote}
		<div
			class="mt-2 flex items-start gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-rose-700 dark:text-rose-300"
		>
			<StickyNote class="mt-0.5 size-4 shrink-0" />
			<div class="min-w-0">
				<p class="text-[10px] font-bold leading-none opacity-70">ملاحظة</p>
				<!-- Two lines, at the same weight as the conversation under it. It
				     was 15px bold with the author and timestamp baked into the text,
				     which made a one-line remark the loudest thing on the card. -->
				<span class="mt-1 line-clamp-2 block whitespace-pre-line text-[13px] font-semibold leading-snug">
					{opNoteBody || opNote}
				</span>
			</div>
		</div>
	{/if}
	{#if order.chat}
		<!-- Order talk was invisible until somebody opened the thread, so a
		     question asked on an order sat there while operators scanned past the
		     card that had it.
		     It used to give way entirely to a staff note, which hid the newer
		     thing behind the older one — and on a dropship order the note is
		     written by the reseller, so the card showed their sentence and none of
		     what the team had since said about it. Both show now; with a note
		     present this takes one line instead of two, because the note is a
		     standing instruction and outranks a passing remark. -->
		<div
			class={cn(
				'mt-2 flex items-start gap-1.5 rounded-md border px-2 py-1.5',
				order.chat.mentionsMe
					? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300'
					: 'border-border/60 bg-muted/40 text-muted-foreground'
			)}
		>
			{#if order.chat.mentionsMe}
				<AtSign class="mt-0.5 size-4 shrink-0" />
			{:else}
				<MessageSquare class="mt-0.5 size-4 shrink-0" />
			{/if}
			<div class="min-w-0">
				<p class="flex items-center gap-1 text-[10px] font-bold leading-none opacity-70">
					{#if order.chat.pinned}
						<!-- Says why THIS line and not the newest one: without it a pinned
						     message from last week reads as a thread nobody has touched. -->
						<Pin class="size-3 shrink-0 fill-current" />
					{/if}
					{order.chat.author}
					{#if order.chat.mentionsMe}<span>· ذكرك</span>{/if}
					{#if order.chat.unread}
						<!-- A dot rather than a word: the card is scanned, and "جديد"
						     spelled out competes with the message itself. -->
						<span class="size-1.5 rounded-full bg-current" aria-label="غير مقروءة"></span>
					{/if}
				</p>
				<span
					class={cn(
						// whitespace-pre-line: a message is usually "@سيف" then the actual
						// sentence on the next line, and collapsing that break ran the
						// name into the words after it. The staff note above renders its
						// own line breaks for the same reason.
						'mt-1 block text-sm leading-snug whitespace-pre-line',
						'line-clamp-2',
						// The block is muted so the author line and the icon stay quiet,
						// but the message itself was inheriting that same grey and reading
						// as disabled text. It takes the ordinary foreground back — what
						// is quiet here is the frame around it, not the words.
						!order.chat.mentionsMe && 'text-foreground/90',
						order.chat.unread || order.chat.pinned ? 'font-bold' : 'font-medium'
					)}
				>
					{order.chat.body}
				</span>
			</div>
		</div>
	{/if}


	{#if thumbsShown.length}
		<div class="mt-2 flex items-center gap-1.5">
			{#each thumbsShown as src, idx (idx)}
				<img
					{src}
					alt=""
					loading="lazy"
					class="border-border bg-muted size-11 shrink-0 rounded-md border object-cover"
				/>
			{/each}
			{#if thumbsMore > 0}
				<span
					class="text-muted-foreground border-border bg-muted flex size-11 shrink-0 items-center justify-center rounded-md border text-xs font-semibold"
				>
					+{thumbsMore}
				</span>
			{/if}
		</div>
	{/if}
</Card>
