import { describe, it, expect } from 'vitest';
import { compareSidebarPosition, buildNavTreeFromFlat, type FlatNavItem } from './nav-tree';

describe('compareSidebarPosition', () => {
	it('orders by position ascending when both are set', () => {
		expect(compareSidebarPosition(1, 2, 'b', 'a')).toBeLessThan(0);
		expect(compareSidebarPosition(5, 2, 'a', 'b')).toBeGreaterThan(0);
	});

	it('breaks position ties by name', () => {
		expect(compareSidebarPosition(1, 1, 'alpha', 'beta')).toBeLessThan(0);
		expect(compareSidebarPosition(1, 1, 'beta', 'alpha')).toBeGreaterThan(0);
	});

	it('sorts a positioned page before an unpositioned one', () => {
		expect(compareSidebarPosition(3, null, 'z', 'a')).toBeLessThan(0);
		expect(compareSidebarPosition(undefined, 3, 'a', 'z')).toBeGreaterThan(0);
	});

	it('falls back to name when neither is set', () => {
		expect(compareSidebarPosition(null, undefined, 'apple', 'banana')).toBeLessThan(0);
		expect(compareSidebarPosition(undefined, null, 'banana', 'apple')).toBeGreaterThan(0);
	});
});

describe('buildNavTreeFromFlat', () => {
	it('prefers frontmatter title over the deslugified filename and carries icons', () => {
		const items: FlatNavItem[] = [
			{ name: 'home', slug: 'home', isHome: true, title: 'Welcome' },
			{ name: 'my_orders', slug: 'my_orders', isHome: false, icon: 'box' },
			{ name: 'revenue', slug: 'revenue', isHome: false, title: 'Top Line' }
		];

		const tree = buildNavTreeFromFlat(items);

		expect(tree.rootPages).toEqual([
			{ name: 'Welcome', href: '/', icon: null },
			{ name: 'My Orders', href: '/my_orders', icon: 'box' },
			{ name: 'Top Line', href: '/revenue', icon: null }
		]);
		expect(tree.directories).toEqual([]);
	});

	it('dedupes duplicate hrefs so PageNavTree keys never collide', () => {
		// Belt-and-suspenders: if a caller ever produces two items that resolve
		// to the same href, keep the first and drop the rest instead of letting
		// PageNavTree crash with each_key_duplicate.
		const items: FlatNavItem[] = [
			{ name: 'home', slug: 'home', isHome: true, title: 'Home' },
			{ name: 'index', slug: 'index', isHome: true, title: 'Index' },
			{ name: 'orders', slug: 'orders', isHome: false },
			{ name: 'orders', slug: 'orders', isHome: false }
		];

		const tree = buildNavTreeFromFlat(items);

		expect(tree.rootPages.map((p) => p.href)).toEqual(['/', '/orders']);
	});

	it('preserves input order within root pages and directories', () => {
		const items: FlatNavItem[] = [
			{ name: 'b', slug: 'b', isHome: false },
			{ name: 'a', slug: 'a', isHome: false },
			{ name: 'second', slug: 'sales/second', isHome: false },
			{ name: 'first', slug: 'sales/first', isHome: false }
		];

		const tree = buildNavTreeFromFlat(items);

		expect(tree.rootPages.map((p) => p.href)).toEqual(['/b', '/a']);
		expect(tree.directories).toHaveLength(1);
		expect(tree.directories[0].name).toBe('Sales');
		expect(tree.directories[0].pages.map((p) => p.href)).toEqual(['/sales/second', '/sales/first']);
		expect(tree.directories[0].directories).toEqual([]);
	});

	it('supports multi-level nested subdirectories from file paths', () => {
		const items: FlatNavItem[] = [
			{ name: 'overview', slug: 'retention/overview', isHome: false, title: '留存概览' },
			{ name: 'level', slug: 'retention/diagnosis/level', isHome: false, title: '关卡流失' },
			{ name: 'step', slug: 'retention/diagnosis/step', isHome: false, title: '步骤流失' },
			{ name: 'deep', slug: 'retention/diagnosis/sub/deep', isHome: false, title: '深度下钻' },
			{ name: 'dau', slug: 'marketing/dau', isHome: false, title: '活跃指标' }
		];

		const tree = buildNavTreeFromFlat(items);

		expect(tree.rootPages).toEqual([]);
		expect(tree.directories).toHaveLength(2);

		const retention = tree.directories[0];
		expect(retention.id).toBe('retention');
		expect(retention.name).toBe('Retention');
		expect(retention.pages.map((p) => p.name)).toEqual(['留存概览']);
		expect(retention.directories).toHaveLength(1);

		const diagnosis = retention.directories[0];
		expect(diagnosis.id).toBe('retention/diagnosis');
		expect(diagnosis.name).toBe('Diagnosis');
		expect(diagnosis.pages.map((p) => p.name)).toEqual(['关卡流失', '步骤流失']);
		expect(diagnosis.directories).toHaveLength(1);

		const sub = diagnosis.directories[0];
		expect(sub.id).toBe('retention/diagnosis/sub');
		expect(sub.name).toBe('Sub');
		expect(sub.pages.map((p) => p.name)).toEqual(['深度下钻']);
		expect(sub.directories).toEqual([]);

		const marketing = tree.directories[1];
		expect(marketing.id).toBe('marketing');
		expect(marketing.pages.map((p) => p.name)).toEqual(['活跃指标']);
		expect(marketing.directories).toEqual([]);
	});

	it('supports group frontmatter as slash-separated string or array', () => {
		const items: FlatNavItem[] = [
			{ name: 'page1', slug: 'page1', isHome: false, title: '看板一', group: '留存看板/核心留存' },
			{ name: 'page2', slug: 'page2', isHome: false, title: '看板二', group: ['留存看板', '下钻诊断'] },
			{ name: 'page3', slug: 'page3', isHome: false, title: '看板三', group: '留存看板' }
		];

		const tree = buildNavTreeFromFlat(items);

		expect(tree.rootPages).toEqual([]);
		expect(tree.directories).toHaveLength(1);

		const group = tree.directories[0];
		expect(group.id).toBe('留存看板');
		expect(group.name).toBe('留存看板');
		expect(group.pages.map((p) => p.name)).toEqual(['看板三']);
		expect(group.directories).toHaveLength(2);

		expect(group.directories[0].name).toBe('核心留存');
		expect(group.directories[0].pages.map((p) => p.name)).toEqual(['看板一']);

		expect(group.directories[1].name).toBe('下钻诊断');
		expect(group.directories[1].pages.map((p) => p.name)).toEqual(['看板二']);
	});

	it('frontmatter group takes precedence over directory path', () => {
		const items: FlatNavItem[] = [
			{ name: 'raw', slug: 'misc/raw', isHome: false, title: '自定义分组页', group: '分析群组' }
		];

		const tree = buildNavTreeFromFlat(items);

		expect(tree.directories).toHaveLength(1);
		expect(tree.directories[0].name).toBe('分析群组');
		expect(tree.directories[0].pages[0].href).toBe('/misc/raw');
	});
});
