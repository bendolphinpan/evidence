<script lang="ts">
	import * as Sidebar from '../shadcn/components/ui/sidebar';
	import { ChevronRight } from 'lucide-svelte';
	import Ellipsis from './Ellipsis.svelte';
	import { loadLucideIcon } from '../user-components/common/dynamic-icon';
	import { type NavTree, type NavDirectory, type NavPage } from '../utils/nav-tree';

	let {
		tree,
		currentPath,
		query = ''
	}: { tree: NavTree; currentPath: string; query?: string } = $props();

	function hrefOf(href: string): string {
		if (!query) return href;
		const base = href.split('?')[0];
		return `${base}?${query}`;
	}

	// Per-directory collapse state. Default: expanded when it contains the
	// active page, collapsed otherwise. Once the user toggles a directory we
	// honour their explicit choice (mirrors the published viewer).
	let collapsedDirectories = $state<Record<string, boolean>>({});

	function isPathActive(href: string): boolean {
		const normHref = href.split('?')[0].replace(/\/$/, '') || '/';
		const normCurrent = currentPath.split('?')[0].replace(/\/$/, '') || '/';
		return normHref === normCurrent;
	}

	function dirHasActivePage(dir: NavDirectory): boolean {
		if (dir.pages.some((p) => isPathActive(p.href))) return true;
		if (dir.directories && dir.directories.length > 0) {
			return dir.directories.some((sub) => dirHasActivePage(sub));
		}
		return false;
	}

	function isDirectoryCollapsed(dir: NavDirectory): boolean {
		if (collapsedDirectories[dir.id] === undefined) {
			return !dirHasActivePage(dir);
		}
		return collapsedDirectories[dir.id];
	}

	function toggleDirectory(dir: NavDirectory) {
		collapsedDirectories = {
			...collapsedDirectories,
			[dir.id]: !isDirectoryCollapsed(dir)
		};
	}
</script>

{#snippet pageIcon(navPage: NavPage, isActive: boolean)}
	{@const tone = isActive ? 'text-primary' : 'text-muted-foreground/80'}
	{#if navPage.icon}
		{@const IconComponent = loadLucideIcon(navPage.icon)}
		{#if IconComponent}
			<IconComponent class="h-4 w-4 {tone}" />
		{/if}
	{/if}
{/snippet}

{#snippet renderDirectory(dir: NavDirectory, depth: number = 0)}
	{@const collapsed = isDirectoryCollapsed(dir)}
	<Sidebar.MenuItem class={depth > 0 ? 'list-none' : ''}>
		<Sidebar.MenuButton>
			{#snippet child({ props })}
				<button type="button" {...props} onclick={() => toggleDirectory(dir)}>
					<ChevronRight
						class="h-3.5 w-3.5 shrink-0 transition-transform {!collapsed ? 'rotate-90' : ''}"
					/>
					<Ellipsis class="w-full cursor-pointer">
						{dir.name}
					</Ellipsis>
				</button>
			{/snippet}
		</Sidebar.MenuButton>

		{#if !collapsed}
			<div class="my-1 border-l pl-2">
				{#each dir.pages as navPage (navPage.href)}
					{@const isActive = isPathActive(navPage.href)}
					<Sidebar.MenuButton {isActive}>
						{#snippet child({ props })}
							<a href={hrefOf(navPage.href)} {...props}>
								{@render pageIcon(navPage, isActive)}
								<Ellipsis class="w-full cursor-pointer">
									{navPage.name}
								</Ellipsis>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				{/each}

				{#if dir.directories && dir.directories.length > 0}
					{#each dir.directories as subDir (subDir.id)}
						{@render renderDirectory(subDir, depth + 1)}
					{/each}
				{/if}
			</div>
		{/if}
	</Sidebar.MenuItem>
{/snippet}

<Sidebar.Menu>
	<!-- Root pages -->
	{#each tree.rootPages as navPage (navPage.href)}
		{@const isActive = isPathActive(navPage.href)}
		<Sidebar.MenuItem>
			<Sidebar.MenuButton {isActive}>
				{#snippet child({ props })}
					<a href={hrefOf(navPage.href)} {...props}>
						{@render pageIcon(navPage, isActive)}
						<Ellipsis class="w-full cursor-pointer">
							{navPage.name}
						</Ellipsis>
					</a>
				{/snippet}
			</Sidebar.MenuButton>
		</Sidebar.MenuItem>
	{/each}

	<!-- Directories and their pages -->
	{#each tree.directories as dir (dir.id)}
		{@render renderDirectory(dir, 0)}
	{/each}
</Sidebar.Menu>
