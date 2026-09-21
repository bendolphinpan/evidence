<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { Button } from '@evidence/core/shadcn/components/ui/button';
	import { Input } from '@evidence/core/shadcn/components/ui/input';
	import {
		VIZ_PRESETS,
		applyFilterToSql,
		filterIdOf,
		filterIdsInSql,
		queriesUsingFilter,
		type Attr,
		type PageNode
	} from '$lib/modules/page-model';

	const field =
		'border-input bg-background rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
	const area = `${field} min-h-24 w-full`;
	const card = 'bg-card rounded-xl border p-4 shadow-sm space-y-2';

	let nodes = $state<PageNode[]>([]);
	let error = $state('');
	let message = $state('');
	const slug = $derived(page.params.slug || '');

	async function load() {
		error = '';
		const res = await fetch(`/api/modules/pages/${slug}`);
		const json = await res.json();
		if (json.nodes) nodes = json.nodes;
		if (!res.ok && res.status !== 409) error = json.error || '无法打开';
		else if (res.status === 409) error = json.error || '已被锁定';
	}

	$effect(() => {
		void slug;
		load();
	});

	onDestroy(() => {
		fetch(`/api/modules/pages/${slug}`, { method: 'DELETE' });
	});

	async function save() {
		const res = await fetch(`/api/modules/pages/${slug}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nodes })
		});
		const json = await res.json();
		if (!res.ok) error = json.error || '保存失败';
		else {
			error = '';
			message = '已保存';
		}
	}

	function previewHref() {
		return slug === 'index' ? '/' : '/' + slug;
	}

	function addMd() {
		nodes = [...nodes, { type: 'md', text: '' }];
	}

	function addFilter() {
		nodes = [
			...nodes,
			{
				type: 'filter',
				tag: 'range_calendar',
				attrs: [
					{ key: 'id', value: 'dates' },
					{ key: 'value_column', value: '$part_date' },
					{ key: 'default_range', value: 'last 7 days' }
				]
			}
		];
	}

	function addQuery() {
		const n = nodes.filter((x) => x.type === 'query').length + 1;
		const name = `query_${n}`;
		nodes = [
			...nodes,
			{
				type: 'query',
				name,
				sql: `SELECT\n  "$part_date" AS part_date,\n  COUNT(DISTINCT "#user_id") AS value\nFROM ta.v_event_51\nWHERE "$part_date" {{dates.between}}\n  AND "$part_event" = 'ta_app_start'\nGROUP BY 1\nORDER BY 1`,
				viz: [{ tag: 'table', attrs: [{ key: 'data', value: name }] }]
			}
		];
	}

	function removeAt(i: number) {
		nodes = nodes.filter((_, idx) => idx !== i);
	}

	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= nodes.length) return;
		if (nodes[i].type === 'frontmatter' || nodes[j].type === 'frontmatter') return;
		const copy = [...nodes];
		const tmp = copy[i];
		copy[i] = copy[j];
		copy[j] = tmp;
		nodes = copy;
	}

	function filters(): Extract<PageNode, { type: 'filter' }>[] {
		return nodes.filter((n): n is Extract<PageNode, { type: 'filter' }> => n.type === 'filter');
	}

	function bindQueryFilter(q: Extract<PageNode, { type: 'query' }>, filterId: string) {
		q.sql = applyFilterToSql(q.sql, filterId);
	}

	function addViz(q: Extract<PageNode, { type: 'query' }>, tag: string, extra: Attr[]) {
		q.viz = [...q.viz, { tag, attrs: [{ key: 'data', value: q.name }, ...extra] }];
	}

	function renameQuery(q: Extract<PageNode, { type: 'query' }>, name: string) {
		q.name = name;
		q.viz = q.viz.map((v) => ({
			...v,
			attrs: [{ key: 'data', value: name }, ...v.attrs.filter((a) => a.key !== 'data')]
		}));
	}

</script>

<svelte:head>
	<title>编辑 {slug}</title>
</svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-4 p-6">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold">编辑 /{slug}</h1>
		<div class="flex gap-2">
			<Button variant="outline" size="sm" type="button" onclick={() => goto(previewHref())}>预览</Button>
			<Button size="sm" type="button" onclick={save}>保存</Button>
		</div>
	</div>
	<div class="flex flex-wrap gap-2">
		<Button variant="outline" size="sm" type="button" onclick={addMd}>添加正文</Button>
		<Button variant="outline" size="sm" type="button" onclick={addFilter}>添加日历</Button>
		<Button variant="outline" size="sm" type="button" onclick={addQuery}>添加查询</Button>
	</div>
	{#if error}
		<p class="text-sm text-red-600">{error}</p>
	{/if}
	{#if message}
		<p class="text-muted-foreground text-sm">{message}</p>
	{/if}

	{#each nodes as node, i (i)}
		{#if node.type === 'frontmatter'}
			<div class={card}>
				<div class="text-muted-foreground text-xs">页头</div>
				<textarea class="{area} min-h-20 font-mono text-xs" bind:value={node.text}></textarea>
			</div>
		{:else if node.type === 'md'}
			<div class={card}>
				<div class="flex items-center justify-between">
					<div class="text-muted-foreground text-xs">正文</div>
					<div class="flex gap-2">
						<Button variant="ghost" size="sm" type="button" onclick={() => move(i, -1)}>上移</Button>
						<Button variant="ghost" size="sm" type="button" onclick={() => move(i, 1)}>下移</Button>
						<Button variant="ghost" size="sm" type="button" onclick={() => removeAt(i)}>删除</Button>
					</div>
				</div>
				<textarea class={area} bind:value={node.text} placeholder="说明文字"></textarea>
			</div>
		{:else if node.type === 'filter'}
			<div class={card}>
				<div class="flex items-center justify-between">
					<div class="text-xs font-medium">筛选 · {node.tag}</div>
					<div class="flex gap-2">
						<Button variant="ghost" size="sm" type="button" onclick={() => move(i, -1)}>上移</Button>
						<Button variant="ghost" size="sm" type="button" onclick={() => move(i, 1)}>下移</Button>
						<Button variant="ghost" size="sm" type="button" onclick={() => removeAt(i)}>删除</Button>
					</div>
				</div>
				<p class="text-muted-foreground text-xs">
					SQL 用 <code class="font-mono">{`{{${filterIdOf(node) || 'id'}.between}}`}</code>
					才吃到这个筛选。当前作用于：{queriesUsingFilter(nodes, filterIdOf(node)).join('、') || '无'}
				</p>
				{#each node.attrs as a (a.key)}
					<div class="flex gap-2">
						<span class="text-muted-foreground w-32 py-1 font-mono text-xs">{a.key}</span>
						<Input class="h-8 font-mono text-xs" bind:value={a.value} />
					</div>
				{/each}
			</div>
		{:else}
			<div class="{card} space-y-3">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<span class="text-xs font-medium">查询</span>
						<Input
							class="h-8 w-40 font-mono text-xs"
							value={node.name}
							oninput={(e) => renameQuery(node, e.currentTarget.value)}
						/>
					</div>
					<div class="flex gap-2">
						<Button variant="ghost" size="sm" type="button" onclick={() => move(i, -1)}>上移</Button>
						<Button variant="ghost" size="sm" type="button" onclick={() => move(i, 1)}>下移</Button>
						<Button variant="ghost" size="sm" type="button" onclick={() => removeAt(i)}>删除</Button>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-muted-foreground text-xs">使用筛选</span>
					<select
						class="{field} h-8 w-36 text-xs"
						value={filterIdsInSql(node.sql)[0] || ''}
						onchange={(e) => bindQueryFilter(node, e.currentTarget.value)}
					>
						<option value="">无</option>
						{#each filters() as f (filterIdOf(f))}
							<option value={filterIdOf(f)}>{filterIdOf(f) || f.tag}</option>
						{/each}
					</select>
					<span class="text-muted-foreground text-xs">{filterIdsInSql(node.sql).join('、') || 'SQL 里没有 {{id.between}}'}</span>
				</div>
				<textarea class="{area} min-h-40 font-mono text-xs" bind:value={node.sql}></textarea>
				<div class="space-y-2">
					<div class="text-muted-foreground text-xs">绑定到此查询的图/表（data 固定为查询名）</div>
					{#each node.viz as v, vi (vi)}
						<div class="bg-muted/50 space-y-2 rounded-lg p-3">
							<div class="flex items-center justify-between">
								<span class="text-xs font-medium">{v.tag}</span>
								<Button variant="ghost" size="sm" type="button" onclick={() => (node.viz = node.viz.filter((_, idx) => idx !== vi))}>移除</Button>
							</div>
							{#each v.attrs.filter((a) => a.key !== 'data') as a (a.key)}
								<div class="flex gap-2">
									<span class="text-muted-foreground w-20 py-1 font-mono text-xs">{a.key}</span>
									<Input class="h-8 font-mono text-xs" bind:value={a.value} />
								</div>
							{/each}
						</div>
					{/each}
					<div class="flex flex-wrap gap-2">
						{#each VIZ_PRESETS as p (p.tag)}
							<Button variant="outline" size="sm" type="button" onclick={() => addViz(node, p.tag, p.extra)}>
								+ {p.label}
							</Button>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	{/each}
</div>
