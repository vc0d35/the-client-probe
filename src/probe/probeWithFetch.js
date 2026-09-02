const FETCH_TIMEOUT_MS = 2000;

export const PortState = Object.freeze({
	Open: "open",
	OpenSilent: "open-silent",
	Closed: "closed",
	Restricted: "restricted",
});

// A rejection does not prove the port is closed: non-HTTP services and
// CORP/ORB-blocked responses reject too. That is why ports >= 1024 use ICE.
export async function probeWithFetch(host, port, timeoutMs = FETCH_TIMEOUT_MS) {
	const started = performance.now();
	try {
		// no-cors: a cross-origin response resolves (opaque) instead of failing CORS.
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
