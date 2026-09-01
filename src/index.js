import { probeBatches } from "./probe/batch.js";
import { parseArgs } from "./utils/parseArgs.js";

export { PortState, probeWithFetch } from "./probe/probeWithFetch.js";
export { probeBatchWithIce, probeWithIce } from "./probe/probeWithIce.js";
export { RESTRICTED_PORTS } from "./probe/restrictedPorts.js";

/**
 * @typedef {import("./probe/probeWithFetch.js").ProbeResult} ProbeResult
 */

export async function scanPorts(host, portsOrMin, max, options = {}) {
	// In the array overload the third argument is the options object. Shift it
	// into place before normalizing both overloads to one explicit port list.
	if (typeof max === "object" && max !== null) {
		options = max;
		max = undefined;
	}

	const ports = parseArgs(portsOrMin, max);
	return probeBatches(host, ports, options);
}
