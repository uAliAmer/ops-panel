<script lang="ts">
	/**
	 * One conversation: the message list and the composer. Shared by the order
	 * detail's thread and the chat sheet's room/DM view, so the two cannot drift
	 * apart in how a message renders, how mentions are picked, or when a
	 * conversation is marked read.
	 *
	 * Knows nothing about WHICH conversation it is — order, room or DM. The
	 * caller resolves that and hands over an id.
	 */
	import { api, type ChatMessage, type ChatUser } from '$lib/api';
	import { socketStore, type ChatEvent } from '$lib/stores/socket.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Send, Trash2, AtSign, Loader2, Pencil, Check, CheckCheck, X, Package, Users, Pin } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { haptic } from '$lib/utils/haptic';
	import { cn } from '$lib/utils';
	import { avatarFor } from '$lib/utils/avatar';
	import { formatPrice } from '$lib/utils/format';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { playChatIn, playChatOut } from '$lib/utils/chatSound';

	type Props = {
		conversationId: string | null;
		/** Tailwind max-height for the scroller — a sheet has more room than a card. */
		heightClass?: string;
		placeholder?: string;
		emptyText?: string;
		/**
		 * Focus the composer once the conversation is up. Only for the chat
		 * panel: the order detail renders a thread inline on every order, and
		 * focusing there would throw a keyboard over the page each time an
		 * operator opened an order to read it.
		 */
		autofocus?: boolean;
		/**
		 * Called just before this thread navigates to an order. The chat panel
		 * uses it to shut itself: on a phone the sheet is the whole screen, so
		 * tapping an order card inside a message opened the order behind a sheet
		 * that was still covering it, and nothing looked like it had happened.
		 */
		onNavigate?: () => void;
	};
	let {
		conversationId,
		heightClass = 'max-h-[22rem]',
		placeholder = 'اكتب رسالة… استخدم @ للإشارة إلى زميل',
		emptyText = 'لا توجد رسائل بعد.',
		autofocus = false,
		onNavigate
	}: Props = $props();

	/** Every route out of a message goes through here, so the caller always hears. */
	function openOrder(slug: string) {
		onNavigate?.();
		void goto(`${base}/order/${slug}/`);
	}

	let messages = $state<ChatMessage[]>([]);
	let draft = $state('');
	let loading = $state(true);
	let sending = $state(false);
	let users = $state<ChatUser[]>([]);
	let mentionOpen = $state(false);
	let mentionQuery = $state('');
	/**
	 * Does the picker open upward?
	 *
	 * Upward is right on a phone, where the keyboard owns the bottom of the
	 * screen and a list under the input is unreachable. It is wrong in the order
	 * detail, where the thread is a short card partway down a scrolling column:
	 * there the list opened up out of the card and was clipped by the scroller.
	 * Measured when it opens, so each surface gets the answer that fits it.
	 */
	let mentionAbove = $state(true);
	let box = $state<HTMLDivElement | null>(null);
	let input = $state<HTMLTextAreaElement | null>(null);
	// The first message this operator had not read when the thread opened. Fixed
	// at that moment and kept until the conversation is re-opened: a marker that
	// moved as messages arrived would be a pointer to "the end", which is where
	// the eye already is.
	let firstUnreadId = $state<string | null>(null);
	/** TTL and name of the conversation, as the message page reported them. */
	let convMeta = $state<{ messageTtlMinutes: number | null } | null>(null);

	/** Where every OTHER member has read up to, for the ticks on your own lines. */
	let readers = $state<{ userId: string; name: string; lastReadAt: string | null }[]>([]);
	let editingId = $state<string | null>(null);
	let editDraft = $state('');
	let savingEdit = $state(false);
	// userId → the timer that clears them. A typing hint has to expire on its
	// own: the sender may close the tab mid-word and no "stopped" ever arrives.
	let typingUntil = $state<Record<string, number>>({});
	let lastTypingSent = 0;

	/**
	 * Messages that arrived while the eye was somewhere else.
	 *
	 * Every incoming message used to jump the scroller to the bottom. An operator
	 * scrolling back to read why a parcel was returned was thrown to the end of
	 * the thread the moment anyone else typed, which is the single most annoying
	 * thing a chat can do. Now the list only follows when it was already at the
	 * bottom; otherwise this counts what was missed and a pill offers the trip.
	 */
	let pendingNew = $state(0);

	/**
	 * Is this thread actually being looked at?
	 *
	 * The order detail mounts a thread on EVERY order, so without this a message
	 * landing in a background tab — or in a thread scrolled off the page — was
	 * marked read on arrival and its unread badge never appeared. Read means seen.
	 */
	let onScreen = $state(true);
	let tabVisible = $state(true);
	const beingRead = $derived(onScreen && tabVisible);

	/**
	 * Does Enter send? Only where there is a real keyboard.
	 *
	 * Keyed on (pointer: fine) rather than a width breakpoint: it asks whether
	 * this machine has a mouse-and-keyboard kind of input, which is the actual
	 * question. A narrow laptop window still sends on Enter; a tablet the size of
	 * a laptop still breaks the line, because its on-screen Return is where your
	 * thumb goes for a second line.
	 */
	let enterSends = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(pointer: fine)');
		const sync = () => (enterSends = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	/** The 2-day edit window the backend enforces — mirrored so the button is
	 *  simply absent rather than failing. */
	const EDIT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
	const editable = (m: ChatMessage) =>
		m.authorId === auth.user?.id &&
		!m.deletedAt &&
		Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;

	// VIEWER reads but does not post — the same rule the backend enforces,
	// mirrored so the composer is absent rather than failing on submit.
	const canPost = $derived(auth.user?.role === 'ADMIN' || auth.user?.role === 'OPERATOR');

	const typingNames = $derived(
		Object.keys(typingUntil)
			.map((id) => users.find((u) => u.id === id)?.name)
			.filter(Boolean) as string[]
	);

	/**
	 * "Everyone", offered like a colleague.
	 *
	 * Its id is not a user id and never travels as one — the server decides who
	 * everyone is, because that differs per conversation (the whole team in the
	 * shared room, the people already in an order's thread anywhere else).
	 */
	const EVERYONE = { id: '@everyone', name: 'الجميع', email: '', role: 'الكل مرة واحدة' } as ChatUser & {
		role: string;
	};
	const everyoneMatches = (q: string) =>
		!q || ['الجميع', 'الكل', 'everyone', 'all'].some((w) => w.startsWith(q.toLowerCase()));

	const mentionMatches = $derived([
		...(everyoneMatches(mentionQuery.trim()) ? [EVERYONE] : []),
		...(mentionQuery
			? users.filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5)
			: users.slice(0, 5))
	]);

	/**
	 * Add or replace by id. Both the POST response and the socket echo carry the
	 * message you just sent, and either can land first — appending blind put the
	 * same id in the list twice, which throws each_key_duplicate. Svelte kills
	 * the render effect when that happens, so the send button also stopped
	 * repainting and span forever.
	 */
	function upsert(list: ChatMessage[], m: ChatMessage) {
		const i = list.findIndex((x) => x.id === m.id);
		if (i === -1) return [...list, m];
		const next = [...list];
		next[i] = m;
		return next;
	}

	/**
	 * Order links unfurl into a card.
	 *
	 * An operator pasting /order/2026-000528/ means "look at this one", and a
	 * bare URL makes the reader open it to find out whether it is theirs. The
	 * card answers that in place — customer, city, total — and still opens the
	 * order on a tap.
	 */
	type Unfurl = { slug: string; name: string; where: string; total: string | null };
	let unfurls = $state<Record<string, Unfurl>>({});
	// Plain Set, deliberately not $state: the effect below must not re-run
	// because of its own writes.
	const requested = new Set<string>();

	// Any URL whose path contains /order/<slug>, whatever host it came from —
	// the panel is served from three of them.
	const ORDER_LINK = /\/order\/([A-Za-z0-9][A-Za-z0-9-]{3,})\/?/g;

	function slugsIn(text: string | null | undefined): string[] {
		if (!text) return [];
		const out: string[] = [];
		for (const m of text.matchAll(ORDER_LINK)) if (!out.includes(m[1])) out.push(m[1]);
		return out;
	}

	$effect(() => {
		for (const m of messages) {
			for (const slug of slugsIn(m.body)) {
				if (requested.has(slug)) continue;
				requested.add(slug);
				void (async () => {
					try {
						const res = await api.getOrder(slug);
						const o = res.data;
						if (!res.success || !o) return;
						unfurls = {
							...unfurls,
							[slug]: {
								slug,
								name: o.customerName ?? 'طلب',
								where: [o.cityName, o.regionName].filter(Boolean).join(' — '),
								total: o.price != null ? `${formatPrice(Number(o.price))} د.ع` : null
							}
						};
					} catch {
						// An order this operator cannot see, or a dead link. The raw
						// text stays exactly as it was typed.
					}
				})();
			}
		}
	});

	/**
	 * How many other members have read up to this message. A thread's ticks are
	 * per message rather than a single "seen" on the last one, because an
	 * operator scrolls back to ask why something was not picked up and needs to
	 * know whether THAT message was seen.
	 */
	function readCount(m: ChatMessage) {
		const at = new Date(m.createdAt).getTime();
		return readers.filter((r) => r.lastReadAt && new Date(r.lastReadAt).getTime() >= at).length;
	}

	/** Put the divider near the top, with a little of the read history above it. */
	function scrollToUnread() {
		requestAnimationFrame(() => {
			if (!box || !firstUnreadId) return;
			const el = box.querySelector<HTMLElement>(`[data-mid="${firstUnreadId}"]`);
			if (!el) return scrollToEnd();
			box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 48);
		});
	}

	function scrollToEnd() {
		// After the DOM settles — the new row has no height before it paints.
		requestAnimationFrame(() => {
			if (box) box.scrollTop = box.scrollHeight;
			pendingNew = 0;
		});
	}

	/** Within a line or two of the end — close enough that following is wanted. */
	const NEAR_BOTTOM_PX = 120;
	function atBottom() {
		if (!box) return true;
		return box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM_PX;
	}

	/** Scrolling back down by hand clears the pill just as tapping it would. */
	function onScroll() {
		if (pendingNew && atBottom()) pendingNew = 0;
	}

	$effect(() => {
		const el = box;
		if (!el || typeof window === 'undefined') return;
		const io = new IntersectionObserver(([e]) => (onScreen = e.isIntersecting), {
			threshold: 0.05
		});
		io.observe(el);
		const onVis = () => (tabVisible = document.visibilityState === 'visible');
		onVis();
		document.addEventListener('visibilitychange', onVis);
		return () => {
			io.disconnect();
			document.removeEventListener('visibilitychange', onVis);
		};
	});

	// Looking at a thread again is reading it — the catch-up for everything that
	// landed while it was off screen or in a background tab.
	$effect(() => {
		const id = conversationId;
		if (!beingRead || !id) return;
		void api.chatMarkRead(id);
	});

	$effect(() => {
		const id = conversationId;
		if (!id) {
			messages = [];
			loading = false;
			return;
		}
		let alive = true;
		loading = true;
		socketStore.joinConversation(id);

		(async () => {
			try {
				const page = await api.chatMessages(id);
				if (!alive) return;
				messages = page.data?.messages ?? [];

				// Your own messages never count as unread — you wrote them.
				readers = page.data?.readers ?? [];
				convMeta = page.data?.conversation ?? null;
				const readUpTo = page.data?.lastReadAt ? new Date(page.data.lastReadAt).getTime() : 0;
				firstUnreadId =
					messages.find(
						(m) => m.authorId !== auth.user?.id && new Date(m.createdAt).getTime() > readUpTo
					)?.id ?? null;

				// Land on the line, not the bottom: dropping someone at the end of a
				// thread they have not read leaves them scrolling back to find where
				// they stopped.
				if (firstUnreadId) scrollToUnread();
				else scrollToEnd();

				// Opening a conversation is reading it — unless it opened somewhere
				// nobody is looking, which is every other order in a list.
				if (messages.length && beingRead) void api.chatMarkRead(id);
				// After the list paints, so the caret is not scrolled away from.
				if (autofocus && canPost) requestAnimationFrame(() => input?.focus());
			} catch {
				if (alive) toast.error('تعذّر تحميل الرسائل');
			} finally {
				if (alive) loading = false;
			}
		})();

		return () => {
			alive = false;
			socketStore.leaveConversation(id);
		};
	});

	$effect(() => {
		const offNew = socketStore.onChatMessage((m: ChatEvent) => {
			if (m.conversationId !== conversationId) return;
			const known = messages.some((x) => x.id === m.id);
			// Measured BEFORE the row is added: once it is in the list the scroller
			// is taller and the answer is always "no".
			const follow = m.authorId === auth.user?.id || atBottom();
			messages = upsert(messages, m as ChatMessage);
			if (known) return;
			// Whoever just sent it stops "typing" the moment it lands.
			if (typingUntil[m.authorId]) {
				const { [m.authorId]: _gone, ...rest } = typingUntil;
				typingUntil = rest;
			}
			if (m.authorId !== auth.user?.id) playChatIn();
			if (follow) scrollToEnd();
			else pendingNew += 1;
			if (conversationId && beingRead) void api.chatMarkRead(conversationId);
		});
		const offEdit = socketStore.onChatEdited((m: ChatEvent) => {
			if (m.conversationId !== conversationId) return;
			messages = messages.map((x) => (x.id === m.id ? (m as ChatMessage) : x));
		});
		const offDel = socketStore.onChatDeleted(({ id }) => {
			messages = messages.map((x) =>
				x.id === id ? { ...x, body: null, deletedAt: new Date().toISOString() } : x
			);
		});
		const offPinned = socketStore.onChatPinned(({ conversationId: cid, messageId }) => {
			if (cid !== conversationId) return;
			messages = messages.map((x) =>
				x.id === messageId
					? { ...x, pinnedAt: new Date().toISOString() }
					: x.pinnedAt
						? { ...x, pinnedAt: null }
						: x
			);
		});
		const offPruned = socketStore.onChatPruned(({ conversationId: cid, expired }) => {
			if (cid !== conversationId) return;
			// Wiped by a member, or aged out by the retention worker. Either way the
			// server has forgotten them, so the screen must not keep showing them.
			messages = [];
			firstUnreadId = null;
			if (!expired) toast.info('مُسحت رسائل الغرفة');
		});
		const offReadBy = socketStore.onChatReadBy(({ conversationId: cid, userId, readAt }) => {
			if (cid !== conversationId) return;
			readers = readers.map((r) => (r.userId === userId ? { ...r, lastReadAt: readAt } : r));
		});
		const offTyping = socketStore.onChatTyping(({ conversationId: cid, userId }) => {
			if (cid !== conversationId || userId === auth.user?.id) return;
			typingUntil = { ...typingUntil, [userId]: Date.now() + 3000 };
			setTimeout(() => {
				if ((typingUntil[userId] ?? 0) <= Date.now()) {
					const { [userId]: _gone, ...rest } = typingUntil;
					typingUntil = rest;
				}
			}, 3200);
		});
		return () => {
			offNew();
			offEdit();
			offDel();
			offTyping();
			offReadBy();
			offPinned();
			offPruned();
		};
	});

	// Loaded for every role, not just posters: the directory also supplies the
	// names used to highlight mentions, and VIEWER reads mentions like anyone else.
	$effect(() => {
		if (users.length) return;
		void (async () => {
			try {
				const res = await api.chatUsers();
				users = res.data ?? [];
			} catch {
				/* the composer and highlighting both degrade to plain text */
			}
		})();
	});

	/**
	 * Split a body into plain text and mention runs. Matching is on "@" + a known
	 * name, longest first, so "@علي أحمد" wins over "@علي" when both exist.
	 * Cosmetic only — MessageMention rows, not this, decide who gets notified.
	 */
	type Seg =
		| { kind: 'text'; text: string }
		| { kind: 'mention'; text: string; self: boolean }
		| { kind: 'link'; text: string; href: string; slug: string | null };

	const URL_RE = /https?:\/\/[^\s<>"']+/g;

	/** Trailing punctuation belongs to the sentence, not to the address. */
	function trimUrl(raw: string) {
		return raw.replace(/[.,!?؟)\]]+$/, '');
	}

	/**
	 * Split a body into plain text, mentions and links.
	 *
	 * Links were rendered as text, so the address an operator pasted to say
	 * "look at this one" could not be clicked — only the card underneath it
	 * could, which is not where anyone aims. An order link navigates in-app;
	 * anything else opens in a new tab.
	 */
	/** Spellings the server accepts for "everyone" — kept in step with chat.js. */
	const EVERYONE_WORDS = ['الجميع', 'الكل', 'everyone'];

	function segments(text: string, me: string | undefined): Seg[] {
		const names = [...users.map((u) => u.name), auth.user?.name ?? '', ...EVERYONE_WORDS]
			.filter(Boolean)
			.sort((a, b) => b.length - a.length);

		const mentionsIn = (chunk: string): Seg[] => {
			const out: Seg[] = [];
			let i = 0;
			while (i < chunk.length) {
				if (chunk[i] === '@') {
					const hit = names.find((n) => chunk.startsWith('@' + n, i));
					if (hit) {
						// "Everyone" includes you, so it wears the same amber as being
						// named — it IS being named, along with everybody else.
						const self = hit === me || EVERYONE_WORDS.includes(hit);
						out.push({ kind: 'mention', text: '@' + hit, self });
						i += hit.length + 1;
						continue;
					}
				}
				const last = out[out.length - 1];
				if (last && last.kind === 'text') last.text += chunk[i];
				else out.push({ kind: 'text', text: chunk[i] });
				i += 1;
			}
			return out;
		};

		const out: Seg[] = [];
		let cursor = 0;
		for (const m of text.matchAll(URL_RE)) {
			const start = m.index ?? 0;
			if (start > cursor) out.push(...mentionsIn(text.slice(cursor, start)));
			const href = trimUrl(m[0]);
			const slug = href.match(/\/order\/([A-Za-z0-9][A-Za-z0-9-]{3,})\/?/)?.[1] ?? null;
			out.push({ kind: 'link', text: href, href, slug });
			cursor = start + href.length;
		}
		if (cursor < text.length) out.push(...mentionsIn(text.slice(cursor)));
		return out;
	}

	/**
	 * The composer grows with the message, up to about six lines.
	 *
	 * It was a fixed single row with resize disabled, and on a phone Enter makes
	 * a new line — so anything longer than one line was typed blind, with only
	 * the last line visible. Past the cap it scrolls instead of eating the thread.
	 */
	const COMPOSER_MAX_PX = 140;
	function growComposer() {
		const el = input;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
	}

	function onInput() {
		growComposer();
		// One ping every 2s while typing, not one per keystroke — the hint expires
		// after 3s on the receiving end, so this keeps it alive with no spam.
		if (conversationId && Date.now() - lastTypingSent > 2000) {
			lastTypingSent = Date.now();
			socketStore.emitTyping(conversationId);
		}
		// Only the "@" the caret sits inside opens the picker, not any "@" in the box.
		const caret = input?.selectionStart ?? draft.length;
		const upto = draft.slice(0, caret);
		const at = upto.lastIndexOf('@');
		if (at === -1) {
			mentionOpen = false;
			return;
		}
		const q = upto.slice(at + 1);
		// A query used to end at the first space, which made every two-part name —
		// which is to say every name here — unpickable: "@علي " closed the list
		// before أحمد could be typed. It now runs on while something still
		// matches, and gives up when nothing does or the line is clearly prose.
		const matches = q.trim()
			? users.some((u) => u.name.toLowerCase().includes(q.trim().toLowerCase()))
			: true;
		if (q.length > 32 || (!matches && /\s/.test(q))) {
			mentionOpen = false;
			return;
		}
		mentionQuery = q;
		// Room for five rows, or it flips under the box instead.
		const top = input?.getBoundingClientRect().top ?? 0;
		mentionAbove = top > 240;
		mentionOpen = true;
	}

	function pickMention(u: ChatUser) {
		const caret = input?.selectionStart ?? draft.length;
		const upto = draft.slice(0, caret);
		const at = upto.lastIndexOf('@');
		if (at === -1) return;
		draft = draft.slice(0, at) + '@' + u.name + ' ' + draft.slice(caret);
		mentionOpen = false;
		haptic(8);
		input?.focus();
		requestAnimationFrame(growComposer);
	}

	/**
	 * Mentions travel as ids, not as text for the server to re-parse: a name can
	 * repeat, contain spaces, or change later, and the stored rows are what the
	 * mentions view and push notifications read.
	 */
	function mentionedIds(text: string) {
		// Longest first, consuming as it goes: with "@علي أحمد" in the box, a
		// colleague called علي was being notified as well, because his name is a
		// prefix of the one actually typed.
		// The everyone tag is left in the text for the server to read; it has no
		// user id to send, and inventing one would mention nobody.
		const byLength = [...users].sort((a, b) => b.name.length - a.name.length);
		const ids: string[] = [];
		let rest = text;
		for (const u of byLength) {
			const tag = '@' + u.name;
			if (!rest.includes(tag)) continue;
			ids.push(u.id);
			rest = rest.split(tag).join(' ');
		}
		return ids;
	}

	async function send() {
		const body = draft.trim();
		if (!body || !conversationId || sending) return;
		sending = true;
		try {
			const res = await api.chatSend(conversationId, body, mentionedIds(body));
			if (res.success && res.data) {
				messages = upsert(messages, res.data);
				draft = '';
				mentionOpen = false;
				growComposer();
				scrollToEnd();
				haptic(10);
				playChatOut();
				// Sending with the button moves focus to the button, which drops the
				// keyboard on a phone mid-conversation. Put it back on the box.
				input?.focus();
			}
		} catch (err) {
			toast.error((err as Error).message || 'تعذّر الإرسال');
		} finally {
			sending = false;
		}
	}

	/**
	 * Focus the edit box as it appears, caret at the END rather than selecting
	 * the whole message: an edit is usually a word being fixed, and a full
	 * selection means the first keystroke wipes what you meant to correct.
	 */
	function focusEdit(node: HTMLTextAreaElement) {
		requestAnimationFrame(() => {
			node.focus();
			const end = node.value.length;
			try {
				node.setSelectionRange(end, end);
			} catch {
				/* not all engines allow it on a hidden node */
			}
		});
	}

	function startEdit(m: ChatMessage) {
		editingId = m.id;
		editDraft = m.body ?? '';
		haptic(8);
	}

	function cancelEdit() {
		editingId = null;
		editDraft = '';
		// Back to the composer, so the keyboard does not close and reopen.
		input?.focus();
	}

	async function saveEdit(m: ChatMessage) {
		const body = editDraft.trim();
		if (!body || savingEdit) return;
		if (body === m.body) return cancelEdit();
		savingEdit = true;
		try {
			const res = await api.chatEdit(m.id, body);
			if (res.success && res.data) messages = upsert(messages, res.data);
			cancelEdit();
		} catch (err) {
			toast.error((err as Error).message || 'تعذّر التعديل');
		} finally {
			savingEdit = false;
		}
	}

	/**
	 * Pin a line, or release it.
	 *
	 * The order card shows the pinned message in place of the newest one, which
	 * is how a standing instruction — "لا تسلّم قبل الاتصال" — stops scrolling
	 * away under ordinary chatter. It is also why operators no longer keep a
	 * separate note on the order: one place to write, and this is how a line in
	 * it is promoted.
	 */
	async function togglePin(m: ChatMessage) {
		const pinning = !m.pinnedAt;
		haptic(10);
		try {
			const res = await api.chatPin(m.id, pinning);
			if (res.success && res.data) {
				// One per conversation: whatever was pinned before is not any more.
				messages = messages.map((x) =>
					x.id === res.data!.id ? res.data! : x.pinnedAt ? { ...x, pinnedAt: null } : x
				);
			}
			toast.success(pinning ? 'ثُبّتت الرسالة — ستظهر على بطاقة الطلب' : 'أُلغي التثبيت');
		} catch (err) {
			toast.error((err as Error).message || 'تعذّر التثبيت');
		}
	}

	const pinned = $derived(messages.find((m) => m.pinnedAt && !m.deletedAt) ?? null);

	async function remove(m: ChatMessage) {
		try {
			await api.chatDelete(m.id);
			messages = messages.map((x) =>
				x.id === m.id ? { ...x, body: null, deletedAt: new Date().toISOString() } : x
			);
		} catch (err) {
			toast.error((err as Error).message || 'تعذّر الحذف');
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' || mentionOpen) return;
		// On a keyboard: Enter sends, Shift+Enter breaks the line — what anyone
		// typing at a desk expects. On a touch device Enter is the on-screen
		// Return and must make a new line, or half a sentence leaves mid-thought.
		// Ctrl/Cmd+Enter sends either way.
		if ((e.ctrlKey || e.metaKey) || (enterSends && !e.shiftKey)) {
			e.preventDefault();
			void send();
		}
	}

	/**
	 * Two messages belong to the same group when the same person sent them within
	 * five minutes. A group shows the avatar and name once at the top and the
	 * time once at the bottom — repeating both under every line is what made a
	 * short back-and-forth read as a wall of identical stamps.
	 */
	const GROUP_MS = 5 * 60 * 1000;
	const sameGroup = (a: ChatMessage | undefined, b: ChatMessage | undefined) =>
		!!a &&
		!!b &&
		a.authorId === b.authorId &&
		Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < GROUP_MS;

	const timeOf = (iso: string) =>
		new Date(iso).toLocaleString('ar-IQ', {
			hour: '2-digit',
			minute: '2-digit',
			day: '2-digit',
			month: '2-digit'
		});
</script>

<!-- px-1: overflow-y:auto also clips horizontally, and the meta row of your own
     messages sits hard against that edge in RTL — which shaved the corner off
     the read tick. -->
{#if pinned}
	<!-- Stated above the thread, not only marked inside it: the point of a pin is
	     that it is read by someone who has not scrolled. Tapping it goes to the
	     line itself, where it can be released. -->
	<button
		type="button"
		class="mb-1.5 flex w-full items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-right text-[11px] font-bold text-amber-800 dark:text-amber-300"
		onclick={() => {
			const el = box?.querySelector<HTMLElement>(`[data-mid="${pinned.id}"]`);
			if (el && box) box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 24);
		}}
	>
		<Pin class="size-3 shrink-0 fill-current" />
		<span class="truncate">{pinned.body}</span>
	</button>
{/if}

<div
	bind:this={box}
	onscroll={onScroll}
	class={cn('space-y-2 overflow-y-auto overscroll-contain px-1', heightClass)}
>
	{#if loading}
		<div class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs font-semibold">
			<Loader2 class="size-4 animate-spin" /> جارٍ التحميل…
		</div>
	{:else if !messages.length}
		<p class="text-muted-foreground py-6 text-center text-xs font-semibold">{emptyText}</p>
	{:else}
		{#each messages as m, i (m.id)}
			{@const mine = m.authorId === auth.user?.id}
			{@const prev = messages[i - 1]}
			{@const next = messages[i + 1]}
			<!-- The avatar is dropped inside a group: a column of the same face down
			     a back-and-forth is noise, and the gap is what makes a change of
			     speaker visible. -->
			{@const runs = sameGroup(prev, m)}
			<!-- The time is shown once, on the last message of the group. -->
			{@const showTime = !sameGroup(m, next)}
			{#if firstUnreadId === m.id}
				<div class="flex items-center gap-2 py-1">
					<span class="h-px flex-1 bg-rose-500/40"></span>
					<span class="text-[10px] font-black text-rose-600 dark:text-rose-400">رسائل جديدة</span>
					<span class="h-px flex-1 bg-rose-500/40"></span>
				</div>
			{/if}
			<div
				data-mid={m.id}
				class={cn('flex gap-2', mine ? 'flex-row' : 'flex-row-reverse', runs && '-mt-1')}
			>
				{#if !mine}
					<div class="w-7 shrink-0">
						{#if !runs}
							<img
								src={avatarFor(m.author?.name)}
								alt=""
								loading="lazy"
								class="size-7 rounded-full ring-1 ring-border/60"
							/>
						{/if}
					</div>
				{/if}
				<div class={cn('flex min-w-0 flex-1 flex-col gap-0.5', mine ? 'items-start' : 'items-end')}>
				<div
					class={cn(
						'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
						mine ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-secondary/70 ring-1 ring-border/50'
					)}
				>
					{#if !mine && !runs}
						<div class="text-muted-foreground mb-0.5 text-[11px] font-black">{m.author?.name}</div>
					{/if}
					{#if editingId === m.id}
						<!-- Edited in place, in the bubble: moving the text to the composer
						     would lose which message is being changed, which is the one
						     thing the operator needs to see while doing it. -->
						<textarea
							use:focusEdit
							bind:value={editDraft}
							rows="2"
							class="border-border/60 bg-background/70 w-full min-w-48 resize-none rounded-lg border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/30"
							onkeydown={(e) => {
								// Same rule as the composer: with a keyboard Enter saves and
								// Shift+Enter breaks the line, on touch Enter breaks the line,
								// and Escape abandons the edit either way.
								if (e.key === 'Escape') cancelEdit();
								if (
									e.key === 'Enter' &&
									(e.ctrlKey || e.metaKey || (enterSends && !e.shiftKey))
								) {
									e.preventDefault();
									void saveEdit(m);
								}
							}}
						></textarea>
						<div class="mt-1 flex items-center gap-1">
							<button
								type="button"
								class="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
								disabled={savingEdit || !editDraft.trim()}
								onclick={() => saveEdit(m)}
							>
								<Check class="size-3" /> حفظ
							</button>
							<button
								type="button"
								class="text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold"
								onclick={cancelEdit}
							>
								<X class="size-3" /> إلغاء
							</button>
						</div>
					{:else if m.deletedAt || m.body === null}
						<span class="text-muted-foreground text-xs italic">حُذفت الرسالة</span>
					{:else}
						<span class="break-words whitespace-pre-wrap"
							>{#each segments(m.body, auth.user?.name) as seg}{#if seg.kind === 'mention'}<span
										class={cn(
											'rounded px-1 font-black',
											// Amber when it is YOU being named, sky for anyone else.
											// This used to be text-primary, and --primary in the light
											// theme is oklch(0.205 0 0) — chroma zero, i.e. black. So a
											// mention rendered as bold black text and read as emphasis
											// rather than as a name. Dark mode's primary IS blue, which
											// is why it only looked wrong in half the app.
											seg.self
												? 'bg-amber-500/25 text-amber-800 dark:text-amber-300'
												: 'bg-sky-500/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300'
										)}>{seg.text}</span
									>{:else if seg.kind === 'link'}{#if seg.slug}<button
											type="button"
											class="text-primary underline underline-offset-2"
											onclick={() => openOrder(seg.slug!)}>{seg.text}</button
										>{:else}<a
											href={seg.href}
											target="_blank"
											rel="noopener noreferrer"
											class="text-primary underline underline-offset-2">{seg.text}</a
										>{/if}{:else}{seg.text}{/if}{/each}</span
						>
					{/if}

					{#if editingId !== m.id}
						<!-- Time, ticks and the controls live INSIDE the bubble, the way a
						     chat app puts them: they belong to the message, not to the gap
						     under it. It also takes the tick away from the scroller's edge,
						     which is what kept shaving its corner off. -->
						<span
							class="mt-1 flex items-center justify-end gap-1.5 text-[10px] leading-none opacity-70"
						>
							{#if showTime}
								<span class="tabular-nums">{timeOf(m.createdAt)}</span>
							{/if}
							{#if m.editedAt && !m.deletedAt}
								<span>عُدّلت</span>
							{/if}
							{#if canPost && !m.deletedAt}
								<!-- Anyone who can post can pin: the card it feeds is the
								     team's, not the author's. -->
								<button
									type="button"
									class={cn('hover:text-amber-600', m.pinnedAt && 'text-amber-600 dark:text-amber-400')}
									aria-label={m.pinnedAt ? 'إلغاء التثبيت' : 'تثبيت على بطاقة الطلب'}
									title={m.pinnedAt ? 'إلغاء التثبيت' : 'تثبيت — يظهر على بطاقة الطلب'}
									onclick={() => togglePin(m)}
								>
									<Pin class="size-3 shrink-0 overflow-visible {m.pinnedAt ? 'fill-current' : ''}" />
								</button>
							{/if}
							{#if editable(m)}
								<button
									type="button"
									class="hover:text-primary"
									aria-label="تعديل"
									onclick={() => startEdit(m)}
								>
									<Pencil class="size-3 shrink-0 overflow-visible" />
								</button>
							{/if}
							{#if mine && !m.deletedAt}
								<button
									type="button"
									class="hover:text-rose-600"
									aria-label="حذف"
									onclick={() => remove(m)}
								>
									<Trash2 class="size-3 shrink-0 overflow-visible" />
								</button>
								{@const seen = readCount(m)}
								<span
									class={cn(
										'inline-flex shrink-0 items-center gap-0.5',
										seen > 0 && 'text-sky-600 dark:text-sky-400'
									)}
									title={seen > 0 ? `قرأها ${seen}` : 'أُرسلت'}
								>
									{#if seen > 0}
										<CheckCheck class="size-3.5 shrink-0 overflow-visible" />
										{#if readers.length > 1}<span class="tabular-nums">{seen}</span>{/if}
									{:else}
										<Check class="size-3.5 shrink-0 overflow-visible" />
									{/if}
								</span>
							{/if}
						</span>
					{/if}
				</div>
				{#each slugsIn(m.body) as slug (slug)}
					{#if unfurls[slug]}
						<button
							type="button"
							class="border-border/60 bg-card/70 hover:bg-secondary/60 mt-1 flex max-w-[85%] items-center gap-2 rounded-xl border p-2 text-right transition-colors"
							onclick={() => openOrder(slug)}
						>
							<Package class="text-muted-foreground size-4 shrink-0" />
							<span class="min-w-0">
								<span class="flex items-center gap-1.5">
									<span class="truncate text-xs font-black">{unfurls[slug].name}</span>
									<span class="bg-secondary/70 text-muted-foreground shrink-0 rounded px-1 text-[10px] font-bold tabular-nums">
										{slug}
									</span>
								</span>
								<span class="text-muted-foreground block truncate text-[11px] font-semibold">
									{[unfurls[slug].where, unfurls[slug].total].filter(Boolean).join(' · ')}
								</span>
							</span>
						</button>
					{/if}
				{/each}

				</div>
			</div>
		{/each}
	{/if}
</div>

{#if pendingNew > 0}
	<!-- The list no longer yanks itself to the bottom under someone reading back
	     through it, so this is how they learn something arrived and get there in
	     one tap. -->
	<div class="pointer-events-none relative">
		<button
			type="button"
			class="bg-primary text-primary-foreground pointer-events-auto absolute -top-9 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black shadow-lg"
			onclick={scrollToEnd}
		>
			{pendingNew > 9 ? '+9' : pendingNew} رسائل جديدة ↓
		</button>
	</div>
{/if}

{#if convMeta?.messageTtlMinutes}
	<!-- Stated where someone is about to type, not only on the room's row: what
	     you are willing to write depends on whether it is kept. -->
	<p class="text-muted-foreground mt-1.5 px-1 text-[10px] font-semibold">
		تُحذف الرسائل تلقائياً بعد {convMeta.messageTtlMinutes / 60} ساعات
	</p>
{/if}

{#if typingNames.length}
	<!-- Under the list, above the composer: the one place it does not push the
	     conversation around as it appears and disappears. -->
	<div class="text-muted-foreground mt-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold">
		<span class="flex gap-0.5">
			<span class="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]"></span>
			<span class="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]"></span>
			<span class="size-1 animate-bounce rounded-full bg-current"></span>
		</span>
		<span>
			{typingNames.length === 1 ? `${typingNames[0]} يكتب…` : 'عدة أشخاص يكتبون…'}
		</span>
	</div>
{/if}

{#if canPost && conversationId}
	<div class="relative mt-3">
		{#if mentionOpen && mentionMatches.length}
			<!-- z-50, and the thread's card is raised too (see OrderThread): every
			     panel on the order detail carries backdrop-blur, which makes each
			     one its own stacking context — so a card later in the document
			     painted straight over this list and it read as not opening at all.
			     Height is capped and scrolls, rather than growing up out of a short
			     card and being clipped by the column behind it. -->
			<div
				class="border-border/60 bg-popover absolute z-50 max-h-56 w-full overflow-y-auto overscroll-contain rounded-xl border shadow-xl {mentionAbove
					? 'bottom-full mb-1'
					: 'top-full mt-1'}"
			>
				{#each mentionMatches as u (u.id)}
					<button
						type="button"
						class="hover:bg-secondary/70 flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold"
						onclick={() => pickMention(u)}
					>
						{#if u.id === '@everyone'}
							<Users class="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
							<span class="flex-1">الجميع</span>
							<!-- Who that is depends on the conversation and is decided by
							     the server: the whole team in the shared room, the people
							     already here anywhere else. -->
							<span class="text-muted-foreground text-[10px] font-semibold">تنبيه للجميع</span>
						{:else}
							<AtSign class="text-muted-foreground size-3.5 shrink-0" />
							{u.name}
						{/if}
					</button>
				{/each}
			</div>
		{/if}
		<div class="flex items-end gap-2">
			<textarea
				bind:this={input}
				bind:value={draft}
				oninput={onInput}
				onkeydown={onKeydown}
				onfocus={scrollToEnd}
				rows="1"
				{placeholder}
				class="border-border/60 bg-background/60 min-h-10 flex-1 resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
			></textarea>
			<Button
				size="icon"
				class="size-10 shrink-0 rounded-xl"
				disabled={!draft.trim() || sending}
				onclick={send}
				aria-label="إرسال"
				title={enterSends ? 'إرسال (Enter)' : 'إرسال (Ctrl+Enter)'}
			>
				{#if sending}
					<Loader2 class="size-4 animate-spin" />
				{:else}
					<Send class="size-4" />
				{/if}
			</Button>
		</div>
	</div>
{/if}
