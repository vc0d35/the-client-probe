/**
 * @param {typeof fetch} implementation The fake fetch to install.
 * @param {() => Promise<unknown>} fn The test body to run.
 */
export async function withMockFetch(implementation, fn) {
	const original = globalThis.fetch;
	globalThis.fetch = implementation;
	try {
		return await fn();
	} finally {
		globalThis.fetch = original;
	}
}
