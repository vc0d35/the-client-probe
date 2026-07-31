import assert from "node:assert/strict";
import test from "node:test";

import { probeBatches } from "./batch.js";
import { PortState } from "./probeWithFetch.js";

test("probeBatches preserves order and limits concurrent probes", async () => {
	const originalFetch = globalThis.fetch;
	let activeProbes = 0;
	let maximumActiveProbes = 0;
	globalThis.fetch = async () => {
		activeProbes += 1;
		maximumActiveProbes = Math.max(maximumActiveProbes, activeProbes);
		await new Promise((resolve) => setTimeout(resolve, 0));
		activeProbes -= 1;
	};

	try {
		const ports = Array.from({ length: 130 }, (_, port) => port + 1);
		const results = await probeBatches("localhost", ports);

		assert.equal(maximumActiveProbes, 128);
		assert.deepEqual(
			results.map(({ host, port, state }) => ({ host, port, state })),
			ports.map((port) => ({
				host: "localhost",
				port,
				state: PortState.Open,
			})),
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
