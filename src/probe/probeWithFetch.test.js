import assert from "node:assert/strict";
import test from "node:test";

import { PortState, probeWithFetch } from "../index.js";
import { withMockFetch } from "../testing/mockFetch.js";

test("probeWithFetch classifies a resolved fetch as open", async () => {
	await withMockFetch(
		async (url, options) => {
			assert.equal(url, "http://127.0.0.1:8080/");
			assert.equal(options.mode, "no-cors");
			return {};
		},
		async () => {
			const result = await probeWithFetch("127.0.0.1", 8080);
			assert.deepEqual(
				{ host: result.host, port: result.port, state: result.state },
				{
					host: "127.0.0.1",
					port: 8080,
					state: PortState.Open,
				},
			);
			assert.equal(typeof result.durationMs, "number");
		},
	);
});

test("probeWithFetch classifies an abort timeout as open-silent", async () => {
	const timeoutMs = 50;
	await withMockFetch(
		(_url, options) =>
			// Never responds; rejects when the probe's AbortSignal.timeout fires,
			// mirroring how a real fetch surfaces the timeout.
			new Promise((_, reject) => {
				options.signal.addEventListener("abort", () =>
					reject(options.signal.reason),
				);
			}),
		async () => {
			const result = await probeWithFetch("127.0.0.1", 8080, timeoutMs);

			assert.equal(result.state, PortState.OpenSilent);
			// AbortSignal.timeout(t) can fire a hair before performance.now()
			// measures t — Node truncates timer delays to whole milliseconds and
			// reads a slightly different clock — so a strict `>= timeoutMs` is flaky
			// on slower/virtualized CI clocks. Allow a small tolerance while still
			// proving the probe waited out the timeout rather than returning at once.
			assert.ok(
				result.durationMs >= timeoutMs - 5,
				`waits out the timeout (got ${result.durationMs}ms)`,
			);
		},
	);
});

test("probeWithFetch classifies a rejected fetch as closed", async () => {
	await withMockFetch(
		async () => {
			throw new TypeError("fetch failed"); // connection refused
		},
		async () => {
			const result = await probeWithFetch("127.0.0.1", 8080);

			assert.equal(result.state, PortState.Closed);
		},
	);
});
