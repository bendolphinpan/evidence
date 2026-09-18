<script lang="ts">
	const PAGE_SIZES = [10, 25, 50, 100, 200];

	type Props = {
		pageSize: number;
		disabled?: boolean;
		onPageSizeChange: (size: number) => void;
	};

	let { pageSize, disabled, onPageSizeChange }: Props = $props();

	const sizeOptions = $derived.by(() => {
		if (PAGE_SIZES.includes(pageSize)) return PAGE_SIZES;
		return [...PAGE_SIZES, pageSize].sort((a, b) => a - b);
	});
</script>

<label class="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap">
	<span>Rows</span>
	<select
		class="border-border bg-background h-7 rounded-md border px-1.5 text-xs text-foreground"
		value={pageSize}
		{disabled}
		aria-label="Rows per page"
		onchange={(e) => {
			const n = Number(e.currentTarget.value);
			if (!Number.isFinite(n) || n < 1) return;
			onPageSizeChange(n);
		}}
	>
		{#each sizeOptions as n (n)}
			<option value={n}>{n}</option>
		{/each}
	</select>
</label>
