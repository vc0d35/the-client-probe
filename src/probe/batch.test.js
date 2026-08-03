import assert from "node:assert/strict";
import test from "node:test";
import { withMockFetch } from "../testing/mockFetch.js";
import { withFakePeerConnection } from "../testing/mockPeerConnection.js";
import { probeBatches } from "./batch.js";
import { PortState } from "./probeWithFetch.js";

test("probeBatches preserves order and limits concurrent probes", async () => {
	let activeProbes = 0;
	let maximumActiveProbes = 0;

	await withMockFetch(
		async () => {
			activeProbes += 1;
			maximumActiveProbes = Math.max(maximumActiveProbes, activeProbes);
			await new Promise((resolve) => setTimeout(resolve, 0));
			activeProbes -= 1;
		},
		async () => {
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
		},
	);
});

test("probeBatches routes low ports to fetch and high ports to ICE", async () => {
	const fetchUrls = [];

	await withMockFetch(
		async (url) => {
			fetchUrls.push(url);
			return {};
		},
		async () => {
			await withFakePeerConnection({ requestsSent: 1 }, async () => {
				const results = await probeBatches("127.0.0.1", [80, 8080]);

				assert.deepEqual(fetchUrls, ["http://127.0.0.1:80/"]);
				assert.deepEqual(
					results.map(({ port, state }) => ({ port, state })),
					[
						{ port: 80, state: PortState.Open },
						{ port: 8080, state: PortState.Open },
					],
				);
			});
		},
	);
});
