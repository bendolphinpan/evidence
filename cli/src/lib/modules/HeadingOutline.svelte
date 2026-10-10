<script lang="ts">
	import { browser } from '$app/environment';
	import { Button } from '@evidence/core/shadcn/components/ui/button';
	import { ChevronRight, PanelLeftClose } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let { pathname, onClose }: { pathname: string; onClose: () => void } = $props();

	interface Heading {
		id: string;
		text: string;
		level: number;
	}

	interface TocNode {
		heading: Heading;
		children: TocNode[];
	}

	const HEADING_SELECTOR =
		'h1[data-heading-id], h2[data-heading-id], h3[data-heading-id], h4[data-heading-id], h5[data-heading-id], h6[data-heading-id]';

	let headings = $state<Heading[]>([]);
	let collapsed = $state<Record<string, boolean>>({});
	let activeId = $state<string | null>(null);
	let ready = $state(false);
	let listEl = $state<HTMLDivElement | null>(null);

	const tree = $derived(buildTree(headings));

	function buildTree(items: Heading[]): TocNode[] {
		const roots: TocNode[] = [];
		const stack: TocNode[] = [];
		for (const heading of items) {
			const node: TocNode = { heading, children: [] };
			while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.level) {
				stack.pop();
			}
			if (stack.length === 0) roots.push(node);
			else stack[stack.length - 1].children.push(node);
			stack.push(node);
		}
		return roots;
	}

	function sameHeadings(a: Heading[], b: Heading[]) {
		if (a.length !== b.length) return false;
		return a.every((h, i) => h.id === b[i].id && h.text === b[i].text && h.level === b[i].level);
	}

	function extractHeadings(): Heading[] {
		const root = document.querySelector('.report-viewport [data-markdoc-content]');
		if (!root) return [];
		const used = new Set<string>();
		const next: Heading[] = [];
		for (const node of root.querySelectorAll(HEADING_SELECTOR)) {
			if (!(node instanceof HTMLElement)) continue;
			if (node.closest('[data-print-only]')) continue;
			const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
			if (!text) continue;
			const base = node.id || node.getAttribute('data-heading-id') || '';
			if (!base) continue;
			let id = base;
			let n = 2;
			while (used.has(id)) id = `${base}-${n++}`;
			used.add(id);
			if (node.id !== id) node.id = id;
			node.style.scrollMarginTop = '0.75rem';
			next.push({ id, text, level: Number(node.tagName.charAt(1)) });
		}
		return next;
	}

	function publishHeadings() {
		const next = extractHeadings();
		if (!sameHeadings(headings, next)) headings = next;
		if (activeId && !next.some((h) => h.id === activeId)) activeId = next[0]?.id ?? null;
		ready = true;
	}

	function updateActive() {
		const viewport = document.querySelector('.report-viewport');
		if (!(viewport instanceof HTMLElement) || headings.length === 0) return;
		const box = viewport.getBoundingClientRect();
		const line = box.top + 16;
		const overflows = viewport.scrollHeight > viewport.clientHeight + 2;
		const atBottom =
			overflows && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2;
		let current = headings[0].id;
		for (const heading of headings) {
			const el = document.getElementById(heading.id);
			if (!el) continue;
			const top = el.getBoundingClientRect().top;
			if (atBottom) {
				if (top < box.bottom) current = heading.id;
			} else if (top <= line) {
				current = heading.id;
			} else {
				break;
			}
		}
		if (current !== activeId) activeId = current;
	}

	let jumpTarget: string | null = null;

	function jump(id: string) {
		const el = document.getElementById(id);
		if (!el) return;
		jumpTarget = id;
		activeId = id;
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function toggleNode(id: string) {
		collapsed = { ...collapsed, [id]: !collapsed[id] };
	}

	function descendantActive(node: TocNode): boolean {
		return node.children.some(
			(child) => child.heading.id === activeId || descendantActive(child)
		);
	}

	$effect(() => {
		if (!browser) return;
		pathname;
		collapsed = {};
		activeId = null;
		jumpTarget = null;
		ready = false;
		const delays = [0, 50, 150, 400, 900];
		const timers = delays.map((delay) =>
			setTimeout(() => {
				publishHeadings();
				updateActive();
			}, delay)
		);
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
	});

	$effect(() => {
		const id = activeId;
		if (!browser || !id || !listEl) return;
		const target = listEl.querySelector(`[data-outline-id="${CSS.escape(id)}"]`);
		if (target instanceof HTMLElement) target.scrollIntoView({ block: 'nearest' });
	});

	onMount(() => {
		const viewport = document.querySelector('.report-viewport');
		let debounce: ReturnType<typeof setTimeout> | undefined;
		const observer = new MutationObserver(() => {
			if (debounce) clearTimeout(debounce);
			debounce = setTimeout(() => {
				publishHeadings();
				updateActive();
			}, 200);
		});
		if (viewport) {
			observer.observe(viewport, { childList: true, subtree: true, characterData: true });
		}

		let frame = 0;
		let scrollIdle: ReturnType<typeof setTimeout> | undefined;
		const onScroll = () => {
			if (jumpTarget) {
				const el = document.getElementById(jumpTarget);
				const box = viewport?.getBoundingClientRect();
				if (el && box && Math.abs(el.getBoundingClientRect().top - box.top) < 12) {
					jumpTarget = null;
				}
				if (scrollIdle) clearTimeout(scrollIdle);
				scrollIdle = setTimeout(() => {
					jumpTarget = null;
					updateActive();
				}, 140);
				return;
			}
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(updateActive);
		};
		const cancelJump = () => {
			jumpTarget = null;
		};

		viewport?.addEventListener('scroll', onScroll, { passive: true });
		viewport?.addEventListener('wheel', cancelJump, { passive: true });
		viewport?.addEventListener('touchstart', cancelJump, { passive: true });
		viewport?.addEventListener('pointerdown', cancelJump);
		publishHeadings();
		updateActive();

		return () => {
			if (debounce) clearTimeout(debounce);
			if (scrollIdle) clearTimeout(scrollIdle);
			cancelAnimationFrame(frame);
			observer.disconnect();
			viewport?.removeEventListener('scroll', onScroll);
			viewport?.removeEventListener('wheel', cancelJump);
			viewport?.removeEventListener('touchstart', cancelJump);
			viewport?.removeEventListener('pointerdown', cancelJump);
		};
	});
</script>

{#snippet nodes(items: TocNode[], depth: number)}
	{#each items as node (node.heading.id)}
		{@const open = !collapsed[node.heading.id]}
		{@const active = node.heading.id === activeId}
		{@const childActive = !active && !open && descendantActive(node)}
		<div class="flex min-w-0 items-start" style:padding-left="{depth * 10}px">
			<button
				type="button"
				class="text-muted-foreground mt-1 flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-foreground/5 {node
					.children.length
					? ''
					: 'invisible'}"
				tabindex={node.children.length ? 0 : -1}
				aria-hidden={node.children.length ? undefined : true}
				aria-expanded={node.children.length ? open : undefined}
				aria-label={open ? '折叠' : '展开'}
				onclick={(event) => {
					event.stopPropagation();
					if (node.children.length) toggleNode(node.heading.id);
				}}
			>
				<ChevronRight class="size-3 transition-transform {open ? 'rotate-90' : ''}" />
			</button>
			<button
				type="button"
				data-outline-id={node.heading.id}
				title={node.heading.text}
				class="min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-left text-[13px] leading-5 {active
					? 'bg-accent text-accent-foreground font-medium'
					: childActive
						? 'text-foreground'
						: 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'}"
				aria-current={active ? 'location' : undefined}
				onclick={() => jump(node.heading.id)}
			>
				{node.heading.text}
			</button>
		</div>
		{#if node.children.length > 0 && open}
			{@render nodes(node.children, depth + 1)}
		{/if}
	{/each}
{/snippet}

<nav
	aria-label="页面大纲"
	class="bg-background flex h-full w-60 shrink-0 flex-col border-r print:hidden"
>
	<div class="flex h-10 shrink-0 items-center justify-between px-2">
		<span class="text-muted-foreground px-1 text-xs font-medium">大纲</span>
		<Button variant="ghost" size="icon-sm" onclick={onClose} aria-label="收起大纲">
			<PanelLeftClose class="size-3.5" />
		</Button>
	</div>
	<div bind:this={listEl} class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
		{#if ready && tree.length === 0}
			<p class="text-muted-foreground px-2 py-2 text-xs leading-5">这一页没有标题</p>
		{:else}
			{@render nodes(tree, 0)}
		{/if}
	</div>
</nav>
