import { probeBatches } from "./probe/batch.js";
import { parseArgs } from "./utils/parseArgs.js";

export { PortState, probeWithFetch } from "./probe/probeWithFetch.js";

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
 * @returns {Promise<ProbeResult[]>}
 */
export async function scanPorts(host, portsOrMin, max) {
	const ports = parseArgs(portsOrMin, max);
	return probeBatches(host, ports);
}
