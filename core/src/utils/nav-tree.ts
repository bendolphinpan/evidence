/**
 * Normalized navigation tree shared by the Studio published viewer and the
 * CLI dev-server preview. Both surfaces map their own data shapes into a
 * `NavTree` and hand it to `PageNavTree.svelte`, which renders the shadcn
 * sidebar markup. This keeps the tree presentation in one place while letting
 * each caller build hrefs however it needs (branch-aware in Studio, plain
 * slugs in the CLI).
 */

import { deslugify } from './deslugify';

/**
 * Canonical sidebar ordering: pages with an explicit `sidebar_position` sort
 * first (ascending), ties and unpositioned pages fall back to name order. Shared
 * by the Studio published/preview viewers and the CLI dev server so the sidebar
 * orders identically everywhere a `sidebar_position` frontmatter value is read.
 */
export function compareSidebarPosition(
	aPos: number | null | undefined,
	bPos: number | null | undefined,
	aName: string,
	bName: string
): number {
	if (aPos !== null && aPos !== undefined && bPos !== null && bPos !== undefined) {
		return aPos === bPos ? aName.localeCompare(bName) : aPos - bPos;
	}
	if (aPos !== null && aPos !== undefined) return -1;
	if (bPos !== null && bPos !== undefined) return 1;
	return aName.localeCompare(bName);
}

export interface NavPage {
	name: string;
	href: string;
	icon?: string | null;
}

export interface NavDirectory {
	id: string;
	name: string;
	pages: NavPage[];
	directories: NavDirectory[];
}

export interface NavTree {
	rootPages: NavPage[];
	directories: NavDirectory[];
}

// --- Studio mapping ---------------------------------------------------------

interface SidebarProjectPage {
	name: string;
	slug: string | null;
	directoryId?: number;
	settings?: { icon?: string | null } | null;
}

interface SidebarDirectory {
	id: number | string;
	name: string;
	slug: string;
}

export interface SidebarProjectInput {
	rootPages: SidebarProjectPage[];
	secondLevelDirectories: SidebarDirectory[];
	secondLevelPages: SidebarProjectPage[];
}

/**
 * Map a Studio project (root pages + second-level directories/pages) into a
 * `NavTree`. `hrefFor` receives a project-relative slug path (e.g. `"orders"`
 * or `"sales/regional"`) and returns the full URL, so the caller owns
 * branch encoding and org/project prefixing.
 */
export function toNavTreeFromProject(
	project: SidebarProjectInput,
	hrefFor: (relSlug: string) => string
): NavTree {
	const rootPages: NavPage[] = project.rootPages
		.filter((p) => p.slug !== null)
		.map((p) => ({
			name: p.name,
			href: hrefFor(p.slug as string),
			icon: p.settings?.icon ?? null
		}));

	const directories: NavDirectory[] = project.secondLevelDirectories
		.map((dir) => ({
			id: String(dir.id),
			name: dir.name,
			pages: project.secondLevelPages
				.filter((p) => String(p.directoryId) === String(dir.id) && p.slug !== null)
				.map((p) => ({
					name: p.name,
					href: hrefFor(`${dir.slug}/${p.slug}`),
					icon: p.settings?.icon ?? null
				})),
			directories: []
		}))
		.filter((dir) => dir.pages.length > 0);

	return { rootPages, directories };
}

// --- CLI mapping ------------------------------------------------------------

export interface FlatNavItem {
	name: string;
	slug: string;
	isHome: boolean;
	/** Frontmatter `title`; overrides the deslugified filename when present. */
	title?: string;
	/** Frontmatter `icon`; rendered in the sidebar icon column. */
	icon?: string | null;
	/** Frontmatter `sidebar_position`; lower sorts first. */
	sidebar_position?: number | null;
	/** Frontmatter `group` / `folder` / `category`; groups into folders/subfolders. */
	group?: string | string[] | null;
}

/**
 * Extract directory segments for a navigation item.
 * Honors explicit frontmatter `group` / `folder` first (supports 'a/b' or ['a', 'b']),
 * then falls back to path segments in the file slug.
 */
export function getDirectorySegments(item: FlatNavItem): string[] {
	if (item.isHome) return [];

	if (item.group) {
		if (Array.isArray(item.group)) {
			const parts = item.group
				.flatMap((g) => (typeof g === 'string' ? g.split('/') : []))
				.map((s) => s.trim())
				.filter(Boolean);
			if (parts.length > 0) return parts;
		} else if (typeof item.group === 'string' && item.group.trim()) {
			const parts = item.group
				.split('/')
				.map((s) => s.trim())
				.filter(Boolean);
			if (parts.length > 0) return parts;
		}
	}

	const segments = item.slug.split('/');
	if (segments.length > 1) {
		return segments.slice(0, -1);
	}

	return [];
}

interface DirNode {
	id: string;
	name: string;
	pages: NavPage[];
	subdirs: Map<string, DirNode>;
	subdirOrder: string[];
}

/**
 * Build a `NavTree` from the CLI's flat list of discovered pages.
 * Supports arbitrary levels of nested subdirectories via filesystem path
 * or frontmatter `group`/`folder`. Items are emitted in the order given, so
 * the caller is responsible for sorting (e.g. by `sidebar_position`) first.
 */
export function buildNavTreeFromFlat(items: FlatNavItem[]): NavTree {
	const rootPages: NavPage[] = [];
	const rootDirOrder: string[] = [];
	const rootDirMap = new Map<string, DirNode>();
	// PageNavTree keys its `{#each}` on `href`, so duplicates crash hydration
	// with each_key_duplicate. Callers *should* dedupe upstream, but keep the
	// sidebar defensive so a malformed input degrades to a first-wins nav
	// instead of taking the client down.
	const seenHrefs = new Set<string>();

	for (const item of items) {
		const href = item.isHome
			? '/'
			: item.slug.startsWith('/')
				? item.slug
				: `/${item.slug}`;
		if (seenHrefs.has(href)) continue;
		seenHrefs.add(href);

		const displayName = item.title ?? (item.isHome ? 'Home' : deslugify(item.name));
		const dirSegments = getDirectorySegments(item);

		if (dirSegments.length === 0) {
			rootPages.push({ name: displayName, href, icon: item.icon ?? null });
			continue;
		}

		let currentMap = rootDirMap;
		let currentOrder = rootDirOrder;
		let currentPath = '';

		for (let i = 0; i < dirSegments.length; i++) {
			const seg = dirSegments[i];
			currentPath = currentPath ? `${currentPath}/${seg}` : seg;

			if (!currentMap.has(seg)) {
				const node: DirNode = {
					id: currentPath,
					name: deslugify(seg),
					pages: [],
					subdirs: new Map(),
					subdirOrder: []
				};
				currentMap.set(seg, node);
				currentOrder.push(seg);
			}

			const node = currentMap.get(seg)!;
			if (i === dirSegments.length - 1) {
				node.pages.push({ name: displayName, href, icon: item.icon ?? null });
			} else {
				currentMap = node.subdirs;
				currentOrder = node.subdirOrder;
			}
		}
	}

	function convertDirNode(node: DirNode): NavDirectory {
		return {
			id: node.id,
			name: node.name,
			pages: node.pages,
			directories: node.subdirOrder.map((key) => convertDirNode(node.subdirs.get(key)!))
		};
	}

	const directories: NavDirectory[] = rootDirOrder.map((key) =>
		convertDirNode(rootDirMap.get(key)!)
	);

	return { rootPages, directories };
}
