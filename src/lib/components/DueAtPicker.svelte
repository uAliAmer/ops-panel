<script lang="ts">
	// Reminder due-time picker. The answer line comes first — it is what the
	// operator is actually choosing — then one-tap presets for the common case,
	// then a calendar + time panel for anything else.
	//
	// The calendar is hand-rolled rather than a native date/time input pair: the
	// native controls render Gregorian in the *browser's* locale and force LTR
	// inside an otherwise Arabic RTL panel, and their value is local-timezone
	// shaped, which fights the fixed Baghdad offset everything here is built on.
	// Everything below is read/written as Baghdad (UTC+3) wall-clock time via
	// baghdadTime.ts, never the browser's own timezone — see that file for why.
	import { CalendarDays, ChevronDown, ChevronRight, ChevronLeft, AlertTriangle } from '@lucide/svelte';
	import { haptic } from '$lib/utils/haptic';
	import {
		baghdadPartsToIso,
		isoToBaghdadParts,
		nowBaghdadParts,
		formatBaghdad,
		formatRelative,
		arDigits,
		isPast
	} from '$lib/utils/baghdadTime';

	let {
		value = $bindable(new Date(Date.now() + 60 * 60_000).toISOString()),
		variant = 'schedule'
	}: { value?: string; variant?: 'schedule' | 'snooze' } = $props();

	/** Round up to the next 5 minutes. Presets built off "now" would otherwise
	 *  land on 14:37, which reads like a mistake and can't be re-selected from
	 *  the 5-minute minute list. */
	function snap(ms: number): string {
		const step = 5 * 60_000;
		return new Date(Math.ceil(ms / step) * step).toISOString();
	}

	type Preset = { label: string; apply: () => string };

	const SCHEDULE_PRESETS: Preset[] = [
		{ label: 'بعد ساعة', apply: () => snap(Date.now() + 60 * 60_000) },
		{ label: 'بعد ٣ ساعات', apply: () => snap(Date.now() + 3 * 60 * 60_000) },
		{
			label: 'الليلة ٨',
			apply: () => {
				const n = nowBaghdadParts();
				return baghdadPartsToIso(n.y, n.m, n.hh >= 20 ? n.d + 1 : n.d, 20, 0);
			}
		},
		{
			label: 'غدًا ٩ ص',
			apply: () => {
				const n = nowBaghdadParts();
				return baghdadPartsToIso(n.y, n.m, n.d + 1, 9, 0);
			}
		},
		{
			label: 'غدًا ٤ م',
			apply: () => {
				const n = nowBaghdadParts();
				return baghdadPartsToIso(n.y, n.m, n.d + 1, 16, 0);
			}
		},
		{
			label: 'بعد أسبوع',
			apply: () => {
				const n = nowBaghdadParts();
				return baghdadPartsToIso(n.y, n.m, n.d + 7, 9, 0);
			}
		}
	];

	// Snoozing is a different question from scheduling: it is almost always
	// "not now, ask me again shortly", so the short offsets come first.
	const SNOOZE_PRESETS: Preset[] = [
		{ label: 'بعد ١٠ دقائق', apply: () => snap(Date.now() + 10 * 60_000) },
		{ label: 'بعد ٣٠ دقيقة', apply: () => snap(Date.now() + 30 * 60_000) },
		{ label: 'بعد ساعة', apply: () => snap(Date.now() + 60 * 60_000) },
		{ label: 'بعد ٣ ساعات', apply: () => snap(Date.now() + 3 * 60 * 60_000) },
		{
			label: 'الليلة ٨',
			apply: () => {
				const n = nowBaghdadParts();
				return baghdadPartsToIso(n.y, n.m, n.hh >= 20 ? n.d + 1 : n.d, 20, 0);
			}
		},
		{
			label: 'غدًا ٩ ص',
			apply: () => {
				const n = nowBaghdadParts();
				return baghdadPartsToIso(n.y, n.m, n.d + 1, 9, 0);
			}
		}
	];

	const presets = $derived(variant === 'snooze' ? SNOOZE_PRESETS : SCHEDULE_PRESETS);

	// Which chip is lit. Tracked rather than derived by comparing ISO strings:
	// the offset presets are built from Date.now(), so a match would go stale a
	// second after the tap.
	let activePreset = $state<string | null>(null);
	let open = $state(false);

	const parts = $derived(isoToBaghdadParts(value));
	const today = $derived(nowBaghdadParts());

	// Month on display in the calendar. Follows the selected date until the
	// operator navigates away from it.
	let viewY = $state(0);
	let viewM = $state(0);
	$effect(() => {
		if (!open) {
			viewY = parts.y;
			viewM = parts.m;
		}
	});

	const MIN_TICK = 60_000;
	// Re-render the relative hint ("بعد ساعتين") as the clock moves, otherwise a
	// panel left open drifts out of date.
	let tick = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (tick = Date.now()), MIN_TICK);
		return () => clearInterval(id);
	});

	const relative = $derived(formatRelative(value, tick));
	const past = $derived(isPast(value, tick));

	// Saturday-first, the Iraqi week. getUTCDay is Sunday-first, so a day's
	// column is (dow + 1) % 7.
	const WEEKDAYS = ['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];
	const MONTHS = [
		'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
		'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'
	];

	type Cell = { d: number; disabled: boolean; isToday: boolean; selected: boolean };

	const cells: (Cell | null)[] = $derived.by(() => {
		const firstDow = new Date(Date.UTC(viewY, viewM - 1, 1)).getUTCDay();
		const lead = (firstDow + 1) % 7;
		const days = new Date(Date.UTC(viewY, viewM, 0)).getUTCDate();
		const out: (Cell | null)[] = Array(lead).fill(null);
		for (let d = 1; d <= days; d++) {
			const before =
				viewY < today.y ||
				(viewY === today.y && viewM < today.m) ||
				(viewY === today.y && viewM === today.m && d < today.d);
			out.push({
				d,
				disabled: before,
				isToday: viewY === today.y && viewM === today.m && d === today.d,
				selected: viewY === parts.y && viewM === parts.m && d === parts.d
			});
		}
		while (out.length % 7 !== 0) out.push(null);
		return out;
	});

	// Never let the operator page back past the current month — a reminder in
	// the past is always a mistake, not a choice.
	const canPrev = $derived(viewY > today.y || (viewY === today.y && viewM > today.m));

	function shiftMonth(delta: number) {
		haptic(8);
		const next = new Date(Date.UTC(viewY, viewM - 1 + delta, 1));
		viewY = next.getUTCFullYear();
		viewM = next.getUTCMonth() + 1;
	}

	function pickPreset(p: Preset) {
		haptic(10);
		value = p.apply();
		activePreset = p.label;
		open = false;
	}

	function pickDay(c: Cell) {
		if (c.disabled) return;
		haptic(8);
		value = baghdadPartsToIso(viewY, viewM, c.d, parts.hh, parts.mm);
		activePreset = null;
	}

	function setTime(hh: number, mm: number) {
		haptic(8);
		value = baghdadPartsToIso(parts.y, parts.m, parts.d, hh, mm);
		activePreset = null;
	}

	// Quick times cover the shape of an ops day; the three selects underneath
	// handle everything else.
	const QUICK_TIMES: { label: string; hh: number }[] = [
		{ label: '٩ ص', hh: 9 },
		{ label: '١٢ م', hh: 12 },
		{ label: '٣ م', hh: 15 },
		{ label: '٦ م', hh: 18 },
		{ label: '٨ م', hh: 20 },
		{ label: '١٠ م', hh: 22 }
	];

	const HOURS12 = Array.from({ length: 12 }, (_, i) => i + 1);
	// 5-minute steps, plus whatever minute the current value sits on so an
	// inherited off-step time still shows as selected instead of snapping.
	const minuteOptions = $derived(
		[...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), parts.mm])].sort((a, b) => a - b)
	);
	const hour12 = $derived(parts.hh % 12 || 12);
	const isPm = $derived(parts.hh >= 12);

	function setHour12(h: number) {
		setTime(isPm ? (h % 12) + 12 : h % 12, parts.mm);
	}
	function setPeriod(pm: boolean) {
		if (pm === isPm) return;
		setTime(pm ? (hour12 % 12) + 12 : hour12 % 12, parts.mm);
	}
</script>

<div class="min-w-0 space-y-2.5">
	<!-- The answer, first and biggest: what is actually being saved. Tapping it
	     opens the calendar, so the summary doubles as the disclosure control. -->
	<button
		type="button"
		class="apple-press flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-start transition-colors {past
			? 'border-rose-500/50 bg-rose-500/10'
			: open
				? 'border-primary/50 bg-primary/10'
				: 'border-border/60 bg-muted/40 hover:bg-muted/70'}"
		aria-expanded={open}
		onclick={() => {
			haptic(8);
			open = !open;
		}}
	>
		{#if past}
			<AlertTriangle class="size-4 shrink-0 text-rose-600 dark:text-rose-400" />
		{:else}
			<CalendarDays class="text-muted-foreground size-4 shrink-0" />
		{/if}
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-black">{formatBaghdad(value)}</span>
			<span
				class="block text-[11px] font-bold {past
					? 'text-rose-600 dark:text-rose-400'
					: 'text-muted-foreground'}"
			>
				{past ? 'هذا الوقت مضى — اختر وقتًا لاحقًا' : relative} · بغداد UTC+٣
			</span>
		</span>
		<ChevronDown
			class="text-muted-foreground size-4 shrink-0 transition-transform {open ? 'rotate-180' : ''}"
		/>
	</button>

	<!-- Presets wrap instead of scrolling sideways: the old row pushed the
	     custom-date control off the edge of a phone screen, where nobody found it. -->
	<div class="grid grid-cols-3 gap-1.5">
		{#each presets as p (p.label)}
			<button
				type="button"
				aria-pressed={activePreset === p.label}
				class="apple-press truncate rounded-full border px-2 py-1.5 text-xs font-bold transition-colors {activePreset ===
				p.label
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-border/60 bg-muted/40 hover:bg-muted/70'}"
				onclick={() => pickPreset(p)}
			>
				{p.label}
			</button>
		{/each}
	</div>

	{#if open}
		<!-- The panel runs LTR even though the app is RTL: a calendar grid and a
		     clock both read left-to-right, and mirroring them put the back arrow
		     on the right and the hour after the minute. Only the direction flips
		     here — the labels, weekday names and digits stay Arabic. -->
		<div class="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-2.5" dir="ltr">
			<div class="flex items-center justify-between">
				<button
					type="button"
					class="apple-press text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-full hover:bg-muted/70 disabled:opacity-30"
					aria-label="الشهر السابق"
					disabled={!canPrev}
					onclick={() => shiftMonth(-1)}
				>
					<ChevronLeft class="size-4.5" />
				</button>
				<span class="text-sm font-black" dir="rtl">{MONTHS[viewM - 1]} {arDigits(viewY)}</span>
				<button
					type="button"
					class="apple-press text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-full hover:bg-muted/70"
					aria-label="الشهر التالي"
					onclick={() => shiftMonth(1)}
				>
					<ChevronRight class="size-4.5" />
				</button>
			</div>

			<div class="grid grid-cols-7 gap-0.5">
				{#each WEEKDAYS as w (w)}
					<span class="text-muted-foreground py-1 text-center text-[10px] font-bold">{w}</span>
				{/each}
				{#each cells as c, i (i)}
					{#if c}
						<button
							type="button"
							aria-label="{arDigits(c.d)} {MONTHS[viewM - 1]}"
							aria-pressed={c.selected}
							disabled={c.disabled}
							class="apple-press flex h-9 items-center justify-center rounded-lg text-xs font-bold transition-colors {c.selected
								? 'bg-primary text-primary-foreground'
								: c.disabled
									? 'text-muted-foreground/30'
									: c.isToday
										? 'text-primary ring-1 ring-primary/50 hover:bg-muted/70'
										: 'hover:bg-muted/70'}"
							onclick={() => pickDay(c)}
						>
							{arDigits(c.d)}
						</button>
					{:else}
						<span></span>
					{/if}
				{/each}
			</div>

			<div class="grid grid-cols-6 gap-1">
				{#each QUICK_TIMES as t (t.hh)}
					<button
						type="button"
						dir="rtl"
						aria-pressed={parts.hh === t.hh && parts.mm === 0}
						class="apple-press rounded-full border px-1 py-1.5 text-[11px] font-bold transition-colors {parts.hh ===
							t.hh && parts.mm === 0
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-border/60 bg-muted/40 hover:bg-muted/70'}"
						onclick={() => setTime(t.hh, 0)}
					>
						{t.label}
					</button>
				{/each}
			</div>

			<!-- Selects, not <input type="time">: the native control renders its own
			     AM/PM in the browser locale and forces LTR inside an RTL panel. On a
			     phone these still open the OS wheel. Options carry an explicit opaque
			     background — Chrome paints the popup from the select's own
			     background-color, and the translucent one left white-on-white. -->
			<div class="flex items-end gap-1.5">
				<div class="min-w-0 flex-1">
					<span class="text-muted-foreground mb-1 block text-center text-[10px] font-bold">
						ساعة
					</span>
					<select
						aria-label="الساعة"
						value={hour12}
						onchange={(e) => setHour12(Number((e.target as HTMLSelectElement).value))}
						class="border-input dark:bg-input/30 text-foreground [&>option]:bg-popover [&>option]:text-popover-foreground h-11 w-full rounded-xl border bg-transparent px-2 text-center text-sm font-bold outline-none"
					>
						{#each HOURS12 as h (h)}
							<option value={h}>{arDigits(h)}</option>
						{/each}
					</select>
				</div>
				<div class="min-w-0 flex-1">
					<span class="text-muted-foreground mb-1 block text-center text-[10px] font-bold">
						دقيقة
					</span>
					<select
						aria-label="الدقيقة"
						value={parts.mm}
						onchange={(e) => setTime(parts.hh, Number((e.target as HTMLSelectElement).value))}
						class="border-input dark:bg-input/30 text-foreground [&>option]:bg-popover [&>option]:text-popover-foreground h-11 w-full rounded-xl border bg-transparent px-2 text-center text-sm font-bold outline-none"
					>
						{#each minuteOptions as m (m)}
							<option value={m}>{arDigits(String(m).padStart(2, '0'))}</option>
						{/each}
					</select>
				</div>
				<div class="shrink-0">
					<span class="text-muted-foreground mb-1 block text-center text-[10px] font-bold" dir="rtl">
						ص / م
					</span>
					<div class="border-input flex h-11 overflow-hidden rounded-xl border">
						{#each [{ label: 'ص', pm: false }, { label: 'م', pm: true }] as opt (opt.label)}
							<button
								type="button"
								aria-pressed={isPm === opt.pm}
								class="apple-press w-10 text-sm font-bold transition-colors {isPm === opt.pm
									? 'bg-primary text-primary-foreground'
									: 'hover:bg-muted/70'}"
								onclick={() => setPeriod(opt.pm)}
							>
								{opt.label}
							</button>
						{/each}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
