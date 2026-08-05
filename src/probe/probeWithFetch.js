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
 * Probe one TCP port with fetch.
 *
 * A resolved fetch means the service responded. An abort caused by the
 * internal timeout means the connection stayed open without response bytes.
 * Any other rejection is classified as closed — but note rejections also
 * happen for OPEN ports whose response is CORP/ORB-blocked or not valid
 * HTTP (e.g. SSH banners); those are false negatives this channel cannot
 * avoid. probeWithIce (ports >= 1024) is immune to them.
 *
 * @param {string} host Hostname or IP literal.
 * @param {number} port TCP port number.
 * @param {number} [timeoutMs=2000] How long to wait for response bytes
 *   before classifying the port as open-silent. 500 ms is plenty on
 *   loopback.
 * @returns {Promise<{host: string, port: number, state: string, durationMs: number}>}
 */
export async function probeWithFetch(host, port, timeoutMs = FETCH_TIMEOUT_MS) {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	const started = performance.now();
	try {
		await fetch(`http://${host}:${port}/`, {
			mode: "no-cors",
			cache: "no-store",
			signal: controller.signal,
		});

		return {
			host,
			port,
			state: PortState.Open,
			durationMs: performance.now() - started,
		};
	} catch {
		return {
			host,
			port,
			state: timedOut ? PortState.OpenSilent : PortState.Closed,
			durationMs: performance.now() - started,
		};
	} finally {
		clearTimeout(timer);
	}
}
