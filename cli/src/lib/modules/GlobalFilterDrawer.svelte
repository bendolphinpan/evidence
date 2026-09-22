<script lang="ts">
	import { Button } from '@evidence/core/shadcn/components/ui/button';
	import { Input } from '@evidence/core/shadcn/components/ui/input';
	import {
		isRecognizedDateRange,
		processDateRange
	} from '@evidence/core/user-components/common/date-options';
	import { onMount } from 'svelte';
	import { X } from 'lucide-svelte';

	type SavedFilter = { id: string; key: string; name: string; description: string; sql: string };
	type Unit = 'day' | 'week' | 'month';
	type Endpoint = { mode: 'absolute' | 'relative'; date: string; amount: number; unit: Unit };

	let {
		projectId,
		canEdit = false,
		onClose
	}: { projectId: string; canEdit?: boolean; onClose: () => void } = $props();

	const PRESETS: { key: string; label: string }[] = [
		{ key: 'yesterday', label: '昨日' },
		{ key: 'today', label: '今日' },
		{ key: 'previous week', label: '上周' },
		{ key: 'week to date', label: '本周' },
		{ key: 'previous month', label: '上月' },
		{ key: 'month to date', label: '本月' },
		{ key: 'last 7 days', label: '过去7天' },
		{ key: 'last 30 days', label: '过去30天' },
		{ key: 'last 3 months', label: '过去3个月' }
	];
	const UNITS: { unit: Unit; label: string }[] = [
		{ unit: 'day', label: '天' },
		{ unit: 'week', label: '周' },
		{ unit: 'month', label: '月' }
	];
	const DEFAULT_RANGE = 'last 7 days';

	let timeMode = $state<'preset' | 'custom'>('preset');
	let preset = $state(DEFAULT_RANGE);
	let startEp = $state<Endpoint>({ mode: 'relative', date: '', amount: 6, unit: 'day' });
	let endEp = $state<Endpoint>({ mode: 'relative', date: '', amount: 0, unit: 'day' });
	let applied = $state<string[]>([]);
	let savedOptions = $state<SavedFilter[]>([]);
	let draft = $state({ name: '', description: '', sql: '' });
	let message = $state('');
	let busy = $state(false);

	function freshKey(): string {
		return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
	}

	function tokenOf(ep: Endpoint): string {
		if (ep.mode === 'absolute') return ep.date;
		const amount = Math.max(0, Math.floor(Number(ep.amount) || 0));
		if (ep.unit === 'day' && amount === 0) return 'today';
		if (ep.unit === 'day' && amount === 1) return 'yesterday';
		const name = amount === 1 ? ep.unit : `${ep.unit}s`;
		return `${amount} ${name} ago`;
	}

	function endpointFromToken(raw: string): Endpoint | null {
		const t = raw.trim().toLowerCase();
		if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { mode: 'absolute', date: t, amount: 0, unit: 'day' };
		if (t === 'today') return { mode: 'relative', date: '', amount: 0, unit: 'day' };
		if (t === 'yesterday') return { mode: 'relative', date: '', amount: 1, unit: 'day' };
		const match = t.match(/^(\d{1,4}) (day|week|month)s? ago$/);
		if (!match) return null;
		return { mode: 'relative', date: '', amount: Number(match[1]), unit: match[2] as Unit };
	}

	function currentRange(): string {
		if (timeMode === 'preset') return preset;
		return `${tokenOf(startEp)} to ${tokenOf(endEp)}`;
	}

	const preview = $derived.by(() => {
		const range = currentRange();
		if (!isRecognizedDateRange(range)) return '';
		const processed = processDateRange(range);
		if (!processed.startDate || !processed.endDate) return '';
		return `${processed.startDate} ~ ${processed.endDate}`;
	});

	function parseCurrent() {
		const params = new URLSearchParams(window.location.search);
		const dates = (params.get('dates') || '').trim();
		const presetHit = PRESETS.find((item) => item.key === dates.toLowerCase());
		const closed = dates.match(/^(.+?)\s+to\s+(.+)$/i);
		if (presetHit) {
			timeMode = 'preset';
			preset = presetHit.key;
		} else if (closed) {
			const start = endpointFromToken(closed[1]);
			const end = endpointFromToken(closed[2]);
			if (start && end) {
				timeMode = 'custom';
				startEp = start;
				endEp = end;
			}
		}
		applied = (params.get('saved') || '')
			.split(',')
			.map((key) => key.trim())
			.filter(Boolean);
	}

	async function loadFilters() {
		const res = await fetch(
			`/api/modules/admin/saved-filters?projectId=${encodeURIComponent(projectId)}`
		);
		if (!res.ok) return;
		savedOptions = (await res.json()).filters || [];
	}

	onMount(() => {
		parseCurrent();
		loadFilters().catch(() => {});
	});

	function apply() {
		message = '';
		if (timeMode === 'custom') {
			if (startEp.mode === 'absolute' && !startEp.date) {
				message = '开始日期还没选';
				return;
			}
			if (endEp.mode === 'absolute' && !endEp.date) {
				message = '结束日期还没选';
				return;
			}
			if (startEp.mode === 'relative' && Number(startEp.amount) < 0) {
				message = '相对时间只支持过去和当下';
				return;
			}
			if (endEp.mode === 'relative' && Number(endEp.amount) < 0) {
				message = '相对时间只支持过去和当下';
				return;
			}
		}
		const range = currentRange();
		if (!isRecognizedDateRange(range)) {
			message = '这个时间范围无法解析';
			return;
		}
		const processed = processDateRange(range);
		if (!processed.startDate || !processed.endDate || processed.startDate > processed.endDate) {
			message = '开始不能晚于结束';
			return;
		}
		const known = new Set(savedOptions.map((filter) => filter.key));
		const missing = applied.filter((key) => !known.has(key));
		if (missing.length) {
			message = `收藏不存在：${missing.join(', ')}`;
			return;
		}
		const url = new URL(window.location.href);
		url.searchParams.set('dates', range);
		if (applied.length) url.searchParams.set('saved', applied.join(','));
		else url.searchParams.delete('saved');
		const next = url.pathname + url.search;
		const cur = window.location.pathname + window.location.search;
		if (next === cur) {
			onClose();
			return;
		}
		window.location.assign(next);
	}

	async function addFilter() {
		message = '';
		if (!draft.name.trim() || !draft.sql.trim()) {
			message = '收藏需要名字和 SQL 条件';
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/modules/admin/saved-filters', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId,
					key: freshKey(),
					name: draft.name,
					description: draft.description,
					sql: draft.sql
				})
			});
			const json = await res.json();
			if (!res.ok) {
				message = json.error || '收藏失败';
				return;
			}
			draft = { name: '', description: '', sql: '' };
			await loadFilters();
			if (json.filter?.key) applied = [...applied, json.filter.key];
		} finally {
			busy = false;
		}
	}

	async function removeFilter(filter: SavedFilter) {
		message = '';
		busy = true;
		try {
			const res = await fetch('/api/modules/admin/saved-filters', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: filter.id })
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				message = json.error || '取消收藏失败';
				return;
			}
			applied = applied.filter((key) => key !== filter.key);
			savedOptions = savedOptions.filter((item) => item.id !== filter.id);
		} finally {
			busy = false;
		}
	}

	function toggleApplied(key: string) {
		applied = applied.includes(key) ? applied.filter((item) => item !== key) : [...applied, key];
	}
</script>

{#snippet endpointEditor(label: string, ep: Endpoint)}
	<div class="space-y-2">
		<div class="flex items-center justify-between gap-2">
			<span class="text-xs font-medium">{label}</span>
			<div class="flex gap-1">
				<Button
					type="button"
					variant={ep.mode === 'relative' ? 'default' : 'outline'}
					size="sm"
					onclick={() => (ep.mode = 'relative')}>动态时间</Button
				>
				<Button
					type="button"
					variant={ep.mode === 'absolute' ? 'default' : 'outline'}
					size="sm"
					onclick={() => (ep.mode = 'absolute')}>静态时间</Button
				>
			</div>
		</div>
		{#if ep.mode === 'relative'}
			<div class="flex items-center gap-2">
				<Input type="number" min="0" max="9999" bind:value={ep.amount} class="h-9 w-20" />
				<select
					class="border-input bg-background h-9 rounded-md border px-2 text-sm"
					bind:value={ep.unit}
				>
					{#each UNITS as unit (unit.unit)}
						<option value={unit.unit}>{unit.label}</option>
					{/each}
				</select>
				<span class="text-muted-foreground text-xs">前（0 = 今天）</span>
			</div>
		{:else}
			<Input type="date" bind:value={ep.date} class="h-9" />
		{/if}
	</div>
{/snippet}

<aside class="bg-background flex h-full w-[min(100%,28rem)] shrink-0 flex-col border-l">
	<div class="flex h-12 items-center justify-between border-b px-3">
		<div>
			<div class="text-sm font-medium">筛选</div>
			<div class="text-muted-foreground text-[11px]">全局 · project {projectId}</div>
		</div>
		<Button variant="ghost" size="icon-sm" onclick={onClose} aria-label="关闭筛选">
			<X class="size-4" />
		</Button>
	</div>
	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
		<section class="space-y-2">
			<div class="text-xs font-medium">时间</div>
			<div class="flex gap-1">
				<Button
					type="button"
					variant={timeMode === 'preset' ? 'default' : 'outline'}
					size="sm"
					onclick={() => (timeMode = 'preset')}>快捷</Button
				>
				<Button
					type="button"
					variant={timeMode === 'custom' ? 'default' : 'outline'}
					size="sm"
					onclick={() => (timeMode = 'custom')}>自定义起止</Button
				>
			</div>
			{#if timeMode === 'preset'}
				<div class="grid grid-cols-3 gap-1">
					{#each PRESETS as item (item.key)}
						<Button
							type="button"
							variant={preset === item.key ? 'default' : 'outline'}
							size="sm"
							onclick={() => (preset = item.key)}>{item.label}</Button
						>
					{/each}
				</div>
			{:else}
				<p class="text-muted-foreground text-xs">开始和结束各自选动态（相对今天）或静态（指定日期）。</p>
				{@render endpointEditor('开始', startEp)}
				{@render endpointEditor('结束', endEp)}
			{/if}
			{#if preview}
				<p class="text-muted-foreground text-xs">解析为 {preview}</p>
			{/if}
		</section>

		<section class="space-y-2">
			<div class="text-xs font-medium">筛选条目</div>
			<p class="text-muted-foreground text-xs">勾选后点应用，多条之间是 AND。收藏后可在其他页复用。</p>
			{#if savedOptions.length === 0}
				<p class="text-muted-foreground text-xs">还没有收藏。</p>
			{/if}
			{#each savedOptions as filter (filter.id)}
				<div class="rounded-md border p-2">
					<label class="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							class="mt-1"
							checked={applied.includes(filter.key)}
							onchange={() => toggleApplied(filter.key)}
						/>
						<span class="min-w-0 flex-1">
							<span class="font-medium">{filter.name}</span>
							{#if filter.description}
								<span class="text-muted-foreground mt-0.5 block text-xs">{filter.description}</span>
							{/if}
							<span class="text-muted-foreground mt-0.5 block font-mono text-[11px] break-all"
								>{filter.sql}</span
							>
						</span>
					</label>
					{#if canEdit}
						<div class="mt-1 flex justify-end">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy}
								onclick={() => removeFilter(filter)}>取消收藏</Button
							>
						</div>
					{/if}
				</div>
			{/each}
			{#if canEdit}
				<div class="space-y-2 border-t pt-2">
					<div class="text-xs font-medium">添加筛选条目</div>
					<Input placeholder="名字" bind:value={draft.name} />
					<Input placeholder="描述（选填）" bind:value={draft.description} />
					<Input
						placeholder="SQL 条件，事件列写 e.，如 coalesce(e.is_test, false) = false"
						bind:value={draft.sql}
					/>
					<Button type="button" size="sm" disabled={busy} onclick={addFilter}>收藏</Button>
				</div>
			{:else}
				<p class="text-muted-foreground text-xs">当前账号只能套用已有收藏，不能新增或取消。</p>
			{/if}
		</section>
		{#if message}
			<p class="text-destructive text-xs">{message}</p>
		{/if}
	</div>
	<div class="flex justify-end gap-2 border-t p-3">
		<Button type="button" variant="ghost" size="sm" onclick={onClose}>取消</Button>
		<Button type="button" size="sm" onclick={apply}>应用</Button>
	</div>
</aside>
