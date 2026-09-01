// Scope the global replacement to one async test and restore it even when the
// assertion or implementation throws.
export async function withMockFetch(implementation, fn) {
	const original = globalThis.fetch;
	globalThis.fetch = implementation;
	try {
		return await fn();
	} finally {
		globalThis.fetch = original;
	}
}
