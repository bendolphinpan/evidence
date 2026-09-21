<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	type Msg = { role: 'user' | 'assistant'; text: string };

	const slug = $derived(page.url.searchParams.get('slug') || 'index');
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
			messages = [...messages, { role: 'assistant', text: `已改页 /${slug}，可回预览查看。` }];
		}
	}

	function previewHref() {
		return slug === 'index' ? '/' : '/' + slug;
	}
</script>

<svelte:head>
	<title>AI · {slug}</title>
</svelte:head>

<div class="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold">AI · /{slug}</h1>
		<button class="border-input border px-3 py-1.5 text-sm" type="button" onclick={() => goto(previewHref())}>回预览</button>
	</div>
	<p class="text-muted-foreground text-xs">只读查数、改当前报告页。viewer 不能写页。Key 留在服务端。</p>
	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
		{#each messages as m, i (i)}
			<div class="border-border border p-3 text-sm {m.role === 'user' ? 'bg-muted/40' : ''}">
				<div class="text-muted-foreground mb-1 text-xs">{m.role === 'user' ? '你' : 'AI'}</div>
				<div class="whitespace-pre-wrap">{m.text}</div>
			</div>
		{/each}
		{#if pending}
			<p class="text-muted-foreground text-sm">思考中…</p>
		{/if}
		{#if error}
			<p class="text-sm text-red-600">{error}</p>
		{/if}
	</div>
	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		<input class="border-input flex-1 border px-3 py-2 text-sm" bind:value={prompt} placeholder="问口径、查数、或让 AI 改这一页" />
		<button class="bg-foreground text-background px-4 py-2 text-sm" type="submit" disabled={pending}>发送</button>
	</form>
</div>
