import { probeBatches } from "./probe/batch.js";
import { parseArgs } from "./utils/parseArgs.js";

export { PortState, probeWithFetch } from "./probe/probeWithFetch.js";
export { probeBatchWithIce, probeWithIce } from "./probe/probeWithIce.js";

/**
 * @typedef {{host: string, port: number, state: string, durationMs: number}} ProbeResult
 */

/**
 * @overload
 * @param {string} host Hostname or IP literal.
 * @param {readonly number[]} ports Ports to probe.
 * @returns {Promise<ProbeResult[]>}
 */
/**
 * @overload
 * @param {string} host Hostname or IP literal.
 * @param {number} min Minimum port in a range.
 * @param {number} max Maximum port in a range.
 * @returns {Promise<ProbeResult[]>}
 */
/**
 * @param {string} host Hostname or IP literal.
 * @param {readonly number[] | number} portsOrMin Ports to probe, or the
 * minimum port in a range.
 * @param {number} [max] Maximum port in a range.
 * @param {object} [options]
 * @param {number} [options.fetchTimeoutMs] Hang timeout for fetch probes
 *   (ports < 1024). Default 2000; 500 is plenty on loopback.
 * @param {number} [options.iceTimeoutMs] Per-batch deadline for ICE probes
 *   (ports >= 1024, 64 ports share one deadline). Default is adaptive
 *   (batchSize * 100 + 500 ms) to cover Chromium's ~65 ms/candidate
 *   pacing; shorter explicit values are only safe for small batches.
 * @param {(progress: {completed: number, total: number, result: ProbeResult}) => void} [options.onProgress]
 *   Called as each probe settles, for progress display or streaming use.
 * @returns {Promise<ProbeResult[]>}
 */
export async function scanPorts(host, portsOrMin, max, options = {}) {
	if (typeof max === "object" && max !== null) {
		options = max;
		max = undefined;
	}
	const ports = parseArgs(portsOrMin, max);
	return probeBatches(host, ports, options);
}
