import { z } from 'zod/v4';
import type { ConnectionFieldMeta } from '../connection-schema';
import { notTemplatePlaceholder, PLACEHOLDER_MESSAGE } from '../connection-placeholder';

const meta = (m: ConnectionFieldMeta): ConnectionFieldMeta => m;

export const thinkingdataBase = z.object({
	type: z.literal('thinkingdata'),

	url: z
		.string()
		.min(1)
		.transform((s) => s.trim())
		.refine(notTemplatePlaceholder, PLACEHOLDER_MESSAGE)
		.meta(
			meta({
				label: 'OpenAPI URL',
				description:
					'ThinkingData OpenAPI root URL from the console (not the game SDK receiver / sync_json). Cloud: https://your-company.thinkingdata.cn. Private: http://host:8992.',
				category: 'credential'
			})
		),

	token: z
		.string()
		.min(1)
		.meta(
			meta({
				label: 'OpenAPI token',
				description: 'Project query token from the ThinkingData console.',
				category: 'credential',
				secret: true
			})
		),

	project_id: z
		.string()
		.min(1)
		.transform((s) => s.trim())
		.refine(notTemplatePlaceholder, PLACEHOLDER_MESSAGE)
		.meta(
			meta({
				label: 'Project ID',
				description:
					'Numeric ThinkingData project ID (not AppId). Maps to ta.v_event_{id} / ta.v_user_{id} / ta.user_day_serial_{id}.',
				category: 'context',
				yamlKey: 'project_id'
			})
		),

	schema: z
		.string()
		.min(1)
		.default('ta')
		.meta(
			meta({
				label: 'SQL schema',
				description: 'ThinkingData SQL schema. Cloud projects usually use ta.',
				category: 'context'
			})
		)
});

export const thinkingdataConnectionSchema = thinkingdataBase;

export type ThinkingDataConnection = z.infer<typeof thinkingdataConnectionSchema>;
