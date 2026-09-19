<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fly, fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { goto, afterNavigate } from '$app/navigation';
	import { base } from '$app/paths';
	import { Toaster } from '$lib/components/ui/sonner';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Inbox, Loader2, ClipboardList, Box, AlertTriangle, X, MousePointerClick, RotateCcw, Store, Search, ScanLine } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ScanSearch from '$lib/components/ScanSearch.svelte';
	import OrderCard from '$lib/components/OrderCard.svelte';
	import OrderSkeleton from '$lib/components/OrderSkeleton.svelte';
	import EmptyPending from '$lib/components/EmptyPending.svelte';
	import IdleCreature from '$lib/components/IdleCreature.svelte';
	import OrderDetail from '$lib/components/OrderDetail.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { socketStore } from '$lib/stores/socket.svelte';
	import { api, type Order } from '$lib/api';
	import { orderSlug } from '$lib/utils/orderSlug';
	import { RESELLER_STORES } from '$lib/utils/source';
	import { orderBranchLabel } from '$lib/utils/carrierBranch';
	import { playNewOrderSound, blinkTabTitle } from '$lib/utils/notifier';
	import { useRefresh } from '$lib/utils/refresh.svelte';
	import { haptic } from '$lib/utils/haptic';

	// 'returns' is not a lifecycle stage like the other three — it cuts across
	// all of them. It earns a tab anyway because a return is stock and cash
	// coming back, and it was previously scattered through سابقة with nothing
	// to gather it. `tabForStatus` never returns it, by design.
	type Tab = 'pending' | 'approved' | 'history' | 'returns' | 'dropship';

	function getInitialTab(): Tab {
		if (!browser) return 'pending';
		const saved = sessionStorage.getItem('opsActiveTab');
		// 'returns' is restored too, but the tab only exists while returns do —
		// loadReturns() sends the operator back to بانتظار if the queue emptied
		// while they were away, so a reload never lands on a tab with no trigger.
		if (
			saved === 'pending' ||
			saved === 'approved' ||
			saved === 'history' ||
			saved === 'returns' ||
			saved === 'dropship'
		) {
			return saved as Tab;
		}
		return 'pending';
	}

	let activeTab = $state<Tab>(getInitialTab());

	$effect(() => {
		if (browser) {
			sessionStorage.setItem('opsActiveTab', activeTab);
		}
	});

	// Sales channel. Genelog stamps storeName on reseller-portal orders —
	// "Dropship" when it ships to the reseller's customer, "Wholesale" when the
	// reseller is restocking their own shelf. Our own storefronts stamp their
	// brand and the public form stamps nothing. 'store' therefore has to mean
	// "not one of the reseller channels" rather than a list of brands, or it
	// would hide every form and ops-entered order.
	//
	// RESELLER_STORES covers both, so a wholesale order is never left in the
	// consumer bucket just because it is not dropship.
	const RESELLER_STORE_PARAM = RESELLER_STORES.join(',');
	type Channel = 'all' | 'store' | 'dropship';

	function getInitialChannel(): Channel {
		if (!browser) return 'all';
		const saved = sessionStorage.getItem('opsChannel');
		return saved === 'store' || saved === 'dropship' ? saved : 'all';
	}

	let channel = $state<Channel>(getInitialChannel());

	/** Query params that narrow a listOrders call to the selected channel. */
	function channelParams(): Record<string, string> {
		if (channel === 'dropship') return { storeName: RESELLER_STORE_PARAM };
		if (channel === 'store') return { excludeStoreName: RESELLER_STORE_PARAM };
		return {};
	}

	// Parcels the carrier tried and failed to deliver — no answer, phone off,
	// wrong address. They sit in سابقة at SENT_TO_CARRIER looking finished, which
	// is why they need pulling to the front: nothing else in this UI distinguishes
	// a parcel in transit from one that has stopped moving.
	//
	// It matters most for dropship, where we deliberately never contact the
	// customer, so the only fix is the operator phoning the reseller.
	let attentionCount = $state(0);
	let attentionOnly = $state(false);
	/** The newest few, for the line under the count. A bare number says something
	 *  is wrong without saying what, which leaves opening the filter as the only
	 *  way to find out — and that is the whole trip this strip should save. */
	let attentionTop = $state<Order[]>([]);

	/**
	 * A dismissal, remembered against the count it was made at.
	 *
	 * Stalls can sit for days while the operator works them by phone, and a strip
	 * that cannot be put away is one that gets read past. Hiding it holds until
	 * another parcel stalls — the number going up is new information — or until
	 * the shift-length window runs out.
	 */
	const ATTENTION_DISMISS_KEY = 'attentionDismissed';
	const ATTENTION_DISMISS_MS = 8 * 60 * 60 * 1000;
	let attentionDismissed = $state<{ count: number; at: number } | null>(readAttentionDismissal());

	function readAttentionDismissal() {
		if (!browser) return null;
		try {
			const raw = localStorage.getItem(ATTENTION_DISMISS_KEY);
			if (!raw) return null;
			const v = JSON.parse(raw) as { count: number; at: number };
			return typeof v?.count === 'number' && typeof v?.at === 'number' ? v : null;
		} catch {
			return null;
		}
	}

	function dismissAttention() {
		haptic(8);
		attentionDismissed = { count: attentionCount, at: Date.now() };
		try {
			localStorage.setItem(ATTENTION_DISMISS_KEY, JSON.stringify(attentionDismissed));
		} catch {
			/* nothing to remember it with — it returns on the next load */
		}
	}

	const attentionHidden = $derived(
		!!attentionDismissed &&
			attentionCount <= attentionDismissed.count &&
			Date.now() - attentionDismissed.at < ATTENTION_DISMISS_MS
	);

	/** The branch the named parcel went out from, for the chip on the strip:
	 *  which counter to walk to is half of what an operator does about it. */
	const attentionBranch = $derived(attentionTop[0] ? orderBranchLabel(attentionTop[0]) : '');

	/** "سعاد — كربلاء · لا يرد", plus how many more are behind it. */
	const attentionDetail = $derived.by(() => {
		const first = attentionTop[0];
		if (!first) return '';
		const reason = (first.shipment?.alwaseetStatusName || first.shipment?.alwaseetIssueNotes || '').trim();
		const who = [first.customerName, first.cityName].filter(Boolean).join(' — ');
		const head = [who, reason].filter(Boolean).join(' · ');
		const rest = attentionCount - 1;
		return rest > 0 ? `${head} · و${rest} غيرها` : head;
	});

	async function loadAttentionCount() {
		if (!auth.isAuthenticated) return;
		try {
			// A few rows, not one: the total still comes from the server, and the
			// newest is what the strip names.
			const res = await api.listOrders({
				carrierClass: 'ATTENTION',
				limit: 3,
				sortBy: 'updatedAt',
				...channelParams()
			});
			attentionCount = res.pagination?.total ?? 0;
			attentionTop = res.data ?? [];
		} catch {
			/* a count is decoration; never surface its failure */
		}
	}

	async function toggleAttention() {
		haptic(8);
		attentionOnly = !attentionOnly;
		// These parcels are all SENT_TO_CARRIER, which lives in سابقة. Filtering
		// while another tab is open would show an empty list and read as a bug.
		if (attentionOnly) activeTab = 'history';
		historyPage = 1;
		await loadHistory(1);
	}

	/**
	 * Leaving سابقة clears the filter.
	 *
	 * It only ever applied to that tab, but it stayed on when the operator moved
	 * away — so coming back showed a short list with no sign of why, and the only
	 * way anyone found out of it was reloading the page.
	 */
	$effect(() => {
		if (attentionOnly && activeTab !== 'history') {
			attentionOnly = false;
			historyPage = 1;
			void loadHistory(1);
		}
	});

	// Narrowing the channel changes which stalls are in scope, so the count has
	// to follow it — otherwise "٣ شحنات" stays on screen next to an empty list.
	$effect(() => {
		void channel;
		void loadAttentionCount();
	});

	let loading = $state(false);
	let historyLoading = $state(false);
	let searchQuery = $state('');
	let searchOpen = $state(false);
	let orders = $state<Record<Tab, Order[]>>({
		pending: [],
		approved: [],
		history: [],
		returns: [],
		dropship: []
	});
	let dropshipLoading = $state(false);

	/**
	 * What the tab's badge counts: reseller orders with work left in them.
	 *
	 * It used to count the rows in the list, and this list is a standing view of
	 * the whole reseller book — so a delivered order from last month kept the
	 * badge lit and the number meant nothing. Every other tab's badge is a queue
	 * length; this one now is too. The list itself still shows everything.
	 *
	 * Counted by the server rather than filtered out of the loaded page: the list
	 * is capped at 100 by updatedAt, so a quiet open order can sit past the cap
	 * and would go uncounted exactly when it most needs chasing.
	 */
	const RESELLER_OPEN_STATUSES = 'PENDING_REVIEW,FAILED,APPROVED,PACKED';
	let dropshipOpen = $state(0);
	// Paged like سابقة, and for the same reason: the reseller book only grows,
	// and a single capped fetch quietly hides everything past the cap — the
	// oldest orders, which are the ones nobody is watching.
	let dropshipPage = $state(1);
	let dropshipTotalPages = $state(1);

	let historyPage = $state(1);
	let historyTotalPages = $state(1);
	// Server-side totals — pending/approved fetch only the first 100, so when
	// total > shown we surface a "more exist" hint instead of hiding them silently.
	let pendingTotal = $state(0);
	let approvedTotal = $state(0);

	let stopRefresh: (() => void) | null = null;
	let pendingIdsSnapshot = new Set<string>();
	let freshArrivedIds = $state<Set<string>>(new Set());
	let searchBarEl: HTMLDivElement | undefined = $state();

	// Cross-session "seen" set: which pending orders the operator has already had
	// loaded in their list. Persisted so the first load of a fresh session can
	// alert on orders that arrived while they were away (the in-memory snapshot
	// can't — it resets to empty every page load).
	const SEEN_KEY = 'ops_seen_pending_ids';
	function loadSeenIds(): Set<string> {
		if (!browser) return new Set();
		try {
			return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
		} catch {
			return new Set();
		}
	}
	function saveSeenIds(ids: string[]): void {
		if (!browser) return;
		try {
			localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
		} catch {
			/* quota / disabled storage — ignore */
		}
	}

	// Desktop master–detail: selected order shown inline in the right pane.
	let selectedId = $state<string | null>(null);
	let isDesktop = $state(false);

	// سابقة is split into "last 2 days" and "older" so a just-finished order is
	// visually separated from the long archive.
	const HISTORY_SPLIT_MS = 48 * 60 * 60 * 1000;
	function lastTouched(o: Order): number {
		return new Date(String(o.updatedAt ?? o.createdAt)).getTime();
	}
	const historyRecent = $derived(
		orders.history.filter((o) => Date.now() - lastTouched(o) < HISTORY_SPLIT_MS)
	);
	const historyOlder = $derived(
		orders.history.filter((o) => Date.now() - lastTouched(o) >= HISTORY_SPLIT_MS)
	);

	// Server-side search results
	let searchResults = $state<Order[]>([]);
	let searchLoading = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	const isSearching = $derived(searchQuery.trim().length > 0);

	// When not searching, just use local tab data (no filtering needed)
	const filteredOrders = $derived(isSearching ? searchResults : orders[activeTab]);

	// Items for the mobile floating glass tab capsule. Same tabs as the desktop
	// strip; إرجاع only appears while returns exist (a permanently empty tab
	// wastes a fifth of the bar and trains operators to ignore it).
	const bottomTabs = $derived(
		[
			{ key: 'pending', label: 'بانتظار', icon: Inbox, count: orders.pending.length },
			{ key: 'approved', label: 'للتجهيز', icon: Box, count: orders.approved.length },
			{ key: 'history', label: 'سابقة', icon: ClipboardList, count: 0 },
			// Holds both reseller channels now, so it is no longer only دروبشيب.
			// The tab key stays 'dropship' — it is persisted in sessionStorage and
			// renaming it would drop every operator back to the first tab once.
			{ key: 'dropship', label: 'الموزعين', icon: Store, count: dropshipOpen },
			...(orders.returns.length > 0
				? [{ key: 'returns', label: 'إرجاع', icon: RotateCcw, count: orders.returns.length }]
				: [])
		] as { key: Tab; label: string; icon: typeof Inbox; count: number }[]
	);

	// Sliding pill for both tab bars (transitions-dev 16 — tabs sliding): the
	// mobile capsule and the desktop strip. JS measures the active tab and writes
	// offsetLeft / offsetWidth onto that bar's pill; the CSS in app.css owns the
	// tween. Measuring works unchanged in RTL — offsetLeft is a distance from the
	// bar's left edge either way.
	//
	// Both bars exist in the DOM at every width; only one is visible (`hidden
	// lg:block` / `lg:hidden`). A hidden bar measures 0, which is harmless — the
	// ResizeObserver re-measures it when the breakpoint reveals it.
	let capsuleEl = $state<HTMLElement | null>(null);
	let pillEl = $state<HTMLElement | null>(null);
	let tabEls = $state<Record<string, HTMLElement | null>>({});
	let stripEl = $state<HTMLElement | null>(null);
	let stripPillEl = $state<HTMLElement | null>(null);
	// Seeded with a null per tab, not left empty: TabsTrigger's `ref` prop has a
	// `null` fallback, and Svelte refuses `bind:` against an undefined value
	// (props_invalid_value) — an empty record hands it undefined on first render.
	let stripTabEls = $state<Record<string, HTMLElement | null>>({
		pending: null,
		approved: null,
		history: null,
		dropship: null,
		returns: null
	});
	// First paint has to snap, or a pill flies in from translateX(0)/width:0.
	let placed = { capsule: false, strip: false };
	// When the last animated move started, so a relayout that lands mid-slide can
	// be told apart from one that arrives while the pill is at rest.
	let slideStartedAt = 0;

	/** The pill's own transition length, read from the motion token it uses. */
	function slideMs(): number {
		if (!browser) return 250;
		const raw = getComputedStyle(document.documentElement).getPropertyValue('--duration-fast');
		const ms = parseFloat(raw);
		return Number.isFinite(ms) ? (raw.includes('ms') ? ms : ms * 1000) : 250;
	}

	function moveOnePill(
		pill: HTMLElement | null,
		tab: HTMLElement | null | undefined,
		animate: boolean
	) {
		if (!pill || !tab || !tab.offsetWidth) return;
		if (!animate) {
			const prev = pill.style.transition;
			pill.style.transition = 'none';
			pill.style.transform = `translateX(${tab.offsetLeft}px)`;
			pill.style.width = `${tab.offsetWidth}px`;
			void pill.offsetWidth;
			pill.style.transition = prev;
		} else {
			pill.style.transform = `translateX(${tab.offsetLeft}px)`;
			pill.style.width = `${tab.offsetWidth}px`;
		}
	}

	/** `newSlide` false = a correction to a slide already running, which must not
	 *  extend the in-flight window or a stream of resizes would hold it open. */
	function movePills(animate: boolean, newSlide = true) {
		moveOnePill(pillEl, tabEls[activeTab], animate && placed.capsule);
		moveOnePill(stripPillEl, stripTabEls[activeTab], animate && placed.strip);
		if (tabEls[activeTab]?.offsetWidth) placed.capsule = true;
		if (stripTabEls[activeTab]?.offsetWidth) placed.strip = true;
		if (animate && newSlide) slideStartedAt = performance.now();
	}

	// Re-measure whenever the active tab changes or a bar's contents do (the إرجاع
	// tab appears and disappears with the returns queue, which reflows every other
	// tab in both bars).
	$effect(() => {
		activeTab;
		bottomTabs.length;
		tabEls;
		stripTabEls;
		requestAnimationFrame(() => movePills(true));
	});

	// A bar changing size has to re-measure, but HOW it re-measures depends on
	// timing. سابقة loads twenty rows, which gives the scroll container a
	// scrollbar and takes ~15px off the bar's width — and that lands while the
	// pill is still sliding toward سابقة. Snapping there cancels the slide
	// outright, so a relayout arriving mid-flight keeps animating to the
	// corrected geometry; only one that arrives at rest snaps.
	//
	// (Invisible on a mac or in headless Chrome, where scrollbars are overlays
	// and take no width.)
	$effect(() => {
		if (!capsuleEl && !stripEl) return;
		const ro = new ResizeObserver(() => {
			movePills(performance.now() - slideStartedAt < slideMs(), false);
		});
		if (capsuleEl) ro.observe(capsuleEl);
		if (stripEl) ro.observe(stripEl);
		return () => ro.disconnect();
	});

	async function runSearch(q: string) {
		if (!q.trim()) { searchResults = []; return; }
		searchLoading = true;
		try {
			const res = await api.listOrders({ search: q.trim(), limit: 100, ...channelParams() });
			searchResults = res.data ?? [];
		} catch {
			searchResults = [];
		} finally {
			searchLoading = false;
		}
	}

	$effect(() => {
		const q = searchQuery;
		if (searchTimer) clearTimeout(searchTimer);
		if (!q.trim()) { searchResults = []; return; }
		searchLoading = true; // show spinner immediately on keypress
		searchTimer = setTimeout(() => void runSearch(q), 350);
	});

	// ---- scan to open --------------------------------------------------------
	// Every branch labels its parcels, so every branch has a number it can scan;
	// the operator holding the parcel should not have to type nine digits with
	// their other hand. Two ways in, both landing here:
	//
	//   • a hardware scanner, which types the digits and presses Enter
	//   • the camera, via ScanSearch
	//
	// One match opens it. Several (or none) leave the list on screen, because a
	// wrong parcel opened silently is worse than a list to pick from.
	let scanOpen = $state(false);

	async function jumpToMatch(query: string) {
		const q = query.trim();
		if (!q) return;
		if (searchTimer) clearTimeout(searchTimer);
		searchLoading = true;
		await runSearch(q);
		if (searchResults.length === 1) {
			const only = searchResults[0];
			searchOpen = false;
			searchQuery = '';
			searchResults = [];
			openOrder(only);
		}
	}

	/**
	 * What a scan actually means.
	 *
	 * A bare number is the carrier's tracking id and goes straight through. An
	 * ORD key has to survive whole — pulling "the digits" out of «2026-000512»
	 * yields «000512», which is a different order or none. Anything else (a
	 * rating URL, a tracking link) carries the number as its last long digit run.
	 */
	function parseScan(value: string): string {
		const t = value.trim();
		if (/^\d+$/.test(t)) return t;
		const ord = t.match(/(?:ORD-)?(\d{4}-\d{4,})/i);
		if (ord) return ord[1];
		const runs = t.match(/\d{6,}/g);
		return runs ? runs[runs.length - 1] : t;
	}

	function onScanned(value: string) {
		const q = parseScan(value);
		searchQuery = q;
		searchOpen = true;
		void jumpToMatch(q);
	}

	async function loadHistory(page = 1) {
		historyLoading = true;
		try {
			// SENT_TO_CARRIER is included — parcel is out with the carrier,
			// operator action is done. SUCCESS/REJECTED/CANCELLED are terminal.
			// Sorted by updatedAt so a just-finished order is at the top of the
			// tab — operators see where it landed instead of it sinking to its
			// createdAt position pages deep.
			const res = await api.listOrders({
				status: 'SENT_TO_CARRIER,SUCCESS,COMPLETED_MANUAL,REJECTED,CANCELLED',
				sortBy: 'updatedAt',
				page,
				limit: 20,
				...(attentionOnly ? { carrierClass: 'ATTENTION' } : {}),
				...channelParams()
			});
			orders = { ...orders, history: res.data ?? [] };
			historyPage = res.pagination?.page ?? 1;
			historyTotalPages = res.pagination?.totalPages ?? 1;
		} catch (err) {
			toast.error(`فشل تحميل السابق: ${(err as Error).message}`);
		} finally {
			historyLoading = false;
		}
	}

	// Paging from the footer leaves you scrolled to the bottom, so the next page
	// opens mid-list and its first orders are never seen. Only the buttons reset
	// the scroll — loadHistory() also runs on refresh, where yanking the operator
	// back to the top would lose their place.
	// Two scrollers to reset: on lg+ the list is its own overflow-y-auto column,
	// below that the window scrolls.
	let historyColumn = $state<HTMLElement | null>(null);
	let dropshipColumn = $state<HTMLElement | null>(null);
	async function goHistoryPage(page: number) {
		await loadHistory(page);
		await tick();
		historyColumn?.scrollTo({ top: 0 });
		window.scrollTo({ top: 0 });
	}

	async function goDropshipPage(page: number) {
		await loadDropship(page);
		await tick();
		dropshipColumn?.scrollTo({ top: 0 });
		window.scrollTo({ top: 0 });
	}

	async function loadOrders(opts: { silent?: boolean } = {}) {
		if (!auth.isAuthenticated) return;
		if (!opts.silent) loading = true;
		try {
			const [pending, approved] = await Promise.all([
				// بانتظار: orders needing operator action
				api.listOrders({ status: 'PENDING_REVIEW,FAILED', limit: 100, ...channelParams() }),
				// للتجهيز: orders greenlit but not yet sent (the packing queue)
				api.listOrders({ status: 'APPROVED,PACKED', limit: 100, ...channelParams() })
			]);
			const nextPending = pending.data ?? [];
			const pendingIds = nextPending.map((o) => o.submissionId);
			const newIds = pendingIds.filter((id) => !pendingIdsSnapshot.has(id));
			orders = { ...orders, pending: nextPending, approved: approved.data ?? [] };
			pendingTotal = pending.pagination?.total ?? nextPending.length;
			approvedTotal = approved.pagination?.total ?? orders.approved.length;
			if (pendingIdsSnapshot.size > 0 && newIds.length > 0) {
				// Live alert: a new order landed while the session was open.
				freshArrivedIds = new Set([...freshArrivedIds, ...newIds]);
				setTimeout(() => {
					freshArrivedIds = new Set();
				}, 3500);
				playNewOrderSound();
				blinkTabTitle(newIds.length);
				toast.info(newIds.length > 1 ? `${newIds.length} طلبات جديدة` : 'طلب جديد وصل');
			} else if (pendingIdsSnapshot.size === 0) {
				// First load of this session: alert on orders that arrived while the
				// operator was away (not in the persisted seen set).
				const seen = loadSeenIds();
				const unseen = pendingIds.filter((id) => !seen.has(id));
				if (unseen.length > 0) {
					playNewOrderSound();
					blinkTabTitle(unseen.length);
					toast.info(
						unseen.length > 1 ? `${unseen.length} طلبات جديدة بانتظارك` : 'طلب جديد بانتظارك'
					);
				}
			}
			pendingIdsSnapshot = new Set(pendingIds);
			saveSeenIds(pendingIds);
		} catch (err) {
			if (!opts.silent) toast.error(`فشل التحميل: ${(err as Error).message}`);
		} finally {
			loading = false;
		}
	}

	// إرجاع is a work queue, not an archive: only returns still coming back.
	// A finished one leaves it entirely rather than sitting below a divider —
	// it is still findable in سابقة. "Open" is defined on the backend now: a
	// carrier return closes on its lifecycle status, a LOCAL return stays until
	// its item is received back (returnReceivedAt) even after it was delivered.
	//
	// Returns and replacements still in flight. Not paged: a handful exist, and
	// a queue you can see all of does not need a footer.
	async function loadReturns() {
		if (!auth.isAuthenticated) return;
		try {
			const res = await api.listOrders({
				returns: '1',
				sortBy: 'updatedAt',
				limit: 100,
				...channelParams()
			});
			orders = { ...orders, returns: res.data ?? [] };
			// The tab is only rendered while the queue has rows. Leaving the
			// operator on a trigger that no longer exists shows a blank pane.
			if (activeTab === 'returns' && orders.returns.length === 0) activeTab = 'pending';
		} catch {
			/* a secondary queue; its failure must not blank the main list */
		}
	}

	// الموزعين tab: ALL reseller orders regardless of status/channel filter — a
	// standing view of the reseller book, dropship and wholesale together. The
	// two are one relationship seen from two sides: the same wholesaler shipping
	// to their customer, and that wholesaler buying stock for themselves. An
	// operator chasing one of them is chasing the same person.
	//
	// Independent of `channel` on purpose: this IS the reseller channel by
	// definition. Sorted by updatedAt so a just-touched order floats to the top.
	async function loadDropship(page = dropshipPage) {
		dropshipLoading = true;
		try {
			const [res, open] = await Promise.all([
				api.listOrders({
					storeName: RESELLER_STORE_PARAM,
					sortBy: 'updatedAt',
					page,
					limit: 20
				}),
				// limit:1 — the total is the answer, not the rows.
				api
					.listOrders({
						storeName: RESELLER_STORE_PARAM,
						status: RESELLER_OPEN_STATUSES,
						limit: 1
					})
					.catch(() => null)
			]);
			dropshipOpen = open?.pagination?.total ?? 0;
			orders = { ...orders, dropship: res.data ?? [] };
			dropshipPage = res.pagination?.page ?? 1;
			dropshipTotalPages = res.pagination?.totalPages ?? 1;
		} catch (err) {
			toast.error(`فشل تحميل طلبات الموزعين: ${(err as Error).message}`);
		} finally {
			dropshipLoading = false;
		}
	}

	async function loadAll(opts: { silent?: boolean } = {}) {
		await Promise.all([
			loadOrders(opts),
			loadHistory(historyPage),
			loadAttentionCount(),
			loadReturns(),
			loadDropship()
		]);
	}

	async function setChannel(next: Channel) {
		if (channel === next) return;
		haptic(8);
		channel = next;
		if (browser) sessionStorage.setItem('opsChannel', next);
		// The snapshot drives the "new order arrived" sound by diffing pending
		// ids against the last load. Narrowing the channel hides ids and
		// widening it brings them all back at once, which the diff would read
		// as a burst of new orders and announce. Clearing it makes the next
		// load a first load, which only alerts on genuinely unseen ids.
		pendingIdsSnapshot = new Set();
		historyPage = 1;
		if (isSearching) await runSearch(searchQuery);
		await loadAll();
	}

	// Which tab a given order status belongs to (for deep-link selection).
	function tabForStatus(s: string | undefined | null): Tab {
		if (s === 'PENDING_REVIEW' || s === 'FAILED') return 'pending';
		if (s === 'APPROVED' || s === 'PACKED') return 'approved';
		return 'history';
	}

	// Keep the address bar on the order's shareable link while it's open in the
	// desktop pane (replaceState → no SvelteKit navigation, the split stays put).
	function setOrderUrl(slug: string) {
		if (browser) history.replaceState(history.state, '', `${base}/order/${slug}/`);
	}
	function clearOrderUrl() {
		if (browser) history.replaceState(history.state, '', `${base}/`);
	}

	function openOrder(order: Order) {
		haptic(10);
		// Desktop: open inline in the split pane (no route change → keeps the list)
		// but sync the URL so it's copy-pasteable to share.
		// Mobile: navigate to the full-screen detail route.
		if (isDesktop) {
			selectedId = order.id;
			setOrderUrl(orderSlug(order));
		} else {
			// Remember where the list was scrolled, keyed by tab, so returning from
			// the full-screen detail lands back in place. SvelteKit's own scroll
			// restore fires before the list re-fetches (empty page = clamped to top),
			// so we restore manually once the cards are back — see the effect below.
			try {
				sessionStorage.setItem('opsScroll:' + activeTab, String(window.scrollY));
			} catch { /* storage may be unavailable */ }
			void goto(`${base}/order/${orderSlug(order)}/`);
		}
	}

	// Restore the list scroll when we come BACK from a detail route (mobile). The
	// list re-fetches on mount, so the page is short at first — SvelteKit's own
	// restore (and a one-shot scrollTo) both land at the top before the cards
	// arrive. So we poll each frame until the page is actually tall enough to hold
	// the saved offset (or give up), then jump there.
	afterNavigate(() => {
		if (!browser) return;
		if (window.matchMedia('(min-width: 1024px)').matches) return; // desktop uses the pane
		let saved: string | null = null;
		try {
			saved = sessionStorage.getItem('opsScroll:' + activeTab);
			if (saved != null) sessionStorage.removeItem('opsScroll:' + activeTab);
		} catch { /* storage may be unavailable */ }
		if (saved == null) return;
		const y = parseInt(saved, 10) || 0;
		if (y <= 0) return;
		let tries = 0;
		const settle = () => {
			const reachable = document.documentElement.scrollHeight - window.innerHeight;
			if (reachable >= y || tries > 60) {
				window.scrollTo(0, y);
				return; // page tall enough (or we waited long enough) — done
			}
			tries++;
			requestAnimationFrame(settle);
		};
		requestAnimationFrame(settle);
	});

	onMount(() => {
		if (!browser) return;
		const mq = window.matchMedia('(min-width: 1024px)');
		const update = () => {
			isDesktop = mq.matches;
			if (!isDesktop) selectedId = null; // collapsing to mobile clears the pane
		};
		update();
		// Desktop deep-link: /admin/?order=<slug> opens that order in the split
		// pane (so a shared link shows the full desktop view, not a bare detail).
		const params = new URLSearchParams(window.location.search);
		const deepOrder = params.get('order');
		if (deepOrder && isDesktop) {
			params.delete('order');
			const qs = params.toString();
			history.replaceState(history.state, '', `${location.pathname}${qs ? '?' + qs : ''}`);
			// Resolve the slug to the real id + status so the matching card is
			// highlighted and the right tab is selected.
			void (async () => {
				try {
					const res = await api.getOrder(deepOrder);
					if (res.success && res.data) {
						activeTab = tabForStatus(res.data.status);
						selectedId = res.data.id;
						setOrderUrl(orderSlug(res.data));
						return;
					}
				} catch {
					/* fall back to opening the pane by slug */
				}
				selectedId = deepOrder;
				setOrderUrl(deepOrder);
			})();
		}
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});

	function refreshFromUpdate() {
		void loadAll();
	}

	// Pulse the tab an order just moved to, so the operator's eye follows it.
	let pulsingTab = $state<Tab | null>(null);
	let pulseTimer: ReturnType<typeof setTimeout> | null = null;
	function pulseTab(tab: Tab) {
		pulsingTab = tab;
		if (pulseTimer) clearTimeout(pulseTimer);
		pulseTimer = setTimeout(() => (pulsingTab = null), 1600);
	}

	// An action moved the order to another tab: refresh, pulse the destination,
	// and let toast actions jump straight to it.
	function orderMoved(tab: Tab) {
		void loadAll({ silent: true });
		pulseTab(tab);
	}
	function goToTab(tab: Tab) {
		activeTab = tab;
		pulseTab(tab);
	}

	$effect(() => {
		if (auth.isAuthenticated) {
			void loadAll();
			stopRefresh?.();
			stopRefresh = useRefresh({
				reload: () => loadAll({ silent: true }),
				// A parcel just failed delivery. Same alert as a new order —
				// sound and a blinking tab title — because it needs the same
				// thing from an operator: someone to pick up a phone. Fires on
				// the transition only, so a parcel stuck for a week announces
				// itself once, not every fifteen minutes.
				onEvent: (data) => {
					if (data.submissionId) {
						freshArrivedIds = new Set([...freshArrivedIds, data.submissionId]);
						setTimeout(() => {
							freshArrivedIds = new Set();
						}, 3500);
					}
					if (!data.carrierTrouble) return;
					playNewOrderSound();
					blinkTabTitle(1);
					toast.warning(`مشكلة توصيل: ${data.carrierTrouble}`, {
						duration: 15000,
						action: {
							label: 'عرض',
							onClick: () => {
								if (!attentionOnly) void toggleAttention();
							}
						}
					});
				}
			});
		}
	});

	onDestroy(() => {
		stopRefresh?.();
	});

</script>

<svelte:head>
	<title>OPS</title>
</svelte:head>

<!-- Bottom toasts: top-center covered the tab bar and hid the card fly-out animation -->
<Toaster richColors position="bottom-center" dir="rtl" />

{#if !auth.isAuthenticated}
	<!-- Local login disabled — the layout guard redirects to the Genelog SSO portal -->
	<div style="min-height:80vh;display:flex;align-items:center;justify-content:center;color:#64748b">
		جارٍ التحويل لتسجيل الدخول...
	</div>
{:else}
	<!-- Apple Ambient Lighting Canvas: light mode porcelain with subtle soft corner glow; dark mode true neutral obsidian with delicate specular rim -->
	<!-- pt on mobile clears the floating top circle buttons (fixed, out of flow);
	     removed at lg where the real header sits in flow. -->
	<div class="min-h-dvh pt-16 bg-[#f2f3f7] [background-image:radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(120,160,240,0.12),transparent_70%),radial-gradient(ellipse_50%_40%_at_100%_100%,rgba(160,180,220,0.10),transparent_70%)] dark:bg-[#000000] dark:[background-image:radial-gradient(ellipse_75%_55%_at_50%_-10%,rgba(255,255,255,0.05),transparent_70%),radial-gradient(ellipse_55%_45%_at_100%_100%,rgba(255,255,255,0.03),transparent_70%)] lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden lg:pt-0">
		<AppHeader
			count={orders.pending.length}
			connected={socketStore.connected}
			refreshing={loading || historyLoading}
			onRefresh={loadAll}
			onNew={() => { haptic(10); void goto(`${base}/new`); }}
			onSearchToggle={() => {
				searchOpen = !searchOpen;
				if (searchOpen) {
					// Wait one tick for the search bar to mount, then focus the native input inside it
					setTimeout(() => searchBarEl?.querySelector('input')?.focus(), 0);
				} else {
					searchQuery = '';
				}
			}}
		/>

		<!-- Stalled parcels. Absent entirely on a normal day: a permanent "0
		     problems" row trains operators to stop reading the strip, and this one
		     has to still register when it does appear. -->
		{#if (attentionCount > 0 && !attentionHidden) || attentionOnly}
			<!-- While the filter is on this sticks to the top, because it carries the
			     only way out of it: scrolling a filtered list used to leave the
			     operator with a short list, no explanation, and a page reload as the
			     way back. -->
			<div
				class="flex w-full items-stretch border-b text-sm text-red-700 transition-colors dark:text-red-300 {attentionOnly
					? 'sticky top-0 z-30 border-red-500/40 bg-red-500/20 backdrop-blur-md'
					: 'border-red-500/25 bg-red-500/10'}"
			>
				<button
					type="button"
					aria-pressed={attentionOnly}
					class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-start transition-colors hover:bg-red-500/10"
					onclick={() => void toggleAttention()}
				>
					<AlertTriangle class="size-4 shrink-0" />
					<span class="min-w-0 flex-1">
						<span class="block font-semibold">
							{#if attentionOnly}
								المتعثرة فقط ({attentionCount})
							{:else}
								{attentionCount}
								{attentionCount === 1 ? 'شحنة تعذّر تسليمها' : 'شحنات تعذّر تسليمها'}
							{/if}
						</span>
						{#if !attentionOnly && (attentionDetail || attentionBranch)}
							<!-- Who and where and why, so the strip can be acted on — or
							     recognised as the one already being worked — without
							     opening it. -->
							<span class="flex min-w-0 items-center gap-1.5 text-xs font-medium">
								{#if attentionBranch}
									<span class="shrink-0 rounded bg-red-500/20 px-1 font-bold">{attentionBranch}</span>
								{/if}
								<span class="truncate opacity-80">{attentionDetail}</span>
							</span>
						{/if}
					</span>
					<span class="shrink-0 text-xs font-bold">
						{attentionOnly ? 'إظهار الكل' : 'عرض'}
					</span>
				</button>
				{#if !attentionOnly}
					<button
						type="button"
						class="shrink-0 px-3 opacity-70 transition-opacity hover:opacity-100"
						aria-label="إخفاء"
						title="إخفاء حتى تتعثر شحنة أخرى"
						onclick={dismissAttention}
					>
						<X class="size-4" />
					</button>
				{/if}
			</div>
		{/if}

		{#if searchOpen}
			<!-- Mobile & Desktop Expanding Liquid Glass Search Capsule (No full-screen blur blocking results) -->
			<div
				transition:fly={{ y: -16, duration: 200 }}
				class="fixed inset-x-3 top-[max(0.6rem,env(safe-area-inset-top))] z-50 flex items-center gap-2 rounded-full border border-white/80 bg-white/95 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.22)] ring-1 ring-black/5 ring-inset backdrop-blur-2xl backdrop-saturate-200 dark:border-white/20 dark:bg-card/95 dark:shadow-[0_16px_48px_rgba(0,0,0,0.55)] dark:ring-white/15 lg:static lg:z-auto lg:rounded-none lg:border-0 lg:border-b lg:bg-card lg:p-3 lg:shadow-none lg:ring-0"
				bind:this={searchBarEl}
			>
				<div class="relative flex flex-1 items-center">
					<Search class="text-muted-foreground pointer-events-none absolute start-3 size-4 shrink-0" />
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="بحث أو امسح ملصقاً: اسم، هاتف، مدينة، رقم…"
						class="bg-muted/40 text-foreground placeholder:text-muted-foreground focus:bg-background/80 h-10 w-full rounded-full pe-16 ps-9 text-sm font-medium outline-hidden transition-all duration-150 ring-1 ring-transparent focus:ring-primary/40"
						onkeydown={(e) => {
							// A barcode gun types the digits and presses Enter.
							if (e.key === 'Enter') {
								e.preventDefault();
								void jumpToMatch(searchQuery);
							}
						}}
					/>
					<button
						type="button"
						onclick={() => { haptic(10); scanOpen = true; }}
						class="text-muted-foreground hover:text-foreground absolute end-9 rounded-full p-1 transition-colors"
						aria-label="مسح ملصق"
						title="امسح ملصق الطلب بالكاميرا"
					>
						<ScanLine class="size-4" />
					</button>
					{#if searchQuery}
						<button
							type="button"
							onclick={() => { searchQuery = ''; searchResults = []; }}
							class="text-muted-foreground hover:text-foreground absolute end-3 rounded-full p-1 transition-colors"
							aria-label="مسح البحث"
						>
							<X class="size-4" />
						</button>
					{/if}
				</div>
				<button
					type="button"
					aria-label="إغلاق البحث"
					class="apple-press text-muted-foreground hover:text-foreground inline-flex h-10 items-center justify-center rounded-full px-3 text-xs font-bold transition-colors active:bg-accent"
					onclick={() => { searchOpen = false; searchQuery = ''; searchResults = []; }}
				>
					إلغاء
				</button>
			</div>
		{/if}

		<!-- Master–detail row: on lg+ the order list is a fixed-width column and the
		     selected order opens in the pane on the side; on mobile this is a plain
		     full-width block (no split, no internal scroll). -->
		<div class="lg:flex lg:min-h-0 lg:flex-1 lg:overflow-hidden">
		<!-- pb on mobile clears the floating bottom tab capsule so the last card is
		     never trapped under the glass; removed at lg where the bar is a top strip. -->
		<div bind:this={historyColumn} class="pb-28 lg:w-[452px] lg:shrink-0 lg:overflow-y-auto lg:border-e lg:pb-0 xl:w-[488px] {searchOpen ? 'pt-14 lg:pt-0' : ''}">

		{#if isSearching}
			<!-- Server-side search results across all orders -->
			<div class="bg-muted/50 border-b px-3 py-1.5 text-xs text-muted-foreground">
				{#if searchLoading}
					جاري البحث…
				{:else}
					{searchResults.length} نتيجة في كل الطلبات
				{/if}
			</div>
			<div class="space-y-2 p-3">
				{#if searchLoading}
					<div class="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
						<Loader2 class="size-4 animate-spin" />
						جاري البحث…
					</div>
				{:else if searchResults.length === 0}
					<div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16">
						<AlertTriangle class="size-12 opacity-30" />
						<p class="text-sm">لا توجد نتائج</p>
					</div>
				{:else}
					{#each searchResults as order (order.id)}
						<OrderCard
							{order}
							showStatus
							fresh={freshArrivedIds.has(order.submissionId || order.id)}
							selected={selectedId === order.id}
							onclick={() => openOrder(order)}
							onQuickActionDone={refreshFromUpdate}
						/>
					{/each}
				{/if}
			</div>
		{:else}
			<Tabs bind:value={activeTab} onValueChange={() => haptic(8)} class="w-full">
				<!-- Top tabs (desktop lg+). On mobile the tabs live in a floating
				     glass capsule at the bottom (see BottomTabBar below), so this bar
				     is hidden there. -->
				<div class="sticky top-2 z-20 mx-3 my-2 hidden lg:block">
				<TabsList
						bind:ref={stripEl}
						class="relative w-full {orders.returns.length > 0
							? 'grid-cols-5'
							: 'grid-cols-4'} grid !h-12 gap-1 rounded-2xl border border-black/[0.08] !bg-white/80 !p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.06),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-white/80 ring-inset backdrop-blur-3xl backdrop-saturate-200 dark:border-white/[0.12] dark:!bg-[#18181c]/85 dark:shadow-[0_8px_30px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:ring-white/[0.08]"
					>
						<!-- Absolutely positioned, so it takes no grid cell. -->
						<span class="t-tabs-pill t-tabs-pill--strip" bind:this={stripPillEl} aria-hidden="true"></span>
						{@const triggerClass =
							'apple-press relative z-10 gap-1.5 !rounded-xl !border-0 !bg-transparent text-sm font-bold text-muted-foreground transition-colors duration-200 !flex !h-full items-center justify-center hover:text-foreground data-active:!bg-transparent data-active:!shadow-none data-active:text-foreground dark:data-active:text-white'}
						<TabsTrigger value="pending" bind:ref={stripTabEls.pending} class={triggerClass}>
							بانتظار
							{#if orders.pending.length > 0}
								<Badge
									variant="default"
									class="h-5 min-w-5 justify-center px-1.5 text-xs font-black tabular-nums"
								>
									{orders.pending.length}
								</Badge>
							{/if}
						</TabsTrigger>
						<TabsTrigger value="approved" bind:ref={stripTabEls.approved} class={triggerClass}>
							<span class={pulsingTab === 'approved' ? 'tab-pulse inline-flex items-center gap-1.5' : 'inline-flex items-center gap-1.5'}>
								<Box class="size-4" /> للتجهيز
								{#if orders.approved.length > 0}
									<Badge
										variant="secondary"
										class="h-5 min-w-5 justify-center px-1.5 text-xs font-bold tabular-nums"
									>
										{orders.approved.length}
									</Badge>
								{/if}
							</span>
						</TabsTrigger>
						<TabsTrigger value="history" bind:ref={stripTabEls.history} class={triggerClass}>
							<span class={pulsingTab === 'history' ? 'tab-pulse inline-flex items-center gap-1.5' : 'inline-flex items-center gap-1.5'}>
								<ClipboardList class="size-4" /> سابقة
							</span>
						</TabsTrigger>
						<TabsTrigger value="dropship" bind:ref={stripTabEls.dropship} class={triggerClass}>
							<span class="inline-flex items-center gap-1.5">
								<Store class="size-4" /> دروبشيب
								{#if dropshipOpen > 0}
									<Badge
										variant="secondary"
										class="h-5 min-w-5 justify-center px-1.5 text-xs font-bold tabular-nums"
									>
										{dropshipOpen}
									</Badge>
								{/if}
							</span>
						</TabsTrigger>
						{#if orders.returns.length > 0}
							<TabsTrigger value="returns" bind:ref={stripTabEls.returns} class={triggerClass}>
								<span class="inline-flex items-center gap-1.5">
									<RotateCcw class="size-4" /> إرجاع
									<Badge
										variant="secondary"
										class="h-5 min-w-5 justify-center px-1.5 text-xs font-bold tabular-nums"
									>
										{orders.returns.length}
									</Badge>
								</span>
							</TabsTrigger>
						{/if}
					</TabsList>
				</div>

				<!-- بانتظار: PENDING_REVIEW + FAILED -->
				<TabsContent value="pending" class="m-0">
					{#key activeTab}
					<div class="space-y-2 p-3" in:fade={{ duration: 150, delay: 50 }}>
						{#if loading && orders.pending.length === 0}
							<OrderSkeleton />
						{:else if orders.pending.length === 0}
							<EmptyPending />
						{:else}
							<div class="t-skel-reveal space-y-2">
							{#each orders.pending as order (order.id)}
								<!-- Card slides toward the next tab (left in RTL) when the order moves on -->
								<div animate:flip={{ duration: 250 }} out:fly={{ x: -80, duration: 300 }}>
									<OrderCard
										{order}
										fresh={freshArrivedIds.has(order.submissionId || order.id)}
										selected={selectedId === order.id}
										onclick={() => openOrder(order)}
										onQuickActionDone={(movedTo) => (movedTo ? orderMoved(movedTo) : refreshFromUpdate())}
										onGoToTab={goToTab}
									/>
								</div>
							{/each}
							</div>
							{#if pendingTotal > orders.pending.length}
								<p class="text-muted-foreground py-2 text-center text-xs">
									يُعرض {orders.pending.length} من أصل {pendingTotal} — استخدم البحث للوصول للبقية
								</p>
							{/if}
						{/if}
					</div>
					{/key}
				</TabsContent>

				<!-- للتجهيز: APPROVED + PACKED (greenlit, not yet sent) -->
				<TabsContent value="approved" class="m-0">
					{#key activeTab}
					<div class="space-y-2 p-3" in:fade={{ duration: 150, delay: 50 }}>
						{#if loading && orders.approved.length === 0}
							<OrderSkeleton />
						{:else if orders.approved.length === 0}
							<div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16">
								<IdleCreature creature="monkey" />
								<p class="text-sm">لا توجد طلبات للتجهيز</p>
							</div>
						{:else}
							<div class="t-skel-reveal space-y-2">
							{#each orders.approved as order (order.id)}
								<div animate:flip={{ duration: 250 }} out:fly={{ x: -80, duration: 300 }}>
									<OrderCard
										{order}
										fresh={freshArrivedIds.has(order.submissionId || order.id)}
										selected={selectedId === order.id}
										onclick={() => openOrder(order)}
										onQuickActionDone={(movedTo) => (movedTo ? orderMoved(movedTo) : refreshFromUpdate())}
										onGoToTab={goToTab}
									/>
								</div>
							{/each}
							</div>
							{#if approvedTotal > orders.approved.length}
								<p class="text-muted-foreground py-2 text-center text-xs">
									يُعرض {orders.approved.length} من أصل {approvedTotal} — استخدم البحث للوصول للبقية
								</p>
							{/if}
						{/if}
					</div>
					{/key}
				</TabsContent>

				<!-- سابق: SUCCESS + REJECTED + CANCELLED, paginated 20/page -->
				<TabsContent value="history" class="m-0">
					{#key activeTab}
					<div class="space-y-2 p-3" in:fade={{ duration: 150, delay: 50 }}>
						{#if historyLoading && orders.history.length === 0}
							<OrderSkeleton />
						{:else if orders.history.length === 0}
							<div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16">
								<IdleCreature />
								<p class="text-sm">لا توجد طلبات سابقة</p>
							</div>
						{:else}
							{#if historyRecent.length > 0}
								<div class="text-muted-foreground flex items-center gap-2 pt-1 text-xs font-bold">
									<span class="bg-emerald-500 size-1.5 rounded-full"></span> آخر يومين (حسب آخر إجراء)
								</div>
								{#each historyRecent as order (order.id)}
									<OrderCard {order} showStatus selected={selectedId === order.id} onclick={() => openOrder(order)} onQuickActionDone={refreshFromUpdate} />
								{/each}
							{/if}
							{#if historyOlder.length > 0}
								<div class="text-muted-foreground flex items-center gap-2 pt-2 text-xs font-bold">
									<span class="bg-zinc-400 size-1.5 rounded-full"></span> أقدم من يومين
								</div>
								{#each historyOlder as order (order.id)}
									<OrderCard {order} showStatus selected={selectedId === order.id} onclick={() => openOrder(order)} onQuickActionDone={refreshFromUpdate} />
								{/each}
							{/if}
						{/if}
					</div>
					{/key}

					{#if historyTotalPages > 1}
						<div class="border-t px-4 py-3 flex items-center justify-between gap-2">
							<button
								type="button"
								disabled={historyPage <= 1 || historyLoading}
								onclick={() => goHistoryPage(historyPage - 1)}
								class="inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-semibold disabled:opacity-40"
							>
								→ السابق
							</button>
							<span class="text-muted-foreground text-sm tabular-nums">
								{historyPage} / {historyTotalPages}
							</span>
							<button
								type="button"
								disabled={historyPage >= historyTotalPages || historyLoading}
								onclick={() => goHistoryPage(historyPage + 1)}
								class="inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-semibold disabled:opacity-40"
							>
								التالي ←
							</button>
						</div>
					{/if}
				</TabsContent>

				<!-- إرجاع: returnOrder OR replacement, at every lifecycle stage.
				     Sorted by last action, because what an operator wants here is
				     "which return moved" — not when it was first raised. -->
				<TabsContent value="returns" class="m-0">
					{#key activeTab}
					<div class="space-y-2 p-3" in:fade={{ duration: 150, delay: 50 }}>
						{#if orders.returns.length === 0}
							<div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16">
								<IdleCreature />
								<p class="text-sm">لا توجد طلبات إرجاع</p>
							</div>
						{:else}
							<div class="t-skel-reveal space-y-2">
							{#each orders.returns as order (order.id)}
								<OrderCard
									{order}
									showStatus
									selected={selectedId === order.id}
									onclick={() => openOrder(order)}
									onQuickActionDone={refreshFromUpdate}
								/>
							{/each}
							</div>
						{/if}
					</div>
					{/key}
				</TabsContent>

				<!-- دروبشيب: every dropship order, all statuses -->
				<TabsContent value="dropship" class="m-0">
					{#key activeTab}
					<div bind:this={dropshipColumn} class="space-y-2 p-3" in:fade={{ duration: 150, delay: 50 }}>
						{#if dropshipLoading && orders.dropship.length === 0}
							<OrderSkeleton />
						{:else if orders.dropship.length === 0}
							<div class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16">
								<IdleCreature />
								<p class="text-sm">لا توجد طلبات دروبشيب</p>
							</div>
						{:else}
							<div class="t-skel-reveal space-y-2">
							{#each orders.dropship as order (order.id)}
								<OrderCard
									{order}
									showStatus
									selected={selectedId === order.id}
									onclick={() => openOrder(order)}
									onQuickActionDone={refreshFromUpdate}
								/>
							{/each}
							</div>
						{/if}
					</div>
					{/key}

					{#if dropshipTotalPages > 1}
						<div class="border-t px-4 py-3 flex items-center justify-between gap-2">
							<button
								type="button"
								disabled={dropshipPage <= 1 || dropshipLoading}
								onclick={() => goDropshipPage(dropshipPage - 1)}
								class="inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-semibold disabled:opacity-40"
							>
								→ السابق
							</button>
							<span class="text-muted-foreground text-sm tabular-nums">
								{dropshipPage} / {dropshipTotalPages}
							</span>
							<button
								type="button"
								disabled={dropshipPage >= dropshipTotalPages || dropshipLoading}
								onclick={() => goDropshipPage(dropshipPage + 1)}
								class="inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-semibold disabled:opacity-40"
							>
								التالي ←
							</button>
						</div>
					{/if}
				</TabsContent>
			</Tabs>
		{/if}

		</div><!-- /list column -->

			<!-- Detail pane (lg+ only) -->
			<div class="hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
				{#if selectedId}
					{#key selectedId}
						<OrderDetail
							orderId={selectedId}
							mode="pane"
							onClose={() => { selectedId = null; clearOrderUrl(); }}
							onChanged={() => loadAll({ silent: true })}
							onMoved={orderMoved}
							onGoToTab={goToTab}
						/>
					{/key}
				{:else}
					<div class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 p-8">
						<MousePointerClick class="size-10 opacity-30" />
						<p class="text-sm">اختر طلباً لعرض تفاصيله</p>
					</div>
				{/if}
			</div>

		</div><!-- /master–detail row -->

		<!-- Floating Apple Liquid Glass tab island (mobile only). Detached from the
		     edges, translucent, content rolls under it — so the list carries
		     bottom padding above. Hidden at lg, where the tabs are a top strip. -->
		<nav
			class="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden"
			aria-label="التنقل بين القوائم"
		>
			<div
				bind:this={capsuleEl}
				class="pointer-events-auto relative flex w-full max-w-sm items-center justify-around gap-1 rounded-full border border-black/[0.08] bg-white/85 p-2.5 shadow-[0_12px_44px_-6px_rgba(0,0,0,0.16),0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_0_rgba(255,255,255,0.95)] ring-1 ring-white/80 ring-inset backdrop-blur-3xl backdrop-saturate-200 dark:border-white/[0.14] dark:bg-[#18181c]/88 dark:shadow-[0_16px_50px_-8px_rgba(0,0,0,0.6),0_6px_20px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:ring-white/[0.10] transition-all duration-200"
			>
				<span class="t-tabs-pill" bind:this={pillEl} aria-hidden="true"></span>
				{#each bottomTabs as t (t.key)}
					{@const Icon = t.icon}
					{@const isActive = activeTab === t.key}
					<button
						type="button"
						bind:this={tabEls[t.key]}
						aria-pressed={isActive}
						aria-label={t.label}
						onclick={() => { haptic(8); goToTab(t.key); }}
						class="apple-press relative z-10 flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[10px] font-extrabold transition-colors duration-200 {isActive
							? 'text-primary dark:text-white'
							: 'text-muted-foreground hover:text-foreground active:scale-95'}"
					>
						<div class="relative inline-flex items-center justify-center">
							<Icon class="size-5" />
							{#if t.count > 0}
								<span
									class="bg-primary text-primary-foreground absolute -top-1.5 -end-2.5 min-w-4.5 rounded-full px-1 text-[9px] leading-4 font-black tabular-nums shadow-xs"
								>
									{t.count}
								</span>
							{/if}
						</div>
						{t.label}
					</button>
				{/each}
			</div>
		</nav>
	</div>
{/if}

<style>
	.tab-pulse {
		animation: tab-pulse 0.8s ease-in-out 2;
	}
	@keyframes tab-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.2); }
	}
</style>

<ScanSearch bind:open={scanOpen} onScan={onScanned} />
