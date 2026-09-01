import { probeBatches } from "./probe/batch.js";
import { parseArgs } from "./utils/parseArgs.js";

export { PortState, probeWithFetch } from "./probe/probeWithFetch.js";
export { probeBatchWithIce, probeWithIce } from "./probe/probeWithIce.js";
export { RESTRICTED_PORTS } from "./probe/restrictedPorts.js";

export async function scanPorts(host, portsOrMin, max, options = {}) {
	// Two call shapes: (host, ports[], options) and (host, min, max, options).
	// In the array form the third argument is the options object — shift it.
	if (typeof max === "object" && max !== null) {
		options = max;
		max = undefined;
	}
	const ports = parseArgs(portsOrMin, max);
	return probeBatches(host, ports, options);
}
