import { probeWithFetch } from "./probeWithFetch.js";
import { probeWithIce } from "./probeWithIce.js";

const BATCH_SIZE = 128;

/**
 * @typedef {{host: string, port: number, protocol: string, state: string, durationMs: number}} ProbeResult
 */

/**
 * Route each port to the best channels for it: fetch (TCP) below 1024
 * (libwebrtc rejects ICE candidates to low ports on local addresses), ICE
 * over both TCP and UDP above. Returns one result per transport.
 */
async function probePort(host, port) {
	if (port < 1024) {
		return [await probeWithFetch(host, port)];
	}
	return Promise.all([
		probeWithIce(host, port, "tcp"),
		probeWithIce(host, port, "udp"),
	]);
}

/**
 * @param {string} host Hostname or IP literal.
 * @param {number[][]} batches Port batches to probe.
 * @returns {Promise<ProbeResult[]>}
 */
async function probeBatchList(host, batches) {
	const [batch, ...remainingBatches] = batches;
	if (!batch) return [];

	const results = await Promise.all(batch.map((port) => probePort(host, port)));
	return [...results.flat(), ...(await probeBatchList(host, remainingBatches))];
}

/**
 * Probe ports in bounded batches while preserving their input order.
 * Ports >= 1024 yield two results each (TCP then UDP).
 *
 * @param {string} host Hostname or IP literal.
 * @param {readonly number[]} ports Ports to probe.
 * @returns {Promise<ProbeResult[]>}
 */
export function probeBatches(host, ports) {
	const batches = Array.from(
		{ length: Math.ceil(ports.length / BATCH_SIZE) },
		(_, index) => ports.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
	);

	return probeBatchList(host, batches);
}
