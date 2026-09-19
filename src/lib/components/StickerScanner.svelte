<script lang="ts">
	/**
	 * Scan (or type) a preprinted Alwaseet sticker id and validate it with the
	 * carrier before an order is bound to it.
	 *
	 * The sticker carries TWO QR codes: the merchant one (bottom-left) encodes a
	 * bare numeric id like `149416951`; the customer one (top-left) is a rating
	 * URL. We accept only all-digit scans, so the rating URL is ignored no matter
	 * which QR the camera sees first — then the server (`/sticker/validate`) is
	 * the final gate.
	 *
	 * Decoding uses jsQR against a canvas frame (works on any HTTPS browser, unlike
	 * BarcodeDetector). On capture: a loud beep, a green flash, a box drawn on the
	 * detected QR, then validation. A torch toggle appears where the camera
	 * supports it (warehouses are dim). Manual entry is always the fallback.
	 */
	import { onMount, onDestroy, tick } from 'svelte';
	import jsQR from 'jsqr';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Camera, X, Check, Loader2, ScanLine, Flashlight } from '@lucide/svelte';
	import { api } from '$lib/api';
	import { cn, NO_SPINNER } from '$lib/utils';

	type Props = {
		/** Called with the id once the carrier confirms it is free to bind. */
		onValid: (qrId: string) => void;
		/** Called when the chosen sticker is cleared/invalidated. */
		onReset: () => void;
	};
	let { onValid, onReset }: Props = $props();

	type Status = 'idle' | 'checking' | 'valid' | 'used' | 'error';
	let status = $state<Status>('idle');
	let message = $state('');
	let scannedId = $state('');
	let manual = $state('');

	let scanning = $state(false);
	let captured = false; // guards against re-detecting while we transition
	let flash = $state(false); // green success flash
	let videoEl: HTMLVideoElement | undefined = $state();
	let overlayEl: HTMLCanvasElement | undefined = $state();
	let canvas: HTMLCanvasElement | null = null; // offscreen, for jsQR
	let stream: MediaStream | null = null;
	let track: MediaStreamTrack | null = null;
	let raf = 0;

	let torchSupported = $state(false);
	let torchOn = $state(false);

	const ONLY_DIGITS = /^\d{6,}$/;

	// Loud confirmation beep on a successful scan — generated, no audio file
	// (CSP blocks external assets).
	let audioCtx: AudioContext | null = null;
	function beep() {
		try {
			audioCtx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
			if (audioCtx.state === 'suspended') void audioCtx.resume();
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			osc.type = 'square';
			osc.frequency.value = 1000;
			gain.gain.value = 0.6;
			osc.connect(gain).connect(audioCtx.destination);
			const t0 = audioCtx.currentTime;
			osc.start(t0);
			osc.stop(t0 + 0.18);
		} catch {
			/* audio unavailable */
		}
		try { navigator.vibrate?.(200); } catch { /* no haptics */ }
	}

	async function validate(id: string) {
		const clean = id.trim();
		if (!ONLY_DIGITS.test(clean)) {
			status = 'error';
			message = 'رمز غير صالح — امسح كود التاجر (الأرقام)';
			onReset();
			return;
		}
		status = 'checking';
		message = '';
		try {
			const res = await api.validateSticker(clean);
			if (res.success && res.ok) {
				scannedId = clean;
				status = 'valid';
				message = res.msg || 'صالح للاستخدام';
				onValid(clean);
			} else if (res.used) {
				status = 'used';
				message = res.msg || 'الملصق مستخدم بالفعل';
				onReset();
			} else {
				status = 'error';
				message = res.error || res.msg || 'تعذّر التحقق من الملصق';
				onReset();
			}
		} catch {
			status = 'error';
			message = 'تعذّر الاتصال للتحقق';
			onReset();
		}
	}

	async function startScan() {
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
			// Torch only exists on some (mostly rear phone) cameras.
			try {
				const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
				torchSupported = Boolean(caps?.torch);
			} catch {
				torchSupported = false;
			}
			torchOn = false;
			// Mount the <video> first (it only renders while scanning), let the DOM
			// update so videoEl binds, THEN attach the stream.
			scanning = true;
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
					? 'تم رفض إذن الكاميرا — فعّله ثم أعد المحاولة'
					: name === 'NotFoundError'
						? 'لا توجد كاميرا — أدخل الرقم يدوياً'
						: 'تعذّر فتح الكاميرا — أدخل الرقم يدوياً';
			stopScan();
		}
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

	// Map a jsQR location (native video px) to the overlay canvas, accounting for
	// the object-cover crop, and draw the detected quad.
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
		if (!scanning || captured || !videoEl || !canvas) return;
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
				// Take the merchant (numeric) QR; skip the rating URL silently.
				if (code && raw && ONLY_DIGITS.test(raw)) {
					captured = true;
					beep();
					flash = true;
					setTimeout(() => (flash = false), 400);
					drawBox(code.location);
					// Leave the box + flash visible briefly, then validate.
					setTimeout(() => {
						stopScan();
						void validate(raw);
					}, 400);
					return;
				}
			}
		}
		raf = requestAnimationFrame(scanFrame);
	}

	function stopScan() {
		scanning = false;
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		if (track && torchOn) {
			try { void track.applyConstraints({ advanced: [{ torch: false }] } as unknown as MediaTrackConstraints); } catch { /* */ }
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

	function clearChoice() {
		stopScan();
		captured = false;
		scannedId = '';
		manual = '';
		status = 'idle';
		message = '';
		onReset();
	}

	onMount(() => {
		void startScan();
	});

	onDestroy(stopScan);
</script>

<div class="space-y-2">
	{#if status === 'valid'}
		<!-- Success: prominent, so the operator sees it's locked and can hit confirm -->
		<div
			class="flex flex-col items-center gap-1 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-4"
		>
			<div class="flex size-11 items-center justify-center rounded-full bg-emerald-500 text-white">
				<Check class="size-6" />
			</div>
			<span class="text-lg font-extrabold tabular-nums">{scannedId}</span>
			<span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">صالح — جاهز للربط</span>
			<button type="button" class="mt-1 text-[11px] text-muted-foreground underline" onclick={clearChoice}>
				مسح ملصق آخر
			</button>
		</div>
	{:else}
		{#if scanning}
			<div class="relative overflow-hidden rounded-xl border-2 border-primary">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video bind:this={videoEl} class="aspect-square w-full object-cover" playsinline muted autoplay></video>
				<!-- detection box overlay -->
				<canvas bind:this={overlayEl} class="pointer-events-none absolute inset-0 h-full w-full"></canvas>
				<!-- green success flash -->
				{#if flash}
					<div class="pointer-events-none absolute inset-0 bg-emerald-400/50"></div>
				{/if}
				<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
					<ScanLine class="size-16 text-white/70" />
				</div>
				{#if torchSupported}
					<Button
						variant={torchOn ? 'default' : 'secondary'}
						size="icon"
						class="absolute right-2 top-2 size-10"
						onclick={toggleTorch}
						aria-label="الإضاءة"
					>
						<Flashlight class="size-5" />
					</Button>
				{/if}
				<Button
					variant="secondary"
					class="absolute bottom-2 left-1/2 h-9 -translate-x-1/2"
					onclick={stopScan}
				>
					إيقاف
				</Button>
			</div>
		{:else}
			<Button type="button" variant="outline" class="h-12 w-full gap-2 border-dashed" onclick={startScan}>
				<Camera class="size-5" /> مسح ملصق الوسيط بالكاميرا
			</Button>
		{/if}

		<!-- Manual fallback -->
		<div class="flex items-center gap-2">
			<Input
				inputmode="numeric"
				bind:value={manual}
				placeholder="أو أدخل رقم الملصق"
				class={cn('h-11 text-center tabular-nums', NO_SPINNER)}
				onkeydown={(e) => { if (e.key === 'Enter') void validate(manual); }}
			/>
			<Button
				type="button"
				class="h-11 shrink-0"
				disabled={status === 'checking' || !manual.trim()}
				onclick={() => void validate(manual)}
			>
				{#if status === 'checking'}<Loader2 class="size-4 animate-spin" />{:else}تحقّق{/if}
			</Button>
		</div>
	{/if}

	{#if message && status !== 'valid'}
		<p
			class={cn(
				'text-center text-xs font-semibold',
				status === 'used' || status === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
			)}
		>
			{message}
		</p>
	{/if}
</div>
