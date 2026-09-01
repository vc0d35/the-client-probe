const FETCH_TIMEOUT_MS = 2000;

// Keep result values centralized so both probe implementations classify their
// observations with the same strings.
export const PortState = Object.freeze({
	Open: "open",
	OpenSilent: "open-silent",
	Closed: "closed",
	Restricted: "restricted",
});

/**
 * @typedef {{host: string, port: number, state: "open"|"open-silent"|"closed"|"restricted", durationMs: number}} ProbeResult
 */

export async function probeWithFetch(host, port, timeoutMs = FETCH_TIMEOUT_MS) {
	const started = performance.now();
	try {
		// no-cors avoids requiring a successful CORS check; a successful cross-
		// origin response is exposed only as opaque. no-store bypasses the HTTP
		// cache, though browser policies and intermediaries can still stop the load.
		await fetch(`http://${host}:${port}/`, {
			mode: "no-cors",
			cache: "no-store",
			signal: AbortSignal.timeout(timeoutMs),
		});

		return {
			host,
			port,
			state: PortState.Open,
			durationMs: performance.now() - started,
		};
	} catch (error) {
		// The timeout signal is the only rejection initiated here. It means only
		// that fetch did not settle within the observation window; it does not prove
		// where the request stalled. Every other rejection—network, HTTP parsing, or
		// browser policy—is collapsed into the same closed result.
		return {
			host,
			port,
			state:
				error?.name === "TimeoutError"
					? PortState.OpenSilent
					: PortState.Closed,
			durationMs: performance.now() - started,
		};
	}
}
