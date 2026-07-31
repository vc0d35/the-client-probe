const FETCH_TIMEOUT_MS = 2000;

/**
 * Port states observable from a fetch-based probe.
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
 * Any other rejection is classified as closed.
 *
 * @param {string} host Hostname or IP literal.
 * @param {number} port TCP port number.
 * @returns {Promise<{host: string, port: number, state: string, durationMs: number}>}
 */
export async function probeWithFetch(host, port) {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, FETCH_TIMEOUT_MS);

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
