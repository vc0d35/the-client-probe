const FETCH_TIMEOUT_MS = 2000;

/**
 * Port states observable from a probe.
 */
export const PortState = Object.freeze({
	Open: "open",
	OpenSilent: "open-silent",
	Closed: "closed",
});

/**
 * @typedef {{host: string, port: number, state: "open"|"open-silent"|"closed", durationMs: number}} ProbeResult
 */

/**
 * Probe one TCP port with fetch.
 *
 * A resolved fetch means the service responded. A TimeoutError (from the
 * AbortSignal.timeout signal) means the connection stayed open without
 * response bytes. Any other rejection is classified as closed — but note
 * rejections also happen for OPEN ports whose response is CORP/ORB-blocked
 * or not valid HTTP (e.g. SSH banners); those are false negatives this
 * channel cannot avoid. probeWithIce (ports >= 1024) is immune to them.
 *
 * @param {string} host Hostname or IP literal.
 * @param {number} port TCP port number.
 * @param {number} [timeoutMs=2000] How long to wait for response bytes
 *   before classifying the port as open-silent. 500 ms is plenty on
 *   loopback.
 * @returns {Promise<ProbeResult>}
 */
export async function probeWithFetch(host, port, timeoutMs = FETCH_TIMEOUT_MS) {
	const started = performance.now();
	try {
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
