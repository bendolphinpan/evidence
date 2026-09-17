/**
 * Execution-layer ThinkingData OpenAPI credentials, resolved from connection.yaml.
 */
export type ThinkingDataCredentials = {
	/** OpenAPI root, e.g. https://company.thinkingdata.cn or http://host:8992. */
	url: string;
	token: string;
	projectId: string;
	schema: string;
};
