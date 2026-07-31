/**
 * @overload
 * @param {readonly number[]} ports Ports to probe.
 * @returns {void}
 */

import { parseArgs } from "./utils/parseArgs";

/**
 * @overload
 * @param {number} min Minimum port in a range.
 * @param {number} max Maximum port in a range.
 * @returns {void}
 */

/**
 * @param {readonly number[] | number} portsOrMin Ports to probe, or the
 * minimum port in a range.
 * @param {number} [max] Maximum port in a range.
 * @returns {void}
 */
export function scanPorts(portsOrMin, max) {
  const ports = parseArgs(portsOrMin, max);
	console.log("Hello world with parseArgs", ports);
}
