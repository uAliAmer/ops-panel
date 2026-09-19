<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import IdleCreature from '$lib/components/IdleCreature.svelte';

	// Playful Iraqi-dialect lines for an empty "بانتظار" tab — inbox-zero vibes.
	const lines = [
		'كل الطلبات مخلّصة',
		'ما أكو شي بالانتظار… استرح شوية',
		'زيرو طلبات — بطل',
		'نظيف نظيف، ولا طلب ناقص',
		'ارتاح، ما أكو ضغط هسه',
		'شغل اليوم منجز، عاشت إيدك',
		'الدنيا هادئة… وقت تشرب جاي',
		'كل شي تمام، خَلّيك مرتاح',
		'سبقت الطلبات كلها — جاهز للجاي',
		'صندوقك فاضي، استمتع بالهدوء'
	];

	let i = $state(0);
	const reduce =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	onMount(() => {
		const id = setInterval(() => {
			i = (i + 1) % lines.length;
		}, 3200);
		return () => clearInterval(id);
	});
</script>

<div class="flex flex-col items-center justify-center gap-6 px-6 py-24 text-center select-none">
	<!-- بانتظار: a turtle or an elephant (picked at random each load) -->
	<IdleCreature creature="random" />

	<!-- Looping sentence -->
	<div class="flex h-8 items-center justify-center overflow-hidden">
		{#key i}
			{#if reduce}
				<p in:fade={{ duration: 250 }} class="text-base font-black tracking-tight text-foreground">
					{lines[i]}
				</p>
			{:else}
				<p
					in:fly={{ y: 14, duration: 320 }}
					out:fly={{ y: -14, duration: 240 }}
					class="text-base font-black tracking-tight text-foreground"
				>
					{lines[i]}
				</p>
			{/if}
		{/key}
	</div>

	<p class="text-xs font-semibold text-muted-foreground">لا توجد طلبات بانتظار المراجعة حالياً</p>
</div>
