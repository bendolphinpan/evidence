<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { Button } from '@evidence/core/shadcn/components/ui/button';
	import { Input } from '@evidence/core/shadcn/components/ui/input';
	import { Plus } from 'lucide-svelte';
	import { createReportPage } from './new-page';

	let { projectId }: { projectId: string } = $props();

	let open = $state(false);
	let slug = $state('');
	let title = $state('');
	let message = $state('');
	let busy = $state(false);

	async function submit(e: Event) {
		e.preventDefault();
		busy = true;
		message = '';
		try {
			const result = await createReportPage({ slug, title, projectId });
			if ('error' in result) {
				message = result.error;
				return;
			}
			open = false;
			slug = '';
			title = '';
			await invalidateAll();
			await goto(result.href);
		} finally {
			busy = false;
		}
	}
</script>

<button
	type="button"
	class="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm"
	onclick={() => (open = !open)}
>
	<Plus class="size-3.5 shrink-0" />
	新建页面
</button>
{#if open}
	<form class="space-y-2 px-2 py-1" onsubmit={submit}>
		<Input class="h-8" placeholder="路径，如 retention" bind:value={slug} required />
		<Input class="h-8" placeholder="标题" bind:value={title} />
		{#if message}
			<p class="text-destructive text-xs">{message}</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button type="button" variant="ghost" size="sm" onclick={() => (open = false)}>取消</Button>
			<Button type="submit" size="sm" disabled={busy}>{busy ? '创建中…' : '创建'}</Button>
		</div>
	</form>
{/if}
