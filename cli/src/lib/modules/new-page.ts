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
---

# ${title}

## 筛选

{% filter_bar %}
{% range_calendar id="dates" value_column="$part_date" default_range="last 7 days" preset_ranges=["yesterday", "today", "last 7 days", "last 30 days", "last 3 months", "previous week", "previous month", "this week", "this month"] /%}
{% /filter_bar %}

\`\`\`sql overview
SELECT
  "$part_date" AS part_date,
  COUNT(DISTINCT "#user_id") AS users
FROM ${schema}.v_event_${projectId} e
WHERE "$part_date" {{dates.between}}
  AND "$part_event" = 'ta_app_start'
  AND /*evd-saved*/ 1 = 1
GROUP BY 1
ORDER BY 1
\`\`\`

{% line_chart data="overview" x="part_date" y="users" /%}

{% table data="overview" /%}
`;
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
		return { error: '路径只允许小写字母、数字和连字符，并且以字母开头' };
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
