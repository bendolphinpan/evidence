<script lang="ts">
	import { onMount } from 'svelte';
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

	async function reload() {
		const [u, s] = await Promise.all([
			fetch('/api/modules/admin/users'),
			fetch('/api/modules/admin/settings')
		]);
		if (u.ok) users = (await u.json()).users;
		if (s.ok) {
			const json = await s.json();
			teConfigured = json.te.configured;
			aiConfigured = json.ai.configured;
			te = { ...te, url: json.te.url, projectId: json.te.projectId, schema: json.te.schema };
			ai = { ...ai, provider: json.ai.provider, baseUrl: json.ai.baseUrl, model: json.ai.model };
		} else if (u.status === 403) {
			message = '需要管理员';
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
		<p class="text-muted-foreground mt-1 text-sm">用户与数数/AI 连接。Token 不回传浏览器。</p>
		{#if message}
			<p class="mt-3 text-sm">{message}</p>
		{/if}
	</div>

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
			<Card.Title class="text-base">线上元数据</Card.Title>
			<Card.Description>
				从数数 OpenAPI 拉取事件和列，写入 llm_wiki/sync/te_live_snapshot.json，供 AI wiki_lookup 使用。打点需求 Excel 口径不会被覆盖。
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
