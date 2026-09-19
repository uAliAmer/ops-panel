<script lang="ts">
	import { onMount } from 'svelte';

	type Props = {
		src: string | null;
		alt?: string;
		/**
		 * Screen rect of the thumbnail that was tapped. The peek grows out of it
		 * and shrinks back into it, so the photo never appears from nowhere.
		 */
		origin?: DOMRect | null;
		onClose: () => void;
	};
	let { src, alt = '', origin = null, onClose }: Props = $props();

	// A peek, not a viewer: a small panel that floats beside the item the operator
	// tapped and leaves the moment they do anything else. There is no dark
	// fullscreen layer and no close button — the way to dismiss it is to carry on
	// working, which is what an operator checking "is this the right product?"
	// actually does. Scroll, tap, Escape, or leaving the tab all put it away.
	const GAP = 10; // breathing room between the thumbnail and the panel
	const MARGIN = 8; // keep the panel off the screen edges

	let panelEl: HTMLElement | null = $state(null);
	let closing = false;

	const reduce =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	function ms(token: string, fallback: number): number {
		if (typeof window === 'undefined') return fallback;
		const raw = getComputedStyle(document.documentElement).getPropertyValue(token);
		const n = parseFloat(raw);
		if (!Number.isFinite(n)) return fallback;
		return raw.includes('ms') ? n : n * 1000;
	}
	const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

	/**
	 * Where the panel sits: centred on the thumbnail, above it when there is room
	 * and below it otherwise, then pulled inside the screen edges. Big enough to
	 * judge a product by, small enough that the row it belongs to stays visible.
	 */
	const box = $derived.by(() => {
		if (typeof window === 'undefined') return { left: 0, top: 0, w: 260, h: 260 };
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const w = Math.min(300, vw - MARGIN * 2);
		const h = Math.min(300, Math.round(vh * 0.42));

		if (!origin) {
			return { left: Math.round((vw - w) / 2), top: Math.round((vh - h) / 2), w, h };
		}
		const above = origin.top - GAP - h;
		const below = origin.bottom + GAP;
		const top = above >= MARGIN ? above : below + h <= vh - MARGIN ? below : Math.max(MARGIN, (vh - h) / 2);
		const left = Math.min(
			Math.max(MARGIN, origin.left + origin.width / 2 - w / 2),
			vw - w - MARGIN
		);
		return { left: Math.round(left), top: Math.round(top), w, h };
	});

	/**
	 * The transform that puts the panel back onto the thumbnail, plus the tilt it
	 * carries while it is there.
	 *
	 * The tilt comes from the direction the panel travels — a photo that opens
	 * upward leans back as it rises and flattens as it lands. It is the same
	 * reason a card dealt across a table doesn't stay flat: the motion has a
	 * direction, and the surface answers it.
	 */
	function fromThumb() {
		const b = box;
		const r = origin!;
		const sx = Math.max(r.width / b.w, 0.05);
		const sy = Math.max(r.height / b.h, 0.05);
		const dx = r.left + r.width / 2 - (b.left + b.w / 2);
		const dy = r.top + r.height / 2 - (b.top + b.h / 2);
		const clamp = (n: number) => Math.max(-1, Math.min(1, n));
		const ry = clamp(dx / b.w) * -14;
		const rx = clamp(dy / b.h) * 10;
		return { sx, sy, dx, dy, rx, ry };
	}

	function openFrames(f: ReturnType<typeof fromThumb>): Keyframe[] {
		return [
			{
				transform: `perspective(1200px) translate(${f.dx}px, ${f.dy}px) scale(${f.sx}, ${f.sy}) rotateX(${f.rx}deg) rotateY(${f.ry}deg)`,
				opacity: 0.35,
				offset: 0
			},
			{
				// The bend: fractionally wider than tall while it is still moving,
				// so it reads as a sheet flexing forward rather than a box scaling.
				transform: `perspective(1200px) translate(${f.dx * 0.2}px, ${f.dy * 0.2}px) scale(${
					f.sx + (1 - f.sx) * 0.84
				}, ${f.sy + (1 - f.sy) * 0.84}) rotateX(${f.rx * 0.28}deg) rotateY(${
					f.ry * 0.28
				}deg) scaleX(1.03) scaleY(0.978)`,
				opacity: 1,
				offset: 0.6
			},
			{
				transform: 'perspective(1200px) translate(0px, 0px) scale(1) rotateX(0deg) rotateY(0deg)',
				opacity: 1,
				offset: 1
			}
		];
	}

	function animateOpen() {
		if (!panelEl || reduce || !origin) return;
		panelEl.animate(openFrames(fromThumb()), {
			duration: ms('--duration-slow', 400),
			easing: EASE,
			fill: 'both'
		});
	}

	/** Put the photo back where it came from, then let the parent unmount it. */
	function requestClose() {
		if (closing) return;
		closing = true;
		if (!panelEl || reduce || !origin) {
			onClose();
			return;
		}
		const duration = ms('--duration-medium', 350);
		const f = fromThumb();
		const anim = panelEl.animate(
			[
				{ transform: 'perspective(1200px) translate(0px, 0px) scale(1)', opacity: 1 },
				{
					transform: `perspective(1200px) translate(${f.dx}px, ${f.dy}px) scale(${f.sx}, ${f.sy}) rotateX(${f.rx}deg) rotateY(${f.ry}deg)`,
					opacity: 0
				}
			],
			{ duration, easing: EASE, fill: 'both' }
		);
		anim.onfinish = () => onClose();
		// A dropped animation event must never strand the panel on screen.
		setTimeout(() => onClose(), duration + 80);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') requestClose();
	}

	/**
	 * The tap that dismisses must not also fire whatever sits under the finger —
	 * closing a peek should not open the order row behind it. Nothing covers the
	 * page (that would block scrolling), so the tap is caught on the way down and
	 * the click it would become is swallowed once.
	 */
	function onPointerDownAnywhere(e: PointerEvent) {
		if (panelEl && e.target instanceof Node && panelEl.contains(e.target)) return;
		e.stopPropagation();
		const swallowClick = (ev: Event) => {
			ev.stopPropagation();
			ev.preventDefault();
		};
		document.addEventListener('click', swallowClick, { capture: true, once: true });
		// A pointerdown that never becomes a click (a scroll drag) would otherwise
		// leave that listener armed for the next real tap.
		setTimeout(() => document.removeEventListener('click', swallowClick, true), 400);
		requestClose();
	}

	onMount(() => {
		requestAnimationFrame(() => animateOpen());

		// Anything that moves the anchor, or any sign the operator's attention has
		// gone elsewhere, puts the peek away. Scroll and wheel are captured because
		// scroll does not bubble — the list under the peek is its own scroller, not
		// the window. touchmove covers the drag itself, so the peek is already on
		// its way out as the finger moves rather than after the list settles.
		const dismiss = () => requestClose();
		const passive = { capture: true, passive: true } as AddEventListenerOptions;
		window.addEventListener('scroll', dismiss, passive);
		window.addEventListener('wheel', dismiss, passive);
		window.addEventListener('touchmove', dismiss, passive);
		window.addEventListener('resize', dismiss);
		window.addEventListener('blur', dismiss);
		document.addEventListener('visibilitychange', dismiss);
		document.addEventListener('pointerdown', onPointerDownAnywhere, true);
		return () => {
			window.removeEventListener('scroll', dismiss, passive);
			window.removeEventListener('wheel', dismiss, passive);
			window.removeEventListener('touchmove', dismiss, passive);
			window.removeEventListener('resize', dismiss);
			window.removeEventListener('blur', dismiss);
			document.removeEventListener('visibilitychange', dismiss);
			document.removeEventListener('pointerdown', onPointerDownAnywhere, true);
		};
	});
</script>

<svelte:window onkeydown={onKey} />

<!-- Nothing is laid over the page. An overlay to catch the dismissing tap would
     also swallow every touch, which locks scrolling — and then the scroll that
     is supposed to dismiss the peek can never happen. Dismissal is handled by
     document listeners instead; see onPointerDownAnywhere. -->
<div
	bind:this={panelEl}
	class="bg-card fixed z-[101] overflow-hidden rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.55)] ring-1 ring-black/10 dark:ring-white/15"
	style="left: {box.left}px; top: {box.top}px; width: {box.w}px; height: {box.h}px; will-change: transform, opacity; backface-visibility: hidden;"
	role="dialog"
	tabindex="-1"
	aria-label={alt || 'صورة المنتج'}
	onpointerdown={(e) => e.stopPropagation()}
	onclick={(e) => e.stopPropagation()}
>
	<img {src} {alt} class="size-full object-contain" draggable="false" />
</div>
