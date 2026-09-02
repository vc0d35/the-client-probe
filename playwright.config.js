import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	// Real-browser timing flakes under shared CI CPU.
	retries: process.env.CI ? 2 : 0,
	// Keep libwebrtc's paced ICE checks from being CPU-starved.
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
