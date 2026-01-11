class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public code?: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

function getToken(): string | null {
	return localStorage.getItem('token');
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	const token = getToken();
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	const response = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});

	const data = await response.json();

	if (!response.ok) {
		throw new ApiError(data.message || data.error || 'Request failed', response.status, data.error);
	}

	return data;
}

export const api = {
	get: <T>(url: string) => request<T>('GET', url),
	post: <T>(url: string, body: unknown) => request<T>('POST', url, body),
	patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
	delete: <T>(url: string) => request<T>('DELETE', url),
};

export { ApiError };
