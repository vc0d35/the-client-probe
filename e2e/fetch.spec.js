import { expect, test } from "./fixtures.js";

// Short so the open-silent case, which waits for the abort, stays fast.
const FETCH_TIMEOUT_MS = 800;

test.describe("fetch channel", () => {
	test("responding HTTP server → open", async ({ probeApi, servers }) => {
		const result = await probeApi.run(
			({ host, port, timeout }) =>
				window.__probe.probeWithFetch(host, port, timeout),
			{ host: servers.host, port: servers.httpOpen, timeout: FETCH_TIMEOUT_MS },
		);
		expect(result).toMatchObject({ port: servers.httpOpen, state: "open" });
	});

	test("accepts TCP but never responds → open-silent", async ({
		probeApi,
		servers,
	}) => {
		const result = await probeApi.run(
			({ host, port, timeout }) =>
				window.__probe.probeWithFetch(host, port, timeout),
			{ host: servers.host, port: servers.silent, timeout: FETCH_TIMEOUT_MS },
		);
		expect(result).toMatchObject({
			port: servers.silent,
			state: "open-silent",
		});
	});

	test("refused connection → closed", async ({ probeApi, servers }) => {
		const result = await probeApi.run(
			({ host, port, timeout }) =>
				window.__probe.probeWithFetch(host, port, timeout),
			{
				host: servers.host,
				port: servers.closedHigh,
				timeout: FETCH_TIMEOUT_MS,
			},
		);
		expect(result).toMatchObject({
			port: servers.closedHigh,
			state: "closed",
		});
	});
});
