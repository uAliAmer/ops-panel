<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let submitting = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		submitting = true;
		try {
			const res = await auth.login(email, password);
			if (!res.success) {
				error = res.error ?? 'فشل تسجيل الدخول';
			}
		} catch (err) {
			error = (err as Error).message;
		} finally {
			submitting = false;
		}
	}
</script>

<div class="bg-background flex min-h-dvh flex-col items-center justify-center px-6">
	<div class="mb-6 flex items-center gap-2.5">
		<img src="{base}/icons/icon-192.png" alt="OPS" class="size-11 rounded-2xl shadow-md" />
		<h1 class="text-3xl font-black tracking-tight">OPS</h1>
	</div>
	<p class="text-muted-foreground mb-8 text-xs font-semibold tracking-wider uppercase">Operations Control</p>

	<form onsubmit={handleSubmit} class="w-full max-w-sm space-y-4">
		<div class="space-y-1.5">
			<Label for="email">البريد الإلكتروني</Label>
			<Input
				id="email"
				type="email"
				autocomplete="email"
				bind:value={email}
				required
				dir="ltr"
				class="text-left"
			/>
		</div>
		<div class="space-y-1.5">
			<Label for="password">كلمة المرور</Label>
			<Input
				id="password"
				type="password"
				autocomplete="current-password"
				bind:value={password}
				required
				dir="ltr"
				class="text-left"
			/>
		</div>

		{#if error}
			<p class="text-destructive text-center text-sm">{error}</p>
		{/if}

		<Button type="submit" class="w-full" disabled={submitting}>
			{submitting ? 'جاري الدخول…' : 'تسجيل الدخول'}
		</Button>
	</form>
</div>
