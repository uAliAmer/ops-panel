<script module lang="ts">
	// ── Shared spin scheduler ───────────────────────────────────────────────
	//
	// A reel does not spin the moment its value lands; it asks here for a slot.
	// An order with a dozen lines mounts two dozen reels on one frame, and each
	// one is a per-digit transform plus (where affordable) a per-digit SVG blur
	// being rewritten every frame — that is where a low-spec laptop drops the
	// animation and shows a stutter instead of a number arriving.
	//
	// Slots are handed out in registration order, which is DOM order, so the
	// throttle also reads as the intended thing: the figures cascade down the
	// list the way the eye travels it.

	/** Is this machine worth spending a per-digit blur filter on? */
	const LOW_SPEC =
		typeof navigator !== 'undefined' &&
		((((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4) ||
			((navigator.hardwareConcurrency ?? 8) <= 4));

	/** ms between two reels being let go. */
	const SLOT_GAP = LOW_SPEC ? 110 : 70;
	/** How many reels may be travelling at once. */
	const MAX_CONCURRENT = LOW_SPEC ? 3 : 6;

	type Job = { key: symbol; run: () => void; cost: number };
	let queue: Job[] = [];
	let running = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastRelease = -Infinity;

	function drain() {
		timer = null;
		while (queue.length && running < MAX_CONCURRENT) {
			const wait = SLOT_GAP - (performance.now() - lastRelease);
			if (wait > 0) {
				timer = setTimeout(drain, wait);
				return;
			}
			const job = queue.shift()!;
			lastRelease = performance.now();
			running++;
			job.run();
			setTimeout(() => {
				running = Math.max(0, running - 1);
				if (!timer) drain();
			}, job.cost);
		}
	}

	/** Queue one reel's spin. A reel already waiting replaces its own job —
	 *  nobody should watch a number arrive that has since been superseded. */
	function enqueueSpin(key: symbol, run: () => void, cost: number) {
		const at = queue.findIndex((j) => j.key === key);
		if (at >= 0) queue.splice(at, 1);
		queue.push({ key, run, cost });
		if (!timer) drain();
	}

	function dequeueSpin(key: symbol) {
		queue = queue.filter((j) => j.key !== key);
	}

	// ── Shared visibility gate ──────────────────────────────────────────────
	//
	// A reel below the fold spends the same CPU as one on screen and nobody sees
	// it. Off-screen reels are placed on their digits statically and spin when
	// they are actually scrolled to — which also keeps the cascade going down a
	// long list instead of being spent before the operator arrives.
	let observer: IntersectionObserver | null = null;
	const waiting = new WeakMap<Element, () => void>();

	function whenVisible(el: Element, cb: () => void): () => void {
		if (typeof IntersectionObserver === 'undefined') {
			cb();
			return () => {};
		}
		observer ??= new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					const fn = waiting.get(e.target);
					waiting.delete(e.target);
					observer?.unobserve(e.target);
					fn?.();
				}
			},
			{ rootMargin: '64px' }
		);
		waiting.set(el, cb);
		observer.observe(el);
		return () => {
			waiting.delete(el);
			observer?.unobserve(el);
		};
	}
</script>

<script lang="ts">
	// Slot-machine counter (transitions-dev 26 — spinning counter). Every digit is
	// a clipped reel of 0-9 cells; on a change the strip travels through a few
	// full turns before landing, staggered left to right, with a vertical-only
	// motion blur that decays as each reel settles.
	//
	// It replaces a tween that counted up through every intermediate value. That
	// read as a number being computed; this reads as a number arriving.
	//
	// The blur is an SVG feGaussianBlur with stdDeviation="0 Y" rather than CSS
	// blur(): CSS blurs on both axes, which smears a moving digit sideways into
	// its neighbours instead of streaking it vertically.
	import { untrack } from 'svelte';

	type Props = {
		value: number;
		/** Formats the value for display. Non-digits (separators) stay static. */
		format?: (n: number) => string;
		/** Roll duration in ms. */
		duration?: number;
		class?: string;
	};
	let { value, format = (n) => String(Math.round(n)), duration = 1000, class: cls = '' }: Props =
		$props();

	/** Full turns a reel makes before landing. Enough to read as a spin, few
	 *  enough that the eye can still follow a digit home. */
	const SPINS = 2;
	const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

	const uid = `reel-${Math.random().toString(36).slice(2, 9)}`;

	const reduce =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	/** The blur is the expensive half: one SVG filter per digit, rewritten every
	 *  frame it travels. The roll itself is a composited transform and costs
	 *  almost nothing, so a weak machine keeps the motion and loses the smear. */
	const blur = !LOW_SPEC;

	const text = $derived(format(value));
	/** One entry per character: a reel for a digit, a static glyph otherwise. */
	const chars = $derived(
		text.split('').map((ch, i) => ({ ch, digit: ch >= '0' && ch <= '9' ? Number(ch) : null, i }))
	);

	let strips: Record<number, HTMLElement | null> = {};
	let blurs: Record<number, SVGFEGaussianBlurElement | null> = {};
	/** Turns completed per column, so a strip never rewinds — it only travels on. */
	let turns: Record<number, number> = {};
	let rafs: number[] = [];
	/** The digit each column is currently parked on (or travelling to), needed to
	 *  rewind a column without changing what it shows. */
	let landed: Record<number, number> = {};
	/** The furthest turn the ribbon can express: travel is turns*10 + digit, and
	 *  the strip holds SPINS*2+1 turns of cells. */
	const MAX_TURNS = SPINS * 2;

	function cssMs(token: string, fallback: number): number {
		if (typeof window === 'undefined') return fallback;
		const raw = getComputedStyle(document.documentElement).getPropertyValue(token);
		const n = parseFloat(raw);
		if (!Number.isFinite(n)) return fallback;
		return raw.includes('ms') ? n : n * 1000;
	}
	function cssNum(token: string, fallback: number): number {
		if (typeof window === 'undefined') return fallback;
		const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
		return Number.isFinite(n) ? n : fallback;
	}

	/** Ride each column's blur from full to none across its own window. */
	function decayBlur(col: number, delay: number, dur: number, peak: number) {
		const node = blurs[col];
		if (!node || !blur) return;
		const start = performance.now() + delay;
		const step = (now: number) => {
			const t = (now - start) / dur;
			if (t < 0) {
				rafs.push(requestAnimationFrame(step));
				return;
			}
			// Fast at the top of the spin, gone by the time the reel lands.
			const k = Math.max(0, 1 - t);
			node.setAttribute('stdDeviation', `0 ${(peak * k * k).toFixed(2)}`);
			if (t < 1) rafs.push(requestAnimationFrame(step));
			else node.setAttribute('stdDeviation', '0 0');
		};
		rafs.push(requestAnimationFrame(step));
	}

	/**
	 * Snap a column back to turn 0 on the digit it already shows.
	 *
	 * The strip is a finite ribbon (SPINS*2+1 turns of cells) but `turns` only
	 * ever grew, so the third spin sent the travel past the end of it and the
	 * window went blank — the number simply stopped updating. A figure that
	 * changes three times is rare on a read-only screen and routine on the
	 * new-order form, where every keystroke in the total is another spin.
	 *
	 * The rewind is invisible: same digit under the window, transition off.
	 */
	function rewind(col: number) {
		const strip = strips[col];
		if (!strip) return;
		const digit = landed[col] ?? 0;
		turns[col] = 0;
		strip.style.transition = 'none';
		strip.style.transform = `translateY(calc(var(--reel-cell) * -${digit}))`;
		// Force the parked position to land before the spin overwrites it, or the
		// browser coalesces both writes and the reel jumps instead of travelling.
		void strip.offsetHeight;
	}

	function spin() {
		// A spin supersedes whatever the previous value still had in flight —
		// otherwise a fast typist accumulates a blur decay loop per keystroke.
		rafs.forEach((r) => cancelAnimationFrame(r));
		rafs = [];
		const stagger = cssMs('--reel-stagger', 90);
		const ease = getComputedStyle(document.documentElement)
			.getPropertyValue('--reel-ease')
			.trim() || 'cubic-bezier(0.16, 1, 0.3, 1)';
		const peak = cssNum('--reel-spin-blur', 3);

		chars.forEach((c, col) => {
			if (c.digit === null) return;
			const strip = strips[col];
			if (!strip) return;
			// Column order is the reading order of the number, so the leading digit
			// settles first and the units land last — the way a counter finishes.
			const delay = col * stagger;
			// Out of ribbon: rewind to where it stands, then travel from there.
			if ((turns[col] ?? 0) + SPINS > MAX_TURNS) rewind(col);
			turns[col] = (turns[col] ?? 0) + SPINS;
			strip.style.transition = `transform ${duration}ms ${ease} ${delay}ms`;
			// Percentages here would be of the whole strip, not one cell — the reel
			// has to travel in cell units.
			strip.style.transform = `translateY(calc(var(--reel-cell) * -${turns[col] * 10 + c.digit}))`;
			decayBlur(col, delay, duration, peak);
			landed[col] = c.digit;
			// Normal case: rewind the moment the reel is parked, where it costs
			// nothing to look at. The pre-spin guard above only has to catch an
			// operator typing faster than a reel takes to land.
			strip.addEventListener('transitionend', () => rewind(col), { once: true });
		});
	}

	/** Park every reel on zero with no travel, ready to be spun up from there. */
	function reset() {
		chars.forEach((c, col) => {
			const strip = strips[col];
			if (!strip || c.digit === null) return;
			turns[col] = 0;
			landed[col] = 0;
			strip.style.transition = 'none';
			strip.style.transform = 'translateY(0px)';
			// Force the parked position to take effect before the spin is set, or
			// the browser coalesces both writes and there is nothing to animate.
			void strip.offsetHeight;
		});
	}

	/** Land every reel on its digit with no travel — reduced motion. */
	function place() {
		chars.forEach((c, col) => {
			const strip = strips[col];
			if (!strip || c.digit === null) return;
			turns[col] = 0;
			landed[col] = c.digit;
			strip.style.transition = 'none';
			strip.style.transform = `translateY(calc(var(--reel-cell) * -${c.digit}))`;
			blurs[col]?.setAttribute('stdDeviation', '0 0');
		});
	}

	let mounted = false;
	let prevText = '';
	/** The reel's own element, watched so an off-screen one costs nothing. */
	let root = $state<HTMLElement | null>(null);
	let onScreen = false;
	/** A value that landed while off-screen: placed, still owed its spin. */
	let owed = false;
	const key = Symbol('reel');

	/** Ask the scheduler for a slot, then travel. `fromZero` parks the columns
	 *  first, for a first paint or a number that changed width. */
	function queueSpin(fromZero: boolean) {
		enqueueSpin(
			key,
			() => {
				requestAnimationFrame(() => {
					if (fromZero) {
						reset();
						requestAnimationFrame(() => spin());
					} else {
						spin();
					}
				});
			},
			// What the slot is held for: roughly one reel's travel, so the cap
			// counts reels actually in flight rather than reels ever queued.
			duration
		);
	}

	$effect(() => {
		const el = root;
		if (!el || reduce) return;
		return whenVisible(el, () => {
			onScreen = true;
			// Scrolled into view owing a spin: park at zero and roll it up, so the
			// cascade continues down the list rather than being spent above it.
			if (owed) {
				owed = false;
				mounted = true;
				queueSpin(true);
			}
		});
	});

	$effect(() => {
		const now = text;
		untrack(() => {
			const widthChanged = now.length !== prevText.length;
			prevText = now;
			if (reduce) {
				requestAnimationFrame(() => place());
				return;
			}
			// Nothing to watch it: show the figure, remember that it is owed a spin.
			if (!onScreen) {
				owed = true;
				requestAnimationFrame(() => place());
				return;
			}
			// Spin on first paint too. Nearly every figure in this app is mounted
			// with its value and never changed again — the wallet chip, an order's
			// total, a customer's lifetime spend — so animating only on a later
			// change means animating essentially never.
			//
			// A digit added or dropped (9,900 → 10,000) rebuilds the columns, so
			// there is no previous position to travel from: park at zero first,
			// then spin, rather than jumping.
			const fromZero = !mounted || widthChanged;
			mounted = true;
			queueSpin(fromZero);
		});
	});

	$effect(() => () => {
		dequeueSpin(key);
		rafs.forEach((r) => cancelAnimationFrame(r));
	});
</script>

<span class="t-reel {cls}" aria-label={text} bind:this={root}>
	<!-- One vertical-only blur per column, each decayed on its own schedule.
	     Not rendered at all where it is not affordable — an unused filter still
	     costs its nodes. -->
	{#if blur}
		<svg width="0" height="0" aria-hidden="true" class="absolute">
			<defs>
				{#each chars as c, col (col)}
					{#if c.digit !== null}
						<filter id="{uid}-{col}" x="-20%" y="-40%" width="140%" height="180%">
							<feGaussianBlur bind:this={blurs[col]} in="SourceGraphic" stdDeviation="0 0" />
						</filter>
					{/if}
				{/each}
			</defs>
		</svg>
	{/if}

	{#each chars as c, col (col)}
		{#if c.digit === null}
			<span class="t-reel-sep" aria-hidden="true">{c.ch}</span>
		{:else}
			<span class="t-reel-col" aria-hidden="true">
				<span
					class="t-reel-strip"
					bind:this={strips[col]}
					style={blur ? `filter: url(#${uid}-${col});` : undefined}
				>
					<!-- Two turns of cells plus one, so a strip translated through
					     SPINS turns always has cells under the window. -->
					{#each Array(SPINS * 2 + 1) as _, turn (turn)}
						{#each DIGITS as d (d)}
							<span class="t-reel-digit">{d}</span>
						{/each}
					{/each}
				</span>
			</span>
		{/if}
	{/each}
</span>

<style>
	/* Cell height is in em so one component works at every call site's font size —
	   the wallet chip's headline and the order list's small print both use this. */
	.t-reel {
		--reel-cell: 1.15em;
		display: inline-flex;
		/* The page is RTL, and a flex row there lays its columns out right to
		   left — which reverses the digits. A number is LTR in any script, so the
		   reel opts out and isolates itself from the surrounding bidi run. */
		direction: ltr;
		unicode-bidi: isolate;
		align-items: center;
		height: var(--reel-cell);
		vertical-align: -0.22em;
		font-variant-numeric: tabular-nums;
	}
	.t-reel-col {
		position: relative;
		display: block;
		height: var(--reel-cell);
		overflow: hidden;
		/* Soft-fade the window edges instead of hard-cropping.
		   The solid band has to clear the tallest digit the current face draws,
		   or a resting number loses its top to the gradient. Digit ink runs to
		   roughly 18%-83% of the cell in the faces used here, so the fade starts
		   outside that with a little margin; it is only ever seen while a strip
		   is actually moving. --reel-fade lets a face with taller figures widen
		   it without touching this file. */
		--reel-fade: 14%;
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent 0%,
			#000 var(--reel-fade),
			#000 calc(100% - var(--reel-fade)),
			transparent 100%
		);
		mask-image: linear-gradient(
			to bottom,
			transparent 0%,
			#000 var(--reel-fade),
			#000 calc(100% - var(--reel-fade)),
			transparent 100%
		);
	}
	.t-reel-strip {
		display: flex;
		flex-direction: column;
		will-change: transform, filter;
	}
	.t-reel-digit {
		height: var(--reel-cell);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.t-reel-sep {
		display: inline-flex;
		align-items: center;
		height: var(--reel-cell);
	}

	@media (prefers-reduced-motion: reduce) {
		.t-reel-strip {
			transition: none !important;
			filter: none !important;
		}
	}
</style>
