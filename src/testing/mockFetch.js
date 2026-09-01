export async function withMockFetch(implementation, fn) {
	const original = globalThis.fetch;
	globalThis.fetch = implementation;
	try {
		return await fn();
	} finally {
		globalThis.fetch = original;
	}
}
