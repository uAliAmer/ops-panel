<script lang="ts">
	/**
	 * Header chip: the shared room, DMs, and the unread badge across all of them.
	 * Same self-contained load/socket pattern as RemindersChip — each mounted
	 * copy (desktop bar + mobile menu) runs its own subscription, which is why
	 * this is not a shared store.
	 *
	 * Order threads are counted in the badge but not listed here: they belong on
	 * their order, and a flat list of a hundred order threads is not a place
	 * anyone would look. The room and DMs are what this opens onto.
	 */
	import { fly } from 'svelte/transition';
	import { Sheet, SheetContent } from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { MessageCircle, X, ArrowRight, Hash, AtSign, Package, ExternalLink, Lock, Trash2, KeyRound, Bell, BellOff } from '@lucide/svelte';
	import { api, type ChatConversation, type ChatUser, type ChatMention, type ChatRoom } from '$lib/api';
	import { socketStore } from '$lib/stores/socket.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { haptic } from '$lib/utils/haptic';
	import { cn } from '$lib/utils';
	import { avatarFor } from '$lib/utils/avatar';
	import { orderSlug, orderLabel } from '$lib/utils/orderSlug';
	import { formatPrice } from '$lib/utils/format';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { playChatIn, playChatMention } from '$lib/utils/chatSound';
	import ChatThread from '$lib/components/ChatThread.svelte';
	import { enablePush, disablePush, pushState, syncPush, type PushState } from '$lib/utils/push';
	import { markTourSeen, CHAT_TOUR_KEY } from '$lib/utils/tour';

	type Props = {
		/** Trigger classes. The mobile bar uses a large frosted circle, the
		 *  desktop bar a wider labelled button — same panel either way. */
		class?: string;
		/** Icon size class, to match whichever bar it sits in. */
		iconClass?: string;
		/** Shown beside the icon where there is room for it (the desktop bar). */
		label?: string;
		/**
		 * Which bar this copy lives in. Both are mounted at once — CSS hides one —
		 * so without this they BOTH raised a preview card and BOTH played the
		 * sound for every message. Only the copy matching the current breakpoint
		 * does that work, which also guarantees the card is anchored to a button
		 * that is actually on screen: a display:none button reports a zero rect
		 * and would pin the card to the top-left corner.
		 */
		surface?: 'desktop' | 'mobile';
	};
	let {
		class: triggerClass = '',
		iconClass = 'size-4',
		label = '',
		surface = 'desktop'
	}: Props = $props();

	let open = $state(false);
	let conversations = $state<ChatConversation[]>([]);
	let roomId = $state<string | null>(null);
	let rooms = $state<ChatRoom[]>([]);
	/** The room waiting on its passcode, and what has been typed so far. */
	let lockPrompt = $state<ChatRoom | null>(null);
	let passcode = $state('');
	let unlocking = $state(false);
	let lockError = $state('');
	let openId = $state<string | null>(null);
	let openTitle = $state('');
	// Opens on الرسائل, not الغرفة: a DM is addressed to one person and is what
	// an operator opens the panel to deal with, while the room is broadcast and
	// can wait for a deliberate tap.
	let tab = $state<'room' | 'dms' | 'orders' | 'mentions'>('dms');
	let mentions = $state<ChatMention[]>([]);
	let users = $state<ChatUser[]>([]);
	let loading = $state(false);

	/** Preview cards for messages that arrived while the panel was shut. */
	type Toast = {
		id: string;
		conversationId: string;
		title: string;
		author: string;
		body: string;
		mentioned: boolean;
	};
	let toasts = $state<Toast[]>([]);
	const TOAST_MS = 6000;

	function dropToast(id: string) {
		toasts = toasts.filter((t) => t.id !== id);
	}

	function pushToast(t: Toast) {
		// Newest first, and only ever three: a stack that grows without limit
		// covers the screen an operator is trying to work in.
		toasts = [t, ...toasts.filter((x) => x.id !== t.id)].slice(0, 3);
		setTimeout(() => dropToast(t.id), TOAST_MS);
	}

	function openFromToast(t: Toast) {
		dropToast(t.id);
		haptic(10);
		open = true;
		openId = t.conversationId;
		openTitle = t.title;
		void load();
	}

	// A bottom sheet is right on a phone and wrong on a desktop, where it covers
	// the work to show a narrow column of chat. On a wide screen the panel hangs
	// off the icon instead, the way the rest of the header's menus do.
	let isDesktop = $state(false);
	let btnEl = $state<HTMLElement | null>(null);
	let panelEl = $state<HTMLElement | null>(null);
	let pos = $state({ top: 0, right: 0, toastRight: 0 });

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(min-width: 1024px)');
		const sync = () => (isDesktop = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	const GAP = 8;
	const EDGE = 8;
	/** Panel and card widths in px, matching their Tailwind classes. */
	const PANEL_W = 384; // w-[24rem]
	const TOAST_W = 320; // w-[20rem]

	/**
	 * Anchored by its RIGHT edge — the app is RTL and the chip sits near the end
	 * of the bar — but clamped so the left edge cannot leave the screen. Without
	 * the clamp a card wider than the gap between the chip and the viewport's
	 * left edge simply hung off it, which is exactly what a 20rem card did on a
	 * phone, where that gap is about a hundred pixels.
	 */
	function rightFor(anchorRight: number, width: number) {
		const wanted = window.innerWidth - anchorRight;
		const maxRight = Math.max(EDGE, window.innerWidth - width - EDGE);
		return Math.max(EDGE, Math.min(wanted, maxRight));
	}

	function place() {
		if (!btnEl) return;
		const a = btnEl.getBoundingClientRect();
		pos = {
			top: a.bottom + GAP,
			right: rightFor(a.right, PANEL_W),
			toastRight: rightFor(a.right, Math.min(TOAST_W, window.innerWidth - 2 * EDGE))
		};
	}

	$effect(() => {
		// Also while closed: the preview cards hang off the same anchor.
		if (!open && !toasts.length) return;
		place();
		const onScroll = () => place();
		window.addEventListener('resize', onScroll);
		window.addEventListener('scroll', onScroll, true);
		return () => {
			window.removeEventListener('resize', onScroll);
			window.removeEventListener('scroll', onScroll, true);
		};
	});

	$effect(() => {
		if (!open || !isDesktop) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		const onDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (panelEl?.contains(t) || btnEl?.contains(t)) return;
			open = false;
		};
		window.addEventListener('keydown', onKey);
		// Capture: a click inside some other panel would otherwise be stopped
		// before it ever reached the document.
		window.addEventListener('mousedown', onDown, true);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('mousedown', onDown, true);
		};
	});

	/**
	 * The header is sticky and blurred, which makes it a stacking context: a
	 * panel nested inside it cannot rise above the page whatever its z-index.
	 * Same reason HintPopover does this — the panel is moved to <body>.
	 */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	/**
	 * Track the VISUAL viewport while the mobile sheet is open.
	 *
	 * A fixed element pinned top-0/bottom-0 is sized against the LAYOUT viewport,
	 * which does not shrink when the keyboard appears — iOS instead slides the
	 * whole page up. The sheet therefore stayed window-height with its header
	 * pushed off the top, the composer somewhere under the keyboard, and a
	 * scroller taller than the space left to scroll in, which is why the list
	 * would not move. visualViewport reports what is actually on screen, so the
	 * sheet is given that height and offset and everything inside it fits again.
	 */
	$effect(() => {
		if (!open || isDesktop || typeof window === 'undefined') return;
		const vv = window.visualViewport;
		if (!vv) return; // older browsers fall back to the dvh default
		const root = document.documentElement;
		const sync = () => {
			root.style.setProperty('--chat-vvh', `${vv.height}px`);
			root.style.setProperty('--chat-vvtop', `${vv.offsetTop}px`);
		};
		sync();
		vv.addEventListener('resize', sync);
		vv.addEventListener('scroll', sync);
		return () => {
			vv.removeEventListener('resize', sync);
			vv.removeEventListener('scroll', sync);
			root.style.removeProperty('--chat-vvh');
			root.style.removeProperty('--chat-vvtop');
		};
	});

	/** True only for the copy that is currently visible. */
	const active = $derived(surface === (isDesktop ? 'desktop' : 'mobile'));

	/**
	 * Notifications on this device — docs/OPS_CHAT_PLAN.md phase 6.
	 *
	 * The socket reaches a panel that is open and awake, and nothing else: a
	 * backgrounded mobile tab is suspended within seconds of the screen going
	 * off, so a DM to an operator with the phone in their pocket arrived
	 * silently and waited to be found. This is the bell that fixes that.
	 */
	let push = $state<PushState>('off');
	let pushBusy = $state(false);

	$effect(() => {
		if (!active) return;
		void (async () => {
			push = await pushState();
			// A shared handset: re-point an existing subscription at whoever is
			// logged in now, so the last operator's DMs stop arriving on it.
			if (push === 'on') void syncPush();
		})();
	});

	async function togglePush() {
		if (pushBusy) return;
		pushBusy = true;
		haptic(10);
		try {
			if (push === 'on') {
				push = await disablePush();
				toast.info('أُوقفت التنبيهات على هذا الجهاز');
				return;
			}
			const next = await enablePush();
			push = next;
			if (next === 'on') toast.success('ستصلك التنبيهات على هذا الجهاز');
			else if (next === 'ios-needs-install')
				// Said rather than failed silently: on iPhone this is not a bug to
				// work around, it is a step the operator has to take first.
				toast.info('على iPhone: شارك ← أضف إلى الشاشة الرئيسية، ثم فعّل التنبيهات من داخل التطبيق', {
					duration: 8000
				});
			else if (next === 'denied') toast.error('التنبيهات محظورة — فعّلها من إعدادات المتصفح لهذا الموقع');
			else toast.error('تعذّر تفعيل التنبيهات على هذا المتصفح');
		} finally {
			pushBusy = false;
		}
	}

	/**
	 * Opened from a notification. An already-open tab is told which conversation
	 * to show over postMessage — reloading it would throw away whatever was on
	 * screen — while a cold start carries the id in the URL instead.
	 */
	$effect(() => {
		if (!active || typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		const fromUrl = url.searchParams.get('chat');
		if (fromUrl) {
			url.searchParams.delete('chat');
			history.replaceState(history.state, '', url);
			void openById(fromUrl);
		}
		if (!('serviceWorker' in navigator)) return;
		const onMessage = (e: MessageEvent) => {
			if (e.data?.type === 'chat:open' && e.data.conversationId) void openById(e.data.conversationId);
		};
		navigator.serviceWorker.addEventListener('message', onMessage);
		return () => navigator.serviceWorker.removeEventListener('message', onMessage);
	});

	const totalUnread = $derived(conversations.reduce((n, c) => n + (c.unread || 0), 0));
	const unreadMentions = $derived(mentions.filter((m) => !m.readAt).length);
	// Per-tab counts: the header badge says there is something, the tabs say
	// where. Without these an operator opens the sheet and still has to hunt.
	const roomUnread = $derived(conversations.find((c) => c.id === roomId)?.unread ?? 0);
	const dmUnread = $derived(
		conversations.filter((c) => c.kind === 'DM').reduce((n, c) => n + (c.unread || 0), 0)
	);
	const orderUnread = $derived(
		conversations.filter((c) => c.kind === 'ORDER').reduce((n, c) => n + (c.unread || 0), 0)
	);

	/** Order threads this operator is in, most recently spoken in first. */
	const orderThreads = $derived(
		conversations
			.filter((c) => c.kind === 'ORDER')
			.sort(
				(a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime()
			)
	);

	const dms = $derived(
		conversations
			.filter((c) => c.kind === 'DM')
			.sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime())
	);

	/** A DM is named after the other party, never after "the conversation". */
	const otherOf = (c: ChatConversation) =>
		c.members.find((m) => m.id !== auth.user?.id)?.name ?? 'محادثة';

	/** Colleagues with no DM open yet — the ones starting a conversation is for. */
	const startable = $derived(
		users.filter((u) => !dms.some((c) => c.members.some((m) => m.id === u.id)))
	);

	async function load() {
		loading = true;
		try {
			const [convs, mens] = await Promise.all([api.chatConversations(), api.chatMentions()]);
			if (convs.success && convs.data) {
				conversations = convs.data.conversations;
				rooms = convs.data.rooms ?? [];
				roomId = convs.data.roomId;
			}
			if (mens.success && mens.data) mentions = mens.data;
		} catch {
			/* header chip is best-effort */
		} finally {
			loading = false;
		}
	}

	// The badge has to be right before the sheet is ever opened, so this loads on
	// mount and refreshes on the socket's nudge rather than waiting for a click.
	// Re-runs when this copy becomes the visible one: a window resized across the
	// breakpoint must not show whatever the badge said an hour ago.
	$effect(() => {
		if (active) void load();
		const off = socketStore.onChatUnread((p) => {
			// Both copies are mounted at once and CSS hides one, so reloading in
			// both meant two requests per message for a badge only one of them
			// draws. The hidden copy catches up when the breakpoint hands it over.
			if (active) void load();
			// Badges refresh in both copies; everything that makes a noise or draws
			// a card happens once, in the visible one.
			if (!active) return;
			const watching = open && openId === p.conversationId;
			// A mention is addressed to one person and deserves to interrupt; an
			// ordinary message just moves the badge. Suppressed while that
			// conversation is on screen — you are already reading it.
			if (p.mentioned && !watching) playChatMention();

			// Preview card. Only while the panel is shut: with it open the
			// message is already visible, or one tab away in the list. Order
			// threads are left out — they belong on their order, and a card that
			// opens a panel which does not list them leads nowhere.
			if (!open && p.body && p.kind !== 'ORDER') {
				// The card is the only sign a message arrived while the panel was
				// shut — ChatThread is not mounted to make the sound itself. A
				// mention keeps its own chime instead of stacking two sounds.
				if (!p.mentioned) playChatIn();
				pushToast({
					id: p.messageId,
					conversationId: p.conversationId,
					title: p.kind === 'DM' ? (p.author ?? 'رسالة') : 'غرفة الفريق',
					author: p.author ?? '',
					body: p.body,
					mentioned: p.mentioned
				});
			}
		});
		return off;
	});

	$effect(() => {
		if (!open || users.length) return;
		void (async () => {
			try {
				const res = await api.chatUsers();
				users = res.data ?? [];
			} catch {
				/* the list still works without the directory */
			}
		})();
	});

	/** The room currently open, if any — carries its ttl, prune and owner flags. */
	const openRoom_ = $derived(openId ? (rooms.find((r) => r.id === openId) ?? null) : null);

	function openRoom(room: ChatRoom) {
		haptic(10);
		// A locked room asks for its code first. The server refuses anyway; this
		// just means the operator sees a prompt instead of an empty thread.
		if (room.locked) {
			lockPrompt = room;
			passcode = '';
			lockError = '';
			return;
		}
		openId = room.id;
		openTitle = room.name;
	}

	/** Put the caret in the box as the prompt appears. */
	function focusNow(node: HTMLInputElement) {
		requestAnimationFrame(() => node.focus());
	}

	async function submitPasscode() {
		if (!lockPrompt || unlocking) return;
		unlocking = true;
		lockError = '';
		try {
			const res = await api.chatUnlock(lockPrompt.id, passcode);
			if (res.success) {
				const room = lockPrompt;
				lockPrompt = null;
				passcode = '';
				openId = room.id;
				openTitle = room.name;
				void load();
			}
		} catch (err) {
			lockError = (err as Error).message || 'رمز غير صحيح';
		} finally {
			unlocking = false;
		}
	}

	async function pruneOpen() {
		if (!openId) return;
		if (!confirm('مسح كل الرسائل في هذه الغرفة؟ لا يمكن التراجع.')) return;
		try {
			await api.chatPrune(openId);
			void load();
		} catch (err) {
			toast.error((err as Error).message || 'تعذّر المسح');
		}
	}

	async function changePasscode() {
		if (!openRoom_) return;
		const next = prompt('الرمز الجديد (اتركه فارغاً لإزالة القفل):', '');
		if (next === null) return;
		try {
			const res = await api.chatSetPasscode(openRoom_.id, next.trim());
			toast.success(res.data?.hasPasscode ? 'تم تغيير الرمز' : 'أُزيل القفل');
			void load();
		} catch (err) {
			toast.error((err as Error).message || 'تعذّر تغيير الرمز');
		}
	}

	/** What a conversation is called, wherever it is being opened from. */
	const titleOf = (c: ChatConversation) =>
		c.kind === 'ORDER'
			? `طلب ${c.order?.submissionId ?? ''}`.trim()
			: c.kind === 'ROOM'
				? 'غرفة الفريق'
				: otherOf(c);

	/**
	 * Open a conversation by id alone — what a notification hands us. The list
	 * is loaded first because the title lives there, and a panel headed
	 * "محادثة" tells the operator nothing about what they just tapped.
	 */
	async function openById(id: string) {
		open = true;
		openId = id;
		openTitle = '';
		await load();
		const conv = conversations.find((c) => c.id === id);
		openTitle = conv ? titleOf(conv) : (rooms.find((r) => r.id === id)?.name ?? 'محادثة');
	}

	function openConversation(c: ChatConversation) {
		haptic(10);
		openId = c.id;
		// Titled by what the conversation IS: an order thread by its order, a DM
		// by the other person. otherOf() alone would have labelled an order
		// thread with whichever colleague happened to be in it first.
		openTitle =
			c.kind === 'ORDER'
				? `طلب ${c.order?.submissionId ?? ''}`.trim()
				: c.kind === 'ROOM'
					? 'غرفة الفريق'
					: otherOf(c);
	}

	async function startDm(u: ChatUser) {
		haptic(10);
		try {
			const res = await api.chatDm(u.id);
			if (res.success && res.data) {
				openId = res.data.conversationId;
				openTitle = u.name;
				void load();
			}
		} catch {
			/* nothing to open */
		}
	}

	/** Leave the panel and open the order this thread belongs to. */
	function openOrderOf(c: ChatConversation) {
		if (!c.order) return;
		haptic(10);
		open = false;
		void goto(`${base}/order/${orderSlug(c.order as never)}/`);
	}

	/** The conversation currently open, when it is an order thread. */
	const openOrderConv = $derived(
		openId ? (conversations.find((c) => c.id === openId && c.kind === 'ORDER') ?? null) : null
	);

	/**
	 * Leave whatever is open. A room with a passcode re-locks behind you, so the
	 * next visit asks again instead of standing open for the rest of the unlock
	 * window — which matters most on the shared phone this is likeliest to be.
	 */
	function leaveOpen() {
		const wasLocked = openId ? rooms.find((r) => r.id === openId && r.hasPasscode) : null;
		if (wasLocked) void api.chatLock(wasLocked.id).catch(() => {});
		openId = null;
		openTitle = '';
	}

	function back() {
		leaveOpen();
		// Coming back to the list should show the unread it just cleared.
		void load();
	}

	/** Open the conversation a mention points at — the order's thread, or the room. */
	function openMention(m: ChatMention) {
		haptic(10);
		const conv = m.message.conversation;
		openId = conv.id;
		openTitle = conv.submission
			? `طلب ${conv.submission.submissionId}`
			: conv.kind === 'DM'
				? m.message.author?.name ?? 'محادثة'
				: 'غرفة الفريق';
	}

	const mentionTime = (iso: string) =>
		new Date(iso).toLocaleString('ar-IQ', {
			hour: '2-digit',
			minute: '2-digit',
			day: '2-digit',
			month: '2-digit'
		});
</script>

<!-- data-chat-trigger: PushPrompt hangs its offer off this exact button. The
     offer is about the messages that arrive here, so it belongs where they land. -->
<button
	bind:this={btnEl}
	type="button"
	data-chat-trigger
	class={cn(
		// No size here on purpose. It used to carry size-9, which sets width AND
		// height, so a caller wanting a different shape had to fight it with
		// !size-auto plus an h-*, and tailwind-merge resolved that pair
		// inconsistently — which is how this chip ended up a different height
		// from every other one in the bar. The size now comes from the caller,
		// with a square default for anyone who passes nothing.
		'apple-press relative inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card/70 text-foreground shadow-xs backdrop-blur-md transition-all active:scale-95',
		triggerClass || 'h-9 w-9'
	)}
	onclick={() => {
		haptic(10);
		open = !open;
		if (open) {
			void load();
			// Found it without being shown. The walkthrough is for operators who
			// have not, and it should never interrupt someone already using chat.
			markTourSeen(CHAT_TOUR_KEY);
		}
	}}
	aria-label="المحادثات"
>
	<MessageCircle class={cn(iconClass, totalUnread > 0 && 'animate-chat-wobble')} />
	{#if label}
		<span class="text-xs font-bold">{label}</span>
	{/if}
	{#if totalUnread > 0}
		<!-- Amber when one of them is addressed to you by name: an unread room
		     message and an unanswered mention are not the same errand. -->
		<span
			class={cn(
				'animate-chat-wobble absolute -top-1 -end-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-black text-white tabular-nums ring-2 ring-background',
				unreadMentions > 0 ? 'bg-amber-500' : 'bg-rose-600'
			)}
		>
			{totalUnread > 99 ? '99+' : totalUnread}
		</span>
	{/if}
</button>

{#snippet panelBody()}
	{#if lockPrompt}
		<!-- Inside the panel's own DOM, NOT portalled to <body>. A bits-ui sheet
		     traps focus and sets pointer-events:none on the body, so a prompt
		     outside it could be seen but never typed into — focus was pulled
		     straight back to the dialog. Rendered in here it is part of the
		     dialog, so the trap works for it instead of against it. Positioned
		     fixed, not absolute: giving the sheet `relative` to anchor it beat
		     the base `fixed` in the class merge and dropped the whole panel back
		     into the page as a half-height drawer. -->
		<div class="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6" dir="rtl">
			<div class="bg-card w-full max-w-xs rounded-2xl border p-5 shadow-2xl">
				<div class="mb-1 flex items-center gap-2">
					<Lock class="size-4 shrink-0" />
					<h3 class="text-sm font-black">{lockPrompt.name}</h3>
				</div>
				<p class="text-muted-foreground mb-3 text-xs font-semibold">أدخل رمز الدخول</p>
				<input
					type="password"
					inputmode="numeric"
					bind:value={passcode}
					use:focusNow
					onkeydown={(e) => e.key === 'Enter' && submitPasscode()}
					class="border-border/60 bg-background/60 w-full rounded-xl border px-3 py-2 text-center text-lg font-black tracking-[0.3em] outline-none focus:ring-2 focus:ring-primary/30"
					autocomplete="off"
				/>
				{#if lockError}
					<p class="mt-2 text-center text-[11px] font-bold text-rose-600">{lockError}</p>
				{/if}
				<div class="mt-3 flex gap-2">
					<Button
						variant="outline"
						class="h-10 flex-1 text-xs font-bold"
						onclick={() => {
							lockPrompt = null;
							passcode = '';
						}}
					>
						إلغاء
					</Button>
					<Button
						class="h-10 flex-1 text-xs font-bold"
						disabled={!passcode || unlocking}
						onclick={submitPasscode}
					>
						دخول
					</Button>
				</div>
			</div>
		</div>
	{/if}

		<div
			class="bg-card flex shrink-0 items-center justify-between gap-2 border-b px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]"
		>
			<div class="flex min-w-0 items-center gap-2">
				{#if openId}
					<Button variant="ghost" size="icon" class="shrink-0" onclick={back} aria-label="رجوع">
						<ArrowRight class="size-4" />
					</Button>
				{/if}
				<h2 class="truncate text-sm font-black">{openId ? openTitle : 'المحادثات'}</h2>
				{#if openRoom_?.pruneByAnyMember}
					<button
						type="button"
						class="text-muted-foreground hover:text-rose-600 inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold"
						onclick={pruneOpen}
						title="مسح كل الرسائل"
					>
						<Trash2 class="size-3.5" /> مسح
					</button>
				{/if}
				{#if openRoom_?.isOwner}
					<button
						type="button"
						class="text-muted-foreground hover:text-primary inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold"
						onclick={changePasscode}
						title="تغيير رمز الغرفة"
					>
						<KeyRound class="size-3.5" />
					</button>
				{/if}
				{#if openOrderConv}
					<!-- A thread about an order is nearly always read with a question
					     about the order itself; without this the only way there was to
					     close the panel and find it by hand. -->
					<button
						type="button"
						class="text-primary hover:bg-secondary/60 inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold"
						onclick={() => openOrderOf(openOrderConv)}
					>
						<ExternalLink class="size-3.5" /> فتح الطلب
					</button>
				{/if}
			</div>
			<div class="flex shrink-0 items-center">
				<!-- Per device, not per account: an operator with the panel on a phone
				     and a desk machine decides separately which of them rings. -->
				<Button
					variant="ghost"
					size="icon"
					class={cn('shrink-0', push === 'on' && 'text-primary')}
					onclick={togglePush}
					disabled={pushBusy}
					aria-label={push === 'on' ? 'إيقاف التنبيهات' : 'تفعيل التنبيهات'}
					title={push === 'on' ? 'التنبيهات مفعّلة على هذا الجهاز' : 'تفعيل التنبيهات على هذا الجهاز'}
				>
					{#if push === 'on'}
						<Bell class="size-4" />
					{:else}
						<BellOff class="size-4" />
					{/if}
				</Button>
				<Button
					variant="ghost"
					size="icon"
					class="shrink-0"
					onclick={() => {
						leaveOpen();
						open = false;
					}}
					aria-label="إغلاق"
				>
					<X class="size-4" />
				</Button>
			</div>
		</div>

		<div class="flex min-h-0 flex-1 flex-col p-3">
			{#if openId}
				<!-- autofocus here, not in the order detail: opening this panel is a
				     deliberate act, so the keyboard appearing is what was wanted. -->
				<ChatThread
					conversationId={openId}
					heightClass="flex-1 min-h-0"
					autofocus
					onNavigate={() => (open = false)}
				/>
			{:else}
				{#if push === 'off' || push === 'ios-needs-install'}
					<!-- A bell in the header is not discoverable enough for the thing
					     that decides whether chat reaches anyone at all: without a
					     subscription a message only lands while the panel is open and
					     the screen is on. Offered here, once, until it is taken. -->
					<button
						type="button"
						class="border-primary/30 bg-primary/5 hover:bg-primary/10 mb-3 flex w-full shrink-0 items-center gap-2 rounded-xl border p-2.5 text-right transition-colors"
						onclick={togglePush}
						disabled={pushBusy}
					>
						<Bell class="text-primary size-4 shrink-0" />
						<span class="min-w-0 flex-1">
							<span class="block text-xs font-black">فعّل التنبيهات على هذا الجهاز</span>
							<span class="text-muted-foreground block text-[11px] font-semibold">
								لتصلك الرسائل والشاشة مقفلة
							</span>
						</span>
					</button>
				{/if}
				<div class="mb-3 flex shrink-0 gap-1 rounded-xl bg-secondary/60 p-1">
					<button
						type="button"
						class={cn(
							'flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
							tab === 'room' ? 'bg-background shadow-xs' : 'text-muted-foreground'
						)}
						onclick={() => (tab = 'room')}
					>
						الغرفة
						{#if roomUnread > 0}
							<span class="rounded-full bg-rose-600 px-1 text-[10px] font-black text-white tabular-nums">
								{roomUnread > 99 ? '99+' : roomUnread}
							</span>
						{/if}
					</button>
					<button
						type="button"
						class={cn(
							'flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
							tab === 'dms' ? 'bg-background shadow-xs' : 'text-muted-foreground'
						)}
						onclick={() => (tab = 'dms')}
					>
						الرسائل
						{#if dmUnread > 0}
							<span class="rounded-full bg-rose-600 px-1 text-[10px] font-black text-white tabular-nums">
								{dmUnread > 99 ? '99+' : dmUnread}
							</span>
						{/if}
					</button>
					<button
						type="button"
						class={cn(
							'flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors',
							tab === 'orders' ? 'bg-background shadow-xs' : 'text-muted-foreground'
						)}
						onclick={() => (tab = 'orders')}
					>
						الطلبات
						{#if orderUnread > 0}
							<span class="rounded-full bg-rose-600 px-1 text-[10px] font-black text-white tabular-nums">
								{orderUnread > 99 ? '99+' : orderUnread}
							</span>
						{/if}
					</button>
					<button
						type="button"
						class={cn(
							'flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors',
							tab === 'mentions' ? 'bg-background shadow-xs' : 'text-muted-foreground'
						)}
						onclick={() => (tab = 'mentions')}
					>
						الإشارات
						{#if unreadMentions > 0}
							<span class="rounded-full bg-amber-500 px-1 text-[10px] font-black text-white tabular-nums">
								{unreadMentions > 99 ? '99+' : unreadMentions}
							</span>
						{/if}
					</button>
				</div>

				<div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
					{#if tab === 'room'}
						{#each rooms as room (room.id)}
							<button
								type="button"
								class="hover:bg-secondary/60 flex w-full items-center gap-3 rounded-xl border border-border/60 p-3 text-right transition-colors"
								onclick={() => openRoom(room)}
							>
								{#if room.hasPasscode}
									<Lock class="text-muted-foreground size-4 shrink-0" />
								{:else}
									<Hash class="text-muted-foreground size-4 shrink-0" />
								{/if}
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<span class="truncate text-sm font-black">{room.name}</span>
										{#if room.messageTtlMinutes}
											<!-- Said on the row, not only inside: whether a room forgets
											     changes what you are willing to say in it. -->
											<span class="bg-secondary/70 text-muted-foreground shrink-0 rounded px-1 text-[10px] font-bold">
												{room.messageTtlMinutes / 60} س
											</span>
										{/if}
									</div>
									<div class="text-muted-foreground truncate text-[11px] font-semibold">
										{room.description}
									</div>
								</div>
								{#if room.unread}
									<span class="rounded-full bg-rose-600 px-1.5 text-[10px] font-black text-white tabular-nums">
										{room.unread}
									</span>
								{/if}
							</button>
						{/each}
					{:else if tab === 'dms'}
						{#if dms.length}
							{#each dms as c (c.id)}
								<button
									type="button"
									class="hover:bg-secondary/60 flex w-full items-center gap-3 rounded-xl border border-border/60 p-3 text-right transition-colors"
									onclick={() => openConversation(c)}
								>
									<img
										src={avatarFor(otherOf(c))}
										alt=""
										loading="lazy"
										class="size-8 shrink-0 rounded-full ring-1 ring-border/60"
									/>
									<span class="min-w-0 flex-1 truncate text-sm font-bold">{otherOf(c)}</span>
									{#if c.unread}
										<span class="rounded-full bg-rose-600 px-1.5 text-[10px] font-black text-white tabular-nums">
											{c.unread}
										</span>
									{/if}
								</button>
							{/each}
							<div class="border-border/50 my-2 border-t"></div>
						{/if}

						<!-- No search box: this is a handful of colleagues, and a filter over
						     four names costs a tap and earns nothing. Anyone already in the
						     list above is left out here so the same person is not offered
						     twice. -->
						{#each startable as u (u.id)}
							<button
								type="button"
								class="hover:bg-secondary/60 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-right transition-colors"
								onclick={() => startDm(u)}
							>
								<img
									src={avatarFor(u.name)}
									alt=""
									loading="lazy"
									class="size-7 shrink-0 rounded-full ring-1 ring-border/60"
								/>
								<span class="min-w-0 flex-1 truncate text-xs font-bold">{u.name}</span>
								<span class="text-muted-foreground text-[10px] font-semibold">{u.role}</span>
							</button>
						{/each}
					{/if}

					{#if tab === 'mentions'}
						{#if mentions.length}
							{#each mentions as m (m.id)}
								<button
									type="button"
									class={cn(
										'flex w-full flex-col gap-1 rounded-xl border p-3 text-right transition-colors hover:bg-secondary/60',
										m.readAt ? 'border-border/60' : 'border-amber-500/50 bg-amber-500/5'
									)}
									onclick={() => openMention(m)}
								>
									<div class="flex items-center gap-2">
										<img
											src={avatarFor(m.message.author?.name)}
											alt=""
											loading="lazy"
											class="size-6 shrink-0 rounded-full ring-1 ring-border/60"
										/>
										<AtSign class="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
										<span class="text-xs font-black">{m.message.author?.name}</span>
										<span class="text-muted-foreground text-[10px] font-semibold tabular-nums">
											{mentionTime(m.createdAt)}
										</span>
									</div>
									<span class="text-muted-foreground line-clamp-2 text-xs font-semibold whitespace-pre-line">
										{m.message.body ?? 'حُذفت الرسالة'}
									</span>
									{#if m.message.conversation?.submission}
										<span class="text-[10px] font-bold text-primary">
											طلب {m.message.conversation.submission.submissionId}
										</span>
									{/if}
								</button>
							{/each}
						{:else}
							<p class="text-muted-foreground py-6 text-center text-xs font-semibold">
								لا توجد إشارات — ستظهر هنا عندما يذكرك زميل بـ @.
							</p>
						{/if}
					{/if}

					{#if tab === 'orders'}
						<!-- Order threads used to count toward the header badge with no way
						     to reach them from here, so the number and the tabs disagreed
						     and an operator had to guess which order was talking. -->
						{#if orderThreads.length}
							{#each orderThreads as c (c.id)}
								<div
									class={cn(
										'flex items-center rounded-xl border transition-colors',
										c.unread ? 'border-rose-500/40 bg-rose-500/5' : 'border-border/60'
									)}
								>
									<button
										type="button"
										class="hover:bg-secondary/60 flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3 text-right transition-colors"
										onclick={() => openConversation(c)}
									>
										<Package class="text-muted-foreground size-4 shrink-0" />
										<div class="min-w-0 flex-1">
											<!-- Customer first. An order is "سعاد في كربلاء، 45,000" to an
											     operator, not a uuid; the order number is kept as a quiet
											     chip for anyone matching it against the carrier or the ERP. -->
											<div class="flex items-center gap-1.5">
												<span class="truncate text-xs font-black">
													{c.order?.customerName ?? 'طلب'}
												</span>
												{#if c.order}
													<span class="bg-secondary/70 text-muted-foreground shrink-0 rounded px-1 text-[10px] font-bold tabular-nums">
														{orderLabel(c.order as never)}
													</span>
												{/if}
											</div>
											<div class="text-muted-foreground truncate text-[11px] font-semibold">
												{[c.order?.cityName, c.order?.price != null ? `${formatPrice(Number(c.order.price))} د.ع` : null]
													.filter(Boolean)
													.join(' · ')}
											</div>
										</div>
										{#if c.unread}
											<span class="shrink-0 rounded-full bg-rose-600 px-1.5 text-[10px] font-black text-white tabular-nums">
												{c.unread}
											</span>
										{/if}
									</button>
									<button
										type="button"
										class="text-muted-foreground hover:text-primary shrink-0 p-3"
										aria-label="فتح الطلب"
										title="فتح الطلب"
										onclick={() => openOrderOf(c)}
									>
										<ExternalLink class="size-4" />
									</button>
								</div>
							{/each}
						{:else}
							<p class="text-muted-foreground py-6 text-center text-xs font-semibold">
								لا توجد محادثات على الطلبات بعد.
							</p>
						{/if}
					{/if}

					{#if loading && !conversations.length}
						<p class="text-muted-foreground py-6 text-center text-xs font-semibold">جارٍ التحميل…</p>
					{/if}
				</div>
			{/if}
		</div>
{/snippet}

{#if toasts.length && active}
	<!-- Hangs off the same anchor as the panel, portalled for the same reason:
	     the header is blurred and sticky, so it is a stacking context and a card
	     nested inside it cannot rise above the page. -->
	<div
		use:portal
		class="fixed z-[70] flex w-[20rem] max-w-[calc(100vw-1rem)] flex-col gap-2"
		style="top: {pos.top}px; right: {pos.toastRight}px;"
		dir="rtl"
	>
		{#each toasts as t (t.id)}
			<div
				transition:fly={{ y: -8, duration: 160 }}
				class={cn(
					'overflow-hidden rounded-xl border bg-popover shadow-2xl ring-1 ring-black/5',
					t.mentioned ? 'border-amber-500/50' : 'border-border/60'
				)}
			>
				<!-- Two sibling buttons, not a button inside a button: interactive
				     content nested in a <button> is invalid HTML and browsers
				     disagree about what the inner one even does. -->
				<div class="flex items-start">
					<button
						type="button"
						class="hover:bg-secondary/50 flex min-w-0 flex-1 items-start gap-2 p-3 text-right transition-colors"
						onclick={() => openFromToast(t)}
					>
						<img
							src={avatarFor(t.author)}
							alt=""
							loading="lazy"
							class="size-8 shrink-0 rounded-full ring-1 ring-border/60"
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								<span class="truncate text-xs font-black">{t.author}</span>
								{#if t.title !== t.author}
									<span class="text-muted-foreground truncate text-[10px] font-bold">· {t.title}</span>
								{/if}
								{#if t.mentioned}
									<AtSign class="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
								{/if}
							</div>
							<p class="text-muted-foreground mt-0.5 line-clamp-2 text-xs font-semibold whitespace-pre-line">{t.body}</p>
						</div>
					</button>
					<button
						type="button"
						aria-label="إغلاق"
						class="text-muted-foreground hover:text-foreground shrink-0 p-3"
						onclick={() => dropToast(t.id)}
					>
						<X class="size-3.5" />
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

{#if isDesktop}
	{#if open}
		<!-- Hangs off the icon. Height is capped against the viewport rather than
		     fixed, so it never runs past the bottom of a short window. -->
		<div
			use:portal
			bind:this={panelEl}
			class="fixed z-[60] flex w-[24rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-2xl ring-1 ring-black/5"
			style="top: {pos.top}px; right: {pos.right}px; height: min(32rem, calc(100vh - {pos.top}px - 16px));"
			dir="rtl"
		>
			{@render panelBody()}
		</div>
	{/if}
{:else}
	<Sheet bind:open>
		<!-- Sized to the VISUAL viewport (see the effect above), with 100dvh as the
		     fallback where the API is missing. A 90dvh drawer hid the ✕ behind a
		     long conversation; top-0/bottom-0 fixed that but sized against the
		     layout viewport, which ignores the keyboard. This tracks what is
		     actually on screen. -->
		<SheetContent
			side="bottom"
			class="inset-x-0 bottom-auto top-[var(--chat-vvtop,0px)] h-[var(--chat-vvh,100dvh)] max-h-none gap-0 p-0 sm:max-w-full"
			showCloseButton={false}
		>
			{@render panelBody()}
		</SheetContent>
	</Sheet>
{/if}
