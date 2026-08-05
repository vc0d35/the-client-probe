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
			const ports = Array.from({ length: 130 }, (_, index) => index + 200);
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
			await withFakePeerConnection(
				{ requestsSent: 1, remotePort: 8080 },
				async () => {
					const results = await probeBatches("127.0.0.1", [80, 8080]);

					assert.deepEqual(fetchUrls, ["http://127.0.0.1:80/"]);
					assert.deepEqual(
						results.map(({ port, state }) => ({ port, state })),
						[
							{ port: 80, state: PortState.Open },
							{ port: 8080, state: PortState.Open },
						],
					);
				},
			);
		},
	);
});

test("probeBatches reports restricted ports without probing them", async () => {
	const fetchUrls = [];

	await withMockFetch(
		async (url) => {
			fetchUrls.push(url);
			return {};
		},
		async () => {
			await withFakePeerConnection(
				{ requestsSent: 1, remotePort: 8080 },
				async (instances) => {
					const events = [];
					const results = await probeBatches(
						"127.0.0.1",
						[22, 80, 6000, 8080],
						{
							onProgress: (progress) => events.push(progress),
						},
					);

					assert.equal(events.at(-1).completed, 4);
					assert.deepEqual(fetchUrls, ["http://127.0.0.1:80/"]);
					assert.deepEqual(
						results.map(({ port, state }) => ({ port, state })),
						[
							{ port: 22, state: PortState.Restricted },
							{ port: 80, state: PortState.Open },
							{ port: 6000, state: PortState.Restricted },
							{ port: 8080, state: PortState.Open },
						],
					);
					const sdp = instances[0].remoteDescription.sdp;
					assert.match(sdp, /8080/);
					assert.doesNotMatch(sdp, /6000/);
				},
			);
		},
	);
});

test("probeBatches shares one connection per ICE batch", async () => {
	await withFakePeerConnection(
		{ requestsSent: 1, remotePort: 8080 },
		async (instances) => {
			const results = await probeBatches("127.0.0.1", [8080, 8081], {
				iceTimeoutMs: 300,
			});

			assert.equal(instances.length, 1, "one peer connection for the batch");
			assert.deepEqual(
				results.map(({ port, state }) => ({ port, state })),
				[
					{ port: 8080, state: PortState.Open },
					{ port: 8081, state: PortState.Closed },
				],
			);
		},
	);
});

test("probeBatches reports progress for every probe", async () => {
	const events = [];

	await withMockFetch(
		async () => ({}),
		async () => {
			await withFakePeerConnection(
				{ requestsSent: 1, remotePort: 8080 },
				async () => {
					await probeBatches("127.0.0.1", [80, 443, 8080], {
						onProgress: (progress) => events.push(progress),
					});

					assert.equal(events.at(-1).total, 3);
					assert.deepEqual(
						events.map(({ completed }) => completed),
						[1, 2, 3],
					);
					assert.deepEqual(
						events.map(({ result }) => result.port).sort((a, b) => a - b),
						[80, 443, 8080],
					);
				},
			);
		},
	);
});
