import { defineConfig, devices } from "@playwright/test";

// Chrome only for now. Firefox/WebKit are added as extra projects later — the
// harness (servers, fixtures, page) is engine-agnostic, so expansion is a
// matter of enabling the commented entries and verifying the ICE channel per
// engine (see README "Further work").
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	// Real-browser ICE/fetch timing is sensitive under shared CI CPU; retry to
	// absorb rare timing flake without masking real regressions.
	retries: process.env.CI ? 2 : 0,
	// Cap CI parallelism so libwebrtc's paced ICE checks are not CPU-starved.
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI
		? [["list"], ["html", { open: "never" }]]
		: [["list"]],
	timeout: 30_000,
	use: {
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		// { name: "firefox", use: { ...devices["Desktop Firefox"] } },
		// { name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
});
