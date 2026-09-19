<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { ChevronDown } from '@lucide/svelte';
	import { searchByName } from '$lib/utils/arabic-search';
	import { cn } from '$lib/utils';
	import { floatLabelClass } from '$lib/utils/floatLabel';

	type Item = { id: number | string; name: string; nameAr?: string };

	type Props = {
		items: Item[];
		value: { id: number | string | null; name: string };
		placeholder?: string;
		disabled?: boolean;
		onSelect?: (item: Item) => void;
		/** Renders a floating label; the placeholder then shows only on focus. */
		label?: string;
		id?: string;
		bg?: string;
	};
	let {
		items,
		value = $bindable(),
		placeholder = 'ابحث…',
		disabled = false,
		onSelect,
		label,
		id,
		bg = 'bg-background'
	}: Props = $props();

	let query = $state(value.name ?? '');
	let open = $state(false);
	let containerEl: HTMLDivElement | undefined = $state();

	let focused = $state(false);
	const floated = $derived(focused || Boolean(query));

	$effect(() => {
		query = value.name ?? '';
	});

	// searchByName wants both names; fill nameAr from name when the list has no
	// Arabic column. Derived from `items` (not per keystroke) so the identity
	// stays stable and searchByName's fold cache actually hits.
	const searchItems = $derived(items.map((i) => ({ ...i, nameAr: i.nameAr ?? i.name })));

	// Arabic/Kurdish-tolerant: folds alef/teh-marbuta/yeh variants, strips the
	// definite article and ranks hits, so «اعظميه» finds «الأعظمية». A plain
	// includes() missed those and pushed operators toward picking «اخرى».
	const filtered = $derived(searchByName(searchItems, query).slice(0, 15));

	function handleSelect(item: Item) {
		const displayName = item.nameAr ?? item.name;
		value = { id: item.id, name: displayName };
		query = displayName;
		open = false;
		onSelect?.(item);
	}

	function handleClick(event: MouseEvent) {
		if (containerEl && !containerEl.contains(event.target as Node)) open = false;
	}

	$effect(() => {
		if (open) {
			document.addEventListener('click', handleClick);
			return () => document.removeEventListener('click', handleClick);
		}
	});
</script>

<div class={cn('relative', open ? 'z-50' : 'z-0')} bind:this={containerEl}>
	<div class="relative">
		<Input
			{id}
			bind:value={query}
			oninput={() => {
				open = true;
				if (query !== value.name) value = { id: null, name: query };
			}}
			onfocus={() => {
				open = true;
				focused = true;
			}}
			onblur={() => (focused = false)}
			placeholder={label && !focused ? '' : placeholder}
			{disabled}
			autocomplete="off"
			class={cn('bg-background dark:bg-background', label && 'h-11 pe-8 text-base')}
		/>
		{#if label}
			<label for={id} class={floatLabelClass({ floated, focused, bg })}>{label}</label>
		{/if}
		<ChevronDown class="text-muted-foreground absolute end-2 top-1/2 size-4 -translate-y-1/2" />
	</div>

	{#if open && filtered.length > 0}
		<div
			class="bg-popover absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border/80 shadow-2xl backdrop-blur-2xl ring-1 ring-black/10 dark:ring-white/15"
		>
			{#each filtered as item (item.id)}
				<button
					type="button"
					class="hover:bg-accent block w-full px-3 py-2 text-right text-sm"
					onclick={() => handleSelect(item)}
				>
					{item.nameAr ?? item.name}
				</button>
			{/each}
		</div>
	{/if}
</div>
