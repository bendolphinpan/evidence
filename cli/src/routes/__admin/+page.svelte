<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { createReportPage, slugFromTitle } from '$lib/modules/new-page';
	import { Button } from '@evidence/core/shadcn/components/ui/button';
	import { Input } from '@evidence/core/shadcn/components/ui/input';
	import * as Card from '@evidence/core/shadcn/components/ui/card';

	let message = $state('');
	let users = $state<{ username: string; role: string }[]>([]);
	let userForm = $state({ username: '', password: '', role: 'editor' });
	let te = $state({ url: '', token: '', projectId: '51', schema: 'ta' });
	let ai = $state({ provider: 'azure', baseUrl: '', apiKey: '', model: '' });
	let teConfigured = $state(false);
	let aiConfigured = $state(false);
	let syncing = $state(false);
	type SavedFilter = {
		id: string;
		key: string;
		projectId: string;
		name: string;
		description: string;
		sql: string;
		updatedAt: string;
	};
	let savedFilters = $state<SavedFilter[]>([]);
	let filterForm = $state({ id: '', key: '', name: '', description: '', sql: '' });
	let pageForm = $state({ title: '' });
	let creatingPage = $state(false);
	let audit = $state<{ at: string; username: string; action: string; slug: string; detail: string }[]>([]);
	const navItems = $derived(
		(page.data.navItems ?? []) as { slug: string; title?: string; isHome?: boolean }[]
	);

	async function reload() {
		const [u, s, a] = await Promise.all([
			fetch('/api/modules/admin/users'),
			fetch('/api/modules/admin/settings'),
			fetch('/api/modules/admin/audit')
		]);
		if (a.ok) audit = (await a.json()).audit || [];
		if (u.ok) users = (await u.json()).users;
		if (s.ok) {
			const json = await s.json();
			teConfigured = json.te.configured;
			aiConfigured = json.ai.configured;
			te = { ...te, url: json.te.url, projectId: json.te.projectId, schema: json.te.schema };
			ai = { ...ai, provider: json.ai.provider, baseUrl: json.ai.baseUrl, model: json.ai.model };
			reloadFilters(json.te.projectId || te.projectId || '51');
		} else if (u.status === 403) {
			message = '需要管理员';
		}
	}

	async function reloadFilters(projectId: string) {
		const res = await fetch(
			`/api/modules/admin/saved-filters?projectId=${encodeURIComponent(projectId)}`
		);
		if (res.ok) savedFilters = (await res.json()).filters || [];
	}

	async function saveFilter(e: Event) {
		e.preventDefault();
		const editing = filterForm.id !== '';
		const res = await fetch('/api/modules/admin/saved-filters', {
			method: editing ? 'PUT' : 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...filterForm, projectId: te.projectId || '51' })
		});
		const json = await res.json();
		message = res.ok ? (editing ? '收藏已更新' : `收藏已保存：${json.filter?.name}`) : json.error || '保存失败';
		if (res.ok) {
			filterForm = { id: '', key: '', name: '', description: '', sql: '' };
			reloadFilters(te.projectId || '51');
		}
	}

	async function removeFilter(id: string) {
		const res = await fetch('/api/modules/admin/saved-filters', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		const json = await res.json();
		message = res.ok ? '收藏已删除' : json.error || '删除失败';
		if (res.ok) reloadFilters(te.projectId || '51');
	}

	async function createPage(e: Event) {
		e.preventDefault();
		creatingPage = true;
		message = '';
		try {
			const result = await createReportPage({
				slug: slugFromTitle(pageForm.title),
				title: pageForm.title,
				projectId: te.projectId || '51',
				schema: te.schema
			});
			if ('error' in result) {
				message = result.error;
				return;
			}
			pageForm = { title: '' };
			await invalidateAll();
			await goto(result.href);
		} finally {
			creatingPage = false;
		}
	}

	async function copyFilterText(sql: string) {
		try {
			await navigator.clipboard.writeText(sql);
			message = 'SQL 条件已复制，粘贴到页内 dropdown 分支或让 AI 应用';
		} catch {
			message = '复制失败，请手动选中复制';
		}
	}

	onMount(() => {
		reload();
	});

	async function addUser(e: Event) {
		e.preventDefault();
		const res = await fetch('/api/modules/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(userForm)
		});
		const json = await res.json();
		message = json.error || `已创建 ${json.user?.username}`;
		if (res.ok) {
			userForm = { username: '', password: '', role: 'editor' };
			reload();
		}
	}

	async function save(e: Event) {
		e.preventDefault();
		const res = await fetch('/api/modules/admin/settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ te, ai })
		});
		message = res.ok ? '已保存连接' : '保存失败';
	}

	const selectClass =
		'border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
</script>

<svelte:head>
	<title>管理</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6 p-6">
	<div>
		<h1 class="text-xl font-semibold tracking-tight">管理</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			用户、页面、数数/AI 连接。Token 不回传浏览器。
			<a class="underline" href="/">返回报告</a>
		</p>
		{#if message}
			<p class="mt-3 text-sm">{message}</p>
		{/if}
	</div>

	<Card.Root class="py-4">
		<Card.Header class="px-6">
			<Card.Title class="text-base">审计</Card.Title>
			<Card.Description>最近的建页和 AI 改页。</Card.Description>
		</Card.Header>
		<Card.Content class="px-6">
			{#if audit.length === 0}
				<p class="text-muted-foreground text-xs">还没有记录。</p>
			{/if}
			<ul class="space-y-1 text-xs">
				{#each audit as row (`${row.at}-${row.slug}-${row.action}`)}
					<li>
						<span class="font-mono">{row.at.slice(0, 19)}</span>
						{row.username} {row.action} {row.slug}
						<span class="text-muted-foreground">{row.detail}</span>
					</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>

	<Card.Root class="py-4">
		<Card.Header class="px-6">
			<Card.Title class="text-base">页面</Card.Title>
			<Card.Description>新建后进入该页。侧栏会在保存后出现这一项。</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3 px-6">
			<form class="flex flex-wrap gap-2" onsubmit={createPage}>
				<Input class="w-48" placeholder="标题，例如 次日留存" bind:value={pageForm.title} required />
				<Button type="submit" size="sm" disabled={creatingPage}>
					{creatingPage ? '创建中…' : '新建页面'}
				</Button>
			</form>
			<ul class="space-y-1 text-sm">
				{#each navItems as item (item.slug)}
					<li>
						<a class="underline" href={item.isHome || item.slug === 'index' ? '/' : `/${item.slug}`}
							>{item.title || item.slug}</a
						>
						<span class="text-muted-foreground font-mono text-xs"> /{item.slug}</span>
					</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>

	<Card.Root class="py-4">
		<Card.Header class="px-6">
			<Card.Title class="text-base">用户</Card.Title>
		</Card.Header>
		<Card.Content class="px-6">
			<form class="flex flex-wrap gap-2" onsubmit={addUser}>
				<Input class="w-32" placeholder="用户名" bind:value={userForm.username} required />
				<Input class="w-32" type="password" placeholder="密码" bind:value={userForm.password} required />
				<select class={selectClass} bind:value={userForm.role}>
					<option value="admin">admin</option>
					<option value="editor">editor</option>
					<option value="viewer">viewer</option>
				</select>
				<Button type="submit" size="sm">开户</Button>
			</form>
			<table class="mt-4 w-full text-left text-sm">
				<thead>
					<tr class="text-muted-foreground border-b">
						<th class="py-2 font-medium">用户</th>
						<th class="font-medium">角色</th>
					</tr>
				</thead>
				<tbody>
					{#each users as u (u.username)}
						<tr class="border-b">
							<td class="py-2">{u.username}</td>
							<td>{u.role}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</Card.Content>
	</Card.Root>

	<form class="space-y-6" onsubmit={save}>
		<Card.Root class="py-4">
			<Card.Header class="px-6">
				<Card.Title class="text-base">数数 OpenAPI</Card.Title>
				<Card.Description>{teConfigured ? '已配置 Token' : '未配置 Token'}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 px-6">
				<label class="text-muted-foreground text-xs">根地址</label>
				<Input bind:value={te.url} />
				<label class="text-muted-foreground text-xs">Token（留空不改）</label>
				<Input type="password" bind:value={te.token} autocomplete="off" />
				<div class="flex gap-3">
					<div class="flex-1 space-y-1">
						<label class="text-muted-foreground text-xs">项目 ID</label>
						<Input bind:value={te.projectId} />
					</div>
					<div class="flex-1 space-y-1">
						<label class="text-muted-foreground text-xs">schema</label>
						<Input bind:value={te.schema} />
					</div>
				</div>
			</Card.Content>
		</Card.Root>
		<Card.Root class="py-4">
			<Card.Header class="px-6">
				<Card.Title class="text-base">服务端 AI</Card.Title>
				<Card.Description>{aiConfigured ? '已配置 Key' : '未配置 Key'}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 px-6">
				<label class="text-muted-foreground text-xs">Provider</label>
				<Input bind:value={ai.provider} />
				<label class="text-muted-foreground text-xs">Base URL</label>
				<Input bind:value={ai.baseUrl} />
				<label class="text-muted-foreground text-xs">Key（留空不改）</label>
				<Input type="password" bind:value={ai.apiKey} autocomplete="off" />
				<label class="text-muted-foreground text-xs">模型</label>
				<Input bind:value={ai.model} />
			</Card.Content>
		</Card.Root>
		<Button type="submit">保存连接</Button>
	</form>

	<Card.Root class="py-4">
		<Card.Header class="px-6">
			<Card.Title class="text-base">收藏筛选（项目 {te.projectId || '51'}）</Card.Title>
			<Card.Description>
				命名 + 描述 + 布尔 SQL 条件，跨页复用。页内用 `saved` dropdown 引用，AI 可用 search_saved_filters 查找并应用到页。
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3 px-6">
			{#if savedFilters.length === 0}
				<p class="text-muted-foreground text-xs">暂无收藏，先在下面新增一条。</p>
			{/if}
			{#each savedFilters as f (f.id)}
				<div class="rounded-md border p-3">
					<div class="flex items-center justify-between gap-2">
						<div class="text-sm font-medium">{f.name} <span class="text-muted-foreground font-mono text-xs">{f.key}</span></div>
						<div class="flex gap-1">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onclick={() => copyFilterText(f.sql)}>复制 SQL</Button
							>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onclick={() =>
									(filterForm = { id: f.id, key: f.key || '', name: f.name, description: f.description, sql: f.sql })}
								>编辑</Button
							>
							<Button type="button" variant="ghost" size="sm" onclick={() => removeFilter(f.id)}
								>删除</Button
							>
						</div>
					</div>
					{#if f.description}
						<p class="text-muted-foreground mt-1 text-xs">{f.description}</p>
					{/if}
					<code class="mt-2 block rounded bg-muted px-2 py-1 font-mono text-xs break-all">{f.sql}</code>
				</div>
			{/each}
			<form class="space-y-2 border-t pt-3" onsubmit={saveFilter}>
				<div class="text-xs font-medium">{filterForm.id ? '编辑收藏' : '新增收藏'}</div>
				<Input placeholder="key，如 notest（小写字母开头，页内分支用，不可改名规则外都可改）" bind:value={filterForm.key} required />
				<Input placeholder="名字，如 排除测试流量" bind:value={filterForm.name} required />
				<Input placeholder="描述（选填）：用途、适用页" bind:value={filterForm.description} />
				<Input
					placeholder="SQL 条件，如 coalesce(is_test, false) = false"
					bind:value={filterForm.sql}
					required
				/>
				<div class="flex gap-2">
					<Button type="submit" size="sm">{filterForm.id ? '更新' : '保存收藏'}</Button>
					{#if filterForm.id}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => (filterForm = { id: '', key: '', name: '', description: '', sql: '' })}
							>取消</Button
						>
					{/if}
				</div>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root class="py-4">
		<Card.Header class="px-6">
			<Card.Title class="text-base">线上元数据</Card.Title>
			<Card.Description>
				从数数 OpenAPI 拉取事件和列，写入当前项目的 wiki/sync（并兼容同步到 llm_wiki/sync），供 AI wiki_lookup 使用。打点需求 Excel 口径不会被覆盖。
			</Card.Description>
		</Card.Header>
		<Card.Content class="px-6">
			<Button
				type="button"
				variant="outline"
				disabled={syncing}
				onclick={async () => {
					syncing = true;
					message = '';
					const res = await fetch('/api/modules/admin/sync-catalog', { method: 'POST' });
					const json = await res.json();
					syncing = false;
					if (!res.ok) message = json.error || '同步失败';
					else
						message = `已同步：事件 ${json.eventCount}，事件列 ${json.eventPropCount}，用户列 ${json.userPropCount}${json.hasInitCountry ? '，含 init_country' : '，快照中无 init_country'}`;
				}}
			>
				{syncing ? '拉取中…' : '拉取数数最新表结构'}
			</Button>
		</Card.Content>
	</Card.Root>
</div>
