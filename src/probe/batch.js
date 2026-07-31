import { probeWithFetch } from "./probeWithFetch.js";

const BATCH_SIZE = 128;

/**
 * @typedef {{host: string, port: number, state: string, durationMs: number}} ProbeResult
 */

/**
 * @param {string} host Hostname or IP literal.
 * @param {number[][]} batches Port batches to probe.
 * @returns {Promise<ProbeResult[]>}
 */
async function probeBatchList(host, batches) {
	const [batch, ...remainingBatches] = batches;
	if (!batch) return [];

	const results = await Promise.all(
		batch.map((port) => probeWithFetch(host, port)),
	);
	return [...results, ...(await probeBatchList(host, remainingBatches))];
}

/**
 * Probe ports in bounded batches while preserving their input order.
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
