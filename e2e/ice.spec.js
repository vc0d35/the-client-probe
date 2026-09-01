// ICE channel (ports >= 1024): the forged-SDP, ICE-TCP technique run against a
// real Chromium and real loopback listeners — the behavior the mocked unit
// suite cannot reach.

import { expect, test } from "./fixtures.js";

// Generous per-call deadline so an accepted connection has time to register a
// connectivity check before classification, independent of CI load.
const ICE_TIMEOUT_MS = 4000;

test.describe("ICE channel", () => {
	test("accepted TCP connection on loopback → open", async ({
		probeApi,
		servers,
	}) => {
		const [result] = await probeApi.run(
			({ host, port, timeout }) =>
				window.__probe.probeBatchWithIce(host, [port], timeout),
			{ host: servers.host, port: servers.httpOpen, timeout: ICE_TIMEOUT_MS },
		);
		expect(result).toMatchObject({ port: servers.httpOpen, state: "open" });
	});

	test("refused connection → closed", async ({ probeApi, servers }) => {
		const [result] = await probeApi.run(
			({ host, port, timeout }) =>
				window.__probe.probeBatchWithIce(host, [port], timeout),
			{ host: servers.host, port: servers.closedHigh, timeout: ICE_TIMEOUT_MS },
		);
		expect(result).toMatchObject({ port: servers.closedHigh, state: "closed" });
	});

	test("single-port probeWithIce smoke → open", async ({
		probeApi,
		servers,
	}) => {
		const result = await probeApi.run(
			({ host, port, timeout }) =>
				window.__probe.probeWithIce(host, port, timeout),
			{ host: servers.host, port: servers.httpOpen, timeout: ICE_TIMEOUT_MS },
		);
		expect(result.state).toBe("open");
	});
});
