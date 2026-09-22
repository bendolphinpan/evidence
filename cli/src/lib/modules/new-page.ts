export function starterMarkdown(input: {
	slug: string;
	title: string;
	projectId: string;
	schema?: string;
}): string {
	const projectId = /^\d+$/.test(input.projectId) ? input.projectId : '51';
	const schema = /^[A-Za-z_][A-Za-z0-9_]*$/.test(input.schema || '') ? input.schema : 'ta';
	const title = input.title.trim() || input.slug;
	return `---
title: ${JSON.stringify(title)}
sidebar_position: 50
projectId: ${projectId}
cards: true
---

# ${title}

\`\`\`sql overview
SELECT
  e."$part_date" AS part_date,
  COUNT(DISTINCT e."#user_id") AS users
FROM ${schema}.v_event_${projectId} e
LEFT JOIN ${schema}.v_user_${projectId} u ON e."#user_id" = u."#user_id"
WHERE e."$part_date" {{dates.between}}
  AND "$part_event" = 'ta_app_start'
  AND /*evd-saved*/ 1 = 1
  AND (
    {{audience.selected}} = 'all'
    OR (
      u."is_test" = false
      AND u."init_country" IN ('BR', 'DE', 'IT', 'FR', 'US', 'NL', 'PH', 'ES')
    )
  )
GROUP BY 1
ORDER BY 1
\`\`\`

{% stack card=true %}
{% filter_bar %}
{% range_calendar id="dates" value_column="$part_date" default_range="last 7 days" preset_ranges=["yesterday", "today", "last 7 days", "last 30 days", "last 3 months", "previous week", "previous month", "week to date", "month to date"] /%}
{% dropdown id="audience" initial_value="real" clear=false search=false %}
{% option value="real" label="真实用户" /%}
{% option value="all" label="全部用户" /%}
{% /dropdown %}
{% /filter_bar %}
{% line_chart data="overview" x="part_date" y="users" /%}
{% table data="overview" /%}
{% /stack %}
`;
}

export function slugFromTitle(title: string): string {
	const fromTitle = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	if (fromTitle) return fromTitle.slice(0, 40);
	return `page-${Date.now().toString(36)}`;
}

/** Editor and admin. Viewer is rejected by the pages API. */
export async function createReportPage(input: {
	slug: string;
	title: string;
	projectId: string;
	schema?: string;
}): Promise<{ href: string } | { error: string }> {
	const slug = input.slug.trim().toLowerCase();
	const title = input.title.trim() || slug;
	if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
		return { error: '链接名只能用小写英文、数字和连字符，并且以字母开头' };
	}
	const res = await fetch('/api/modules/pages/create', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			slug,
			title,
			projectId: input.projectId,
			schema: input.schema,
			markdown: starterMarkdown({ slug, title, projectId: input.projectId, schema: input.schema })
		})
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) return { error: json.error || '创建失败' };
	return { href: json.href || (slug === 'index' ? '/' : `/${slug}`) };
}
