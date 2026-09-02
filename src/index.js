import { probeBatches } from "./probe/batch.js";
import { parseArgs } from "./utils/parseArgs.js";

export { PortState, probeWithFetch } from "./probe/probeWithFetch.js";
export { probeBatchWithIce, probeWithIce } from "./probe/probeWithIce.js";
export { RESTRICTED_PORTS } from "./probe/restrictedPorts.js";

export async function scanPorts(host, portsOrMin, max, options = {}) {
	// (host, ports[], options) form: the options object arrives in the max slot.
	if (typeof max === "object" && max !== null) {
		options = max;
		max = undefined;
	}
	const ports = parseArgs(portsOrMin, max);
	return probeBatches(host, ports, options);
}
