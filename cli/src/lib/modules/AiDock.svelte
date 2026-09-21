<script lang="ts">
	import { Button } from '@evidence/core/shadcn/components/ui/button';
	import { Input } from '@evidence/core/shadcn/components/ui/input';
	import { Query } from '@evidence/core/Query.svelte';
	import { invalidateAll } from '$app/navigation';
	import { X } from 'lucide-svelte';

	type Msg = { role: 'user' | 'assistant'; text: string };

	let { slug, onClose }: { slug: string; onClose: () => void } = $props();

	let prompt = $state('');
	let pending = $state(false);
	let error = $state('');
	let messages = $state<Msg[]>([]);

	async function send() {
		const text = prompt.trim();
		if (!text || pending) return;
		prompt = '';
		error = '';
		messages = [...messages, { role: 'user', text }];
		pending = true;
		const res = await fetch('/api/modules/ai/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: text, slug })
		});
		const json = await res.json();
		pending = false;
		if (!res.ok) {
			error = json.error || '失败';
			return;
		}
		messages = [...messages, { role: 'assistant', text: json.reply }];
		if (json.patched) {
			await invalidateAll();
			Query.refreshAll();
		}
	}
</script>

<aside class="bg-background flex h-full w-[min(100%,24rem)] shrink-0 flex-col border-l">
	<div class="flex h-12 items-center justify-between border-b px-3">
		<div>
			<div class="text-sm font-medium">AI</div>
			<div class="text-muted-foreground text-[11px]">/{slug}</div>
		</div>
		<Button variant="ghost" size="icon-sm" onclick={onClose} aria-label="关闭 AI">
			<X class="size-4" />
		</Button>
	</div>
	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
		{#if messages.length === 0}
			<p class="text-muted-foreground text-xs leading-5">
				问口径、查数，或让 AI 改这一页。左边报告还在。viewer 不能写页。
			</p>
		{/if}
		{#each messages as m, i (i)}
			<div
				class="rounded-lg px-3 py-2 text-sm leading-5 {m.role === 'user'
					? 'bg-muted ml-6'
					: 'bg-card mr-2 border shadow-xs'}"
			>
				<div class="whitespace-pre-wrap">{m.text}</div>
			</div>
		{/each}
		{#if pending}
			<p class="text-muted-foreground text-xs">思考中…</p>
		{/if}
		{#if error}
			<p class="text-destructive text-xs">{error}</p>
		{/if}
	</div>
	<form
		class="border-t p-3"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		<div class="flex gap-2">
			<Input bind:value={prompt} placeholder="问这一页…" class="h-9" />
			<Button type="submit" size="sm" disabled={pending}>发送</Button>
		</div>
	</form>
</aside>
