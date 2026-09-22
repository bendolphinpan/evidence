import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { getProjectCwd } from '$lib/server/project-cwd';
import { withStore, type PageLock } from './store';
import type { PublicUser } from './auth';

function pagesDir(): string {
	return resolve(getProjectCwd(), 'pages');
}

export function resolvePageFile(slug: string): string | null {
	const clean = slug.replace(/^\/+/, '').replace(/\\/g, '/');
	if (!clean || clean.includes('..')) return null;
	const base = pagesDir();
	const file = resolve(base, `${clean}.md`);
	const rel = relative(base, file);
	if (rel.startsWith('..') || normalize(rel).startsWith(`..${sep}`)) return null;
	return file;
}

export function readPageMarkdown(slug: string): string | null {
	const file = resolvePageFile(slug);
	if (!file || !existsSync(file)) return null;
	return readFileSync(file, 'utf8');
}

export function pageExists(slug: string): boolean {
	const file = resolvePageFile(slug);
	return !!file && existsSync(file);
}

export function createPageMarkdown(
	slug: string,
	markdown: string
): { ok: true } | { error: string } {
	if (pageExists(slug)) return { error: '这个路径已经有页面' };
	return writePageMarkdown(slug, markdown);
}

export function writePageMarkdown(slug: string, markdown: string): { ok: true } | { error: string } {
	const file = resolvePageFile(slug);
	if (!file) return { error: '无效路径' };
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, markdown, 'utf8');
	return { ok: true };
}

export function acquireLock(slug: string, user: PublicUser): PageLock | { error: string } {
	const now = Date.now();
	return withStore((state) => {
		state.pageLocks = state.pageLocks.filter((l) => new Date(l.expiresAt).getTime() > now);
		const existing = state.pageLocks.find((l) => l.slug === slug);
		if (existing && existing.userId !== user.id) {
			return { error: `${existing.username} 正在编辑` };
		}
		const lock: PageLock = {
			slug,
			userId: user.id,
			username: user.username,
			expiresAt: new Date(now + 15 * 60_000).toISOString()
		};
		state.pageLocks = state.pageLocks.filter((l) => l.slug !== slug);
		state.pageLocks.push(lock);
		return lock;
	});
}

export function releaseLock(slug: string, userId: string): void {
	withStore((state) => {
		state.pageLocks = state.pageLocks.filter((l) => !(l.slug === slug && l.userId === userId));
	});
}

export type ContentBlock =
	| { type: 'md'; text: string }
	| { type: 'sql'; name: string; text: string }
	| {
			type: 'component';
			tag: string;
			attrs: { key: string; value: string }[];
			selfClosing: boolean;
			body?: string;
	  };

function parseAttrs(raw: string): { key: string; value: string }[] {
	const attrs: { key: string; value: string }[] = [];
	const re = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw))) {
		attrs.push({ key: m[1], value: m[2] ?? m[3] ?? m[4] ?? '' });
	}
	return attrs;
}

function formatAttrs(attrs: { key: string; value: string }[]): string {
	return attrs
		.filter((a) => a.key.trim())
		.map((a) => `${a.key}="${a.value}"`)
		.join(' ');
}

export function splitMarkdown(markdown: string): ContentBlock[] {
	const found: { start: number; end: number; block: ContentBlock }[] = [];
	const sqlRe = /```sql(?:[ \t]+(\S+))?[ \t]*\n([\s\S]*?)```/g;
	let m: RegExpExecArray | null;
	while ((m = sqlRe.exec(markdown))) {
		found.push({
			start: m.index,
			end: m.index + m[0].length,
			block: { type: 'sql', name: m[1] || 'query', text: m[2].replace(/\n$/, '') }
		});
	}
	const blockTagRe = /\{%\s*(\w+)([^%]*?)%\}([\s\S]*?)\{%\s*end\1\s*%\}/g;
	while ((m = blockTagRe.exec(markdown))) {
		found.push({
			start: m.index,
			end: m.index + m[0].length,
			block: {
				type: 'component',
				tag: m[1],
				attrs: parseAttrs(m[2]),
				selfClosing: false,
				body: m[3]
			}
		});
	}
	const selfRe = /\{%\s*(\w+)([^%]*?)\s*\/%\}/g;
	while ((m = selfRe.exec(markdown))) {
		const overlaps = found.some((f) => m!.index >= f.start && m!.index < f.end);
		if (overlaps) continue;
		found.push({
			start: m.index,
			end: m.index + m[0].length,
			block: {
				type: 'component',
				tag: m[1],
				attrs: parseAttrs(m[2]),
				selfClosing: true
			}
		});
	}
	found.sort((a, b) => a.start - b.start);
	const blocks: ContentBlock[] = [];
	let last = 0;
	for (const item of found) {
		if (item.start < last) continue;
		const prose = markdown.slice(last, item.start);
		if (prose.trim()) blocks.push({ type: 'md', text: prose.replace(/^\n+|\n+$/g, '') });
		blocks.push(item.block);
		last = item.end;
	}
	const tail = markdown.slice(last);
	if (tail.trim()) blocks.push({ type: 'md', text: tail.replace(/^\n+|\n+$/g, '') });
	return blocks;
}

export function joinMarkdown(blocks: ContentBlock[]): string {
	return blocks
		.map((b) => {
			if (b.type === 'sql') return `\`\`\`sql ${b.name}\n${b.text}\n\`\`\``;
			if (b.type === 'component') {
				const attr = formatAttrs(b.attrs);
				const head = attr ? `{% ${b.tag} ${attr}` : `{% ${b.tag}`;
				if (b.selfClosing) return `${head} /%}`;
				return `${head} %}${b.body ?? ''}{% end${b.tag} %}`;
			}
			return b.text;
		})
		.join('\n\n');
}
