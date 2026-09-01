const FETCH_TIMEOUT_MS = 2000;

export const PortState = Object.freeze({
	Open: "open",
	OpenSilent: "open-silent",
	Closed: "closed",
	Restricted: "restricted",
});

// Classify a port by the outcome of a no-cors fetch: resolved -> open,
// TimeoutError (the abort signal) -> open-silent, any other rejection -> closed.
// That last bucket is lossy: an open port whose response is CORP/ORB-blocked or
// not valid HTTP (SSH banners, binary protocols) also rejects and misreports as
// closed — which is why ports >= 1024 use the ICE channel instead.
export async function probeWithFetch(host, port, timeoutMs = FETCH_TIMEOUT_MS) {
	const started = performance.now();
	try {
		// no-cors so a cross-origin response resolves (opaque) rather than failing
		// the CORS check; no-store to bypass the HTTP cache.
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
