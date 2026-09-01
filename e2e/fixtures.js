// Playwright fixtures shared by every spec.
//
// - `servers` is worker-scoped: each worker boots its own hermetic target and
//   page servers on OS-assigned ports, so parallel workers never share state.
// - `probeApi` is test-scoped: it opens the harness page, waits for the library
//   to load, and hands back a `run` helper that forwards a function into the
//   page where the real exported probes execute.

import { test as base } from "@playwright/test";
import { startServers } from "./servers.js";

export const test = base.extend({
	servers: [
		// biome-ignore lint/correctness/noEmptyPattern: Playwright's first fixture argument is the fixtures object; `servers` depends on none.
		async ({}, use) => {
			const servers = await startServers();
			await use(servers);
			await servers.stop();
		},
		{ scope: "worker" },
	],

	probeApi: async ({ page, servers }, use) => {
		await page.goto(`${servers.pageBaseUrl}/e2e/harness.html`);
		await page.waitForFunction(() => Boolean(window.__probe));
		await use({
			host: servers.host,
			// `arg` is passed through to the page; return value must be JSON-safe,
			// which every ProbeResult is.
			run: (fn, arg) => page.evaluate(fn, arg),
		});
	},
});

export const expect = base.expect;
