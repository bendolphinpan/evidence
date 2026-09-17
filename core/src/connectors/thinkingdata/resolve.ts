import type { ThinkingDataConnection } from './connection-schema';
import type { ThinkingDataCredentials } from './credentials';
import { normalizeTeBaseUrl } from './sql';

export function resolveThinkingDataCredentials(
	config: ThinkingDataConnection
): ThinkingDataCredentials {
	const parsed = normalizeTeBaseUrl(config.url);
	if (!parsed.baseUrl) {
		throw new Error(
			'ThinkingData OpenAPI URL is required (console API root, not the game SDK receiver)'
		);
	}
	const token = (config.token || parsed.tokenFromUrl || '').trim();
	if (!token) {
		throw new Error('ThinkingData OpenAPI token is required');
	}
	return {
		url: parsed.baseUrl,
		token,
		projectId: config.project_id.trim(),
		schema: (config.schema || 'ta').trim() || 'ta'
	};
}
