import { test as base } from "@playwright/test";
import { startServers } from "./servers.js";

export const test = base.extend({
	servers: [
		// biome-ignore lint/correctness/noEmptyPattern: Playwright passes the fixtures object first; servers needs none.
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
			run: (fn, arg) => page.evaluate(fn, arg),
		});
	},
});

export const expect = base.expect;
