<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '@evidence/core/shadcn/components/ui/button';
	import { Input } from '@evidence/core/shadcn/components/ui/input';
	import * as Card from '@evidence/core/shadcn/components/ui/card';

	let { data }: { data: { productAuth?: boolean } } = $props();
	let username = $state('');
	let password = $state('');
	let error = $state('');
	let pending = $state(false);

	async function submit(e: Event) {
		e.preventDefault();
		pending = true;
		error = '';
		const res = await fetch('/api/modules/auth/login', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password })
		});
		let json: { error?: string } = {};
		try {
			json = await res.json();
		} catch {
			pending = false;
			error = '登录接口无响应';
			return;
		}
		pending = false;
		if (!res.ok) {
			error = json.error || '登录失败';
			return;
		}
		window.location.assign(page.url.searchParams.get('next') || '/');
	}
</script>

<svelte:head>
	<title>登录</title>
</svelte:head>

<div class="bg-background flex min-h-screen items-center justify-center p-6">
	{#if data.productAuth}
		<Card.Root class="w-full max-w-sm">
			<Card.Header>
				<Card.Title>登录</Card.Title>
				<Card.Description>内网账号，由管理员开户</Card.Description>
			</Card.Header>
			<Card.Content>
				<form class="space-y-4" onsubmit={submit}>
					<div class="space-y-1.5">
						<label class="text-muted-foreground text-xs" for="user">用户名</label>
						<Input id="user" bind:value={username} autocomplete="username" required />
					</div>
					<div class="space-y-1.5">
						<label class="text-muted-foreground text-xs" for="pass">密码</label>
						<Input id="pass" type="password" bind:value={password} autocomplete="current-password" required />
					</div>
					{#if error}
						<p class="text-destructive text-sm">{error}</p>
					{/if}
					<Button class="w-full" type="submit" disabled={pending}>
						{pending ? '登录中…' : '登录'}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="w-full max-w-md space-y-6 text-center">
			<h1 class="text-foreground text-2xl font-bold">Session Expired</h1>
			<p class="text-muted-foreground">Restart the CLI to log in again.</p>
		</div>
	{/if}
</div>
