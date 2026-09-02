import { expect, test } from "./fixtures.js";

// In Chromium's restricted list, so no listener is needed.
const RESTRICTED_PORT = 6000;

test.describe("scanPorts orchestration", () => {
	test("classifies a mixed batch, preserves order, reports progress", async ({
		probeApi,
		servers,
	}) => {
		const ports = [servers.httpOpen, servers.closedHigh, RESTRICTED_PORT];

		const { results, progress } = await probeApi.run(
			({ host, ports, iceTimeout }) => {
				const progress = [];
				return window.__probe
					.scanPorts(host, ports, {
						iceTimeoutMs: iceTimeout,
						onProgress: ({ completed, total }) =>
							progress.push({ completed, total }),
					})
					.then((results) => ({ results, progress }));
			},
			{ host: servers.host, ports, iceTimeout: 4000 },
		);

		expect(results.map((r) => r.port)).toEqual(ports);

		const stateByPort = Object.fromEntries(
			results.map((r) => [r.port, r.state]),
		);
		expect(stateByPort[servers.httpOpen]).toBe("open"); // >= 1024 -> ICE
		expect(stateByPort[servers.closedHigh]).toBe("closed");
		expect(stateByPort[RESTRICTED_PORT]).toBe("restricted");

		expect(progress.map((p) => p.total)).toEqual(ports.map(() => ports.length));
		expect(progress.map((p) => p.completed)).toEqual(
			ports.map((_, index) => index + 1),
		);
	});

	test("routes ports < 1024 through the fetch channel", async ({
		probeApi,
		servers,
	}) => {
		test.skip(
			!servers.lowPortsAvailable,
			"binding a port < 1024 is not permitted in this environment",
		);

		const [result] = await probeApi.run(
			({ host, port, fetchTimeout }) =>
				window.__probe.scanPorts(host, [port], {
					fetchTimeoutMs: fetchTimeout,
				}),
			{ host: servers.host, port: servers.lowOpen, fetchTimeout: 1500 },
		);
		expect(result).toMatchObject({ port: servers.lowOpen, state: "open" });
	});
});
