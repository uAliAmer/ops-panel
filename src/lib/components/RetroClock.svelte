<script lang="ts">
	// Header clock, Baghdad time (UTC+3, no DST), 12-hour.
	//
	// Plain text, quietly: the header now carries chat, reminders, delivery and
	// money, and an LED panel shouting in the middle of them was the loudest
	// thing in a bar where nothing else is decorative. The colon still blinks on
	// the second, which is the whole reason anyone looks at a clock twice.
	import { onMount, onDestroy } from 'svelte';

	// Fixed zone: the branches and the carrier all run on Baghdad time, so the
	// clock must not follow the device's — a phone left on another timezone would
	// otherwise quietly disagree with every timestamp in the app.
	// `flat` drops the pill so the clock can share the centre chip with the
	// delivery count.
	let { flat = false }: { flat?: boolean } = $props();

	const TZ = 'Asia/Baghdad';
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: true
	});

	let now = $state(new Date());
	let timer: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		// Tick on the second so the colon blinks in step with the wall clock
		// instead of drifting a few hundred ms per minute.
		const align = 1000 - (Date.now() % 1000);
		const start = setTimeout(() => {
			now = new Date();
			timer = setInterval(() => (now = new Date()), 1000);
		}, align);
		return () => clearTimeout(start);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const parts = $derived.by(() => {
		const [clock, meridiem = ''] = fmt.format(now).split(' '); // "11:53 PM"
		const [hh = '00', mm = '00'] = clock.split(':');
		return { hh, mm, meridiem: meridiem === 'AM' ? 'ص' : 'م' };
	});

	// Blink in step with the tick above.
	const lit = $derived(now.getSeconds() % 2 === 0);
</script>

<span
	class={flat
		? 'text-foreground/90 inline-flex h-9 shrink-0 items-center gap-1 px-2.5 text-sm font-bold tabular-nums'
		: 'border-border/60 bg-card/60 text-foreground/90 inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-sm font-bold tabular-nums shadow-xs ring-1 ring-white/10 ring-inset backdrop-blur-2xl backdrop-saturate-200'}
	dir="ltr"
	title="توقيت بغداد"
	aria-label="الساعة بتوقيت بغداد {parts.hh}:{parts.mm} {parts.meridiem}"
>
	<span aria-hidden="true">
		{parts.hh}<span class="transition-opacity duration-200" class:opacity-20={!lit}>:</span>{parts.mm}
	</span>
	<span class="text-muted-foreground text-[10px] font-bold">{parts.meridiem}</span>
</span>
