<script lang="ts">
	/**
	 * Scan a parcel's barcode/QR and hand back what it read.
	 *
	 * Every branch prints or sticks a label, so every branch has a number it can
	 * scan — this is not a printerless-only tool. The operator has a parcel in one
	 * hand; typing nine digits with the other is the part worth removing.
	 *
	 * Decoding is jsQR against a canvas frame, the same approach StickerScanner
	 * uses (BarcodeDetector is missing on too many of these phones). Unlike that
	 * one, this component validates nothing and binds nothing: it reads a code and
	 * gives it to the caller, who decides what it means.
	 *
	 * Deliberately duplicated rather than shared with StickerScanner: that one is
	 * a carrier-validation flow with its own states (checking / used / valid) and
	 * folding both into one component would leave a scanner that does two jobs
	 * badly. If a third appears, extract the camera loop then.
	 */
	import { onDestroy, tick } from 'svelte';
	import jsQR from 'jsqr';
	import { X, Flashlight, ScanLine } from '@lucide/svelte';

	type Props = {
		open: boolean;
		/** The decoded text, trimmed. The caller decides what to do with it. */
		onScan: (value: string) => void;
	};
	let { open = $bindable(), onScan }: Props = $props();

	let message = $state('');
	let flash = $state(false);
	let captured = false;
	let videoEl: HTMLVideoElement | undefined = $state();
	let overlayEl: HTMLCanvasElement | undefined = $state();
	let canvas: HTMLCanvasElement | null = null;
	let stream: MediaStream | null = null;
	let track: MediaStreamTrack | null = null;
	let torchOn = $state(false);
	let torchSupported = $state(false);
	let raf = 0;

	/** A short confirmation tone — a warehouse is loud and the screen is not watched. */
	function beep() {
		try {
			const Ctx =
				window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			const ctx = new Ctx();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'square';
			osc.frequency.value = 880;
			gain.gain.value = 0.15;
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start();
			setTimeout(() => {
				osc.stop();
				void ctx.close();
			}, 120);
		} catch {
			/* no audio — the green flash still confirms */
		}
	}

	async function start() {
		message = '';
		captured = false;
		try {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: 'environment' } }
				});
			} catch {
				stream = await navigator.mediaDevices.getUserMedia({ video: true });
			}
			track = stream.getVideoTracks()[0] || null;
			try {
				const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
				torchSupported = Boolean(caps?.torch);
			} catch {
				torchSupported = false;
			}
			await tick();
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
			}
			canvas = document.createElement('canvas');
			raf = requestAnimationFrame(scanFrame);
		} catch (err) {
			const name = (err as DOMException)?.name;
			message =
				name === 'NotAllowedError'
					? 'تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح'
					: name === 'NotFoundError'
						? 'لا توجد كاميرا على هذا الجهاز'
						: 'تعذّر فتح الكاميرا';
			stop();
		}
	}

	function stop() {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		if (track && torchOn) {
			try {
				void track.applyConstraints({ advanced: [{ torch: false }] } as unknown as MediaTrackConstraints);
			} catch {
				/* torch off is best-effort */
			}
		}
		if (stream) {
			stream.getTracks().forEach((t) => t.stop());
			stream = null;
		}
		track = null;
		torchOn = false;
		torchSupported = false;
		canvas = null;
	}

	async function toggleTorch() {
		if (!track) return;
		try {
			await track.applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints);
			torchOn = !torchOn;
		} catch {
			torchSupported = false;
		}
	}

	function drawBox(loc: {
		topLeftCorner: { x: number; y: number };
		topRightCorner: { x: number; y: number };
		bottomRightCorner: { x: number; y: number };
		bottomLeftCorner: { x: number; y: number };
	}) {
		if (!overlayEl || !videoEl) return;
		const dw = overlayEl.clientWidth;
		const dh = overlayEl.clientHeight;
		overlayEl.width = dw;
		overlayEl.height = dh;
		const nw = videoEl.videoWidth;
		const nh = videoEl.videoHeight;
		if (!nw || !nh) return;
		const scale = Math.max(dw / nw, dh / nh); // object-cover
		const offX = (nw * scale - dw) / 2;
		const offY = (nh * scale - dh) / 2;
		const map = (p: { x: number; y: number }) => ({ x: p.x * scale - offX, y: p.y * scale - offY });
		const ctx = overlayEl.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, dw, dh);
		const pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner].map(map);
		ctx.beginPath();
		ctx.moveTo(pts[0].x, pts[0].y);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
		ctx.closePath();
		ctx.lineWidth = 4;
		ctx.strokeStyle = '#22c55e';
		ctx.stroke();
	}

	function scanFrame() {
		if (!open || captured || !videoEl || !canvas) return;
		const w = videoEl.videoWidth;
		const h = videoEl.videoHeight;
		if (w && h) {
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			if (ctx) {
				ctx.drawImage(videoEl, 0, 0, w, h);
				const img = ctx.getImageData(0, 0, w, h);
				const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
				const raw = code?.data?.trim();
				if (code && raw) {
					captured = true;
					beep();
					flash = true;
					setTimeout(() => (flash = false), 400);
					drawBox(code.location);
					// Let the box and the flash register before the sheet closes.
					setTimeout(() => {
						stop();
						open = false;
						onScan(raw);
					}, 350);
					return;
				}
			}
		}
		raf = requestAnimationFrame(scanFrame);
	}

	$effect(() => {
		if (open) void start();
		else stop();
	});

	onDestroy(stop);
</script>

{#if open}
	<div class="fixed inset-0 z-[300] flex flex-col bg-black" dir="rtl">
		<div class="flex shrink-0 items-center justify-between gap-2 p-3 text-white">
			<span class="flex items-center gap-2 text-base font-black">
				<ScanLine class="size-5" /> امسح ملصق الطلب
			</span>
			<div class="flex items-center gap-1">
				{#if torchSupported}
					<button
						type="button"
						class="apple-press rounded-full p-2.5 {torchOn ? 'bg-amber-400 text-black' : 'text-white/80'}"
						aria-label="الإضاءة"
						onclick={() => void toggleTorch()}
					>
						<Flashlight class="size-5" />
					</button>
				{/if}
				<button
					type="button"
					class="apple-press rounded-full p-2.5 text-white/80"
					aria-label="إغلاق"
					onclick={() => (open = false)}
				>
					<X class="size-6" />
				</button>
			</div>
		</div>

		<div class="relative flex-1 overflow-hidden">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={videoEl} class="size-full object-cover" playsinline muted></video>
			<canvas bind:this={overlayEl} class="pointer-events-none absolute inset-0 size-full"></canvas>
			{#if flash}
				<div class="pointer-events-none absolute inset-0 bg-emerald-400/40"></div>
			{/if}
			<!-- A frame to aim with; the whole picture is decoded regardless. -->
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
				<div class="size-56 rounded-3xl border-4 border-white/70 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]"></div>
			</div>
		</div>

		<p class="shrink-0 p-4 text-center text-sm font-bold text-white/80">
			{message || 'وجّه الكاميرا نحو الباركود على الملصق'}
		</p>
	</div>
{/if}
