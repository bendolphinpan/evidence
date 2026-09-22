/** Client-side active project for /api/query. Layout sets it from the current page. */
let projectId = '51';

export function setAnalysisProject(id: string) {
	projectId = String(id || '51').trim() || '51';
}

export function getAnalysisProject(): string {
	return projectId;
}
