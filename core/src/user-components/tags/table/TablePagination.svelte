<script lang="ts">
	import { formatValue } from '../../formatValue';
	import {
		ChevronLeftIcon,
		ChevronRightIcon,
		ChevronsLeftIcon,
		ChevronsRightIcon
	} from 'lucide-svelte';
	import TablePaginationButton from './TablePaginationButton.svelte';

	type Props = {
		page?: number;
		pageSize?: number;
		totalRows?: number;
		loading?: boolean;
	};

	let { page = $bindable(0), pageSize = 10, totalRows, loading }: Props = $props();

	let clickedName: 'first' | 'previous' | 'next' | 'last' | undefined = $state();
	$effect(() => {
		if (!loading) {
			clickedName = undefined;
		}
	});

	const totalPages = $derived.by(() => {
		if (typeof totalRows === 'undefined') return undefined;
		return Math.max(1, Math.ceil(totalRows / pageSize));
	});

	const pageButtons = $derived.by((): (number | 'ellipsis')[] => {
		if (typeof totalPages === 'undefined' || totalPages <= 1) return [];
		const current = page + 1;
		const shown = new Set<number>([1, totalPages]);
		for (let i = current - 2; i <= current + 2; i++) {
			if (i >= 1 && i <= totalPages) shown.add(i);
		}
		const sorted = [...shown].sort((a, b) => a - b);
		const out: (number | 'ellipsis')[] = [];
		let prev = 0;
		for (const n of sorted) {
			if (prev && n > prev + 1) out.push('ellipsis');
			out.push(n);
			prev = n;
		}
		return out;
	});

	const canGoToFirstPage = $derived(page > 0);
	const canGoToPreviousPage = $derived(page > 0);
	const canGoToNextPage = $derived(!totalPages || page < totalPages - 1);
	const canGoToLastPage = $derived(typeof totalPages !== 'undefined' && page < totalPages - 1);

	function goToPage(displayPage: number) {
		const n = Math.trunc(displayPage);
		if (!Number.isFinite(n) || n < 1) return;
		if (typeof totalPages === 'undefined') {
			page = n - 1;
			return;
		}
		page = Math.min(n, totalPages) - 1;
	}

	const controlClass =
		'border-border bg-background h-6 w-12 rounded border px-1 text-center text-xs text-foreground';
</script>

<div class="flex items-center justify-between gap-2 pl-1">
	<div class="text-muted-foreground text-xs">
		{#if totalRows !== 0}
			{formatValue(page * pageSize + 1, 'num0')} - {formatValue(
				Math.min((page + 1) * pageSize, totalRows ?? Infinity),
				'num0'
			)}
			{#if typeof totalRows !== 'undefined'}
				of {formatValue(totalRows, 'num0')} rows
			{/if}
		{:else}
			No rows found
		{/if}
	</div>
	<div class="flex items-center">
		<TablePaginationButton
			label="First page"
			Icon={ChevronsLeftIcon}
			loading={clickedName === 'first' && loading}
			disabled={!canGoToFirstPage || loading}
			onclick={() => {
				clickedName = 'first';
				page = 0;
			}}
		/>

		<TablePaginationButton
			label="Previous page"
			Icon={ChevronLeftIcon}
			loading={clickedName === 'previous' && loading}
			disabled={!canGoToPreviousPage || loading}
			onclick={() => {
				clickedName = 'previous';
				page--;
			}}
		/>

		{#each pageButtons as item, i (typeof item === 'number' ? item : `e${i}`)}
			{#if item === 'ellipsis'}
				<span class="text-muted-foreground px-0.5 text-xs">…</span>
			{:else}
				<button
					type="button"
					class="h-6 min-w-6 rounded px-1 text-xs {item === page + 1
						? 'bg-muted text-foreground font-medium'
						: 'text-muted-foreground hover:bg-muted/60'}"
					disabled={loading}
					aria-label="Page {item}"
					aria-current={item === page + 1 ? 'page' : undefined}
					onclick={() => {
						clickedName = undefined;
						goToPage(item);
					}}
				>
					{formatValue(item, 'num0')}
				</button>
			{/if}
		{/each}

		<label class="text-muted-foreground flex items-center gap-1 px-1 text-xs whitespace-nowrap">
			<input
				class="{controlClass} w-12"
				type="number"
				min="1"
				max={totalPages ?? undefined}
				value={page + 1}
				disabled={loading}
				aria-label="Go to page"
				onkeydown={(e) => {
					if (e.key !== 'Enter') return;
					goToPage(Number(e.currentTarget.value));
				}}
				onchange={(e) => goToPage(Number(e.currentTarget.value))}
			/>
			{#if typeof totalPages !== 'undefined'}
				<span>/ {formatValue(totalPages, 'num0')}</span>
			{/if}
		</label>

		<TablePaginationButton
			label="Next page"
			Icon={ChevronRightIcon}
			loading={clickedName === 'next' && loading}
			disabled={!canGoToNextPage || loading}
			onclick={() => {
				clickedName = 'next';
				page++;
			}}
		/>

		<TablePaginationButton
			label="Last page"
			Icon={ChevronsRightIcon}
			loading={clickedName === 'last' && loading}
			disabled={!canGoToLastPage || loading}
			onclick={() => {
				if (typeof totalPages === 'undefined') return;
				clickedName = 'last';
				page = totalPages - 1;
			}}
		/>
	</div>
</div>
