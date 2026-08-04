import { probeWithFetch } from "./probeWithFetch.js";
import { probeBatchWithIce } from "./probeWithIce.js";

const FETCH_CONCURRENCY = 128;
const ICE_BATCH_SIZE = 64;
const ICE_CONCURRENCY = 8;

/**
 * @typedef {{host: string, port: number, state: string, durationMs: number}} ProbeResult
 */

/**
 * Run `task` over `items` with a bounded worker pool: each worker takes the
 * next item as soon as it finishes its previous one, so a single slow item
 * never stalls the rest (no batch barrier).
 */
async function runPool(items, concurrency, task) {
	const results = new Array(items.length);
	let next = 0;

	async function worker() {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await task(items[index]);
		}
	}

	const workerCount = Math.max(1, Math.min(concurrency, items.length));
	await Promise.all(Array.from({ length: workerCount }, worker));
	return results;
}

/**
 * Probe ports, routing each to the best channel for it and keeping the
 * page responsive: fetch for ports < 1024 (libwebrtc rejects ICE candidates
 * to low ports on local addresses), batched ICE above. The two channels run
 * concurrently and use independent resource pools (HTTP sockets vs WebRTC
 * P2P sockets), so neither starves the other.
 *
 * @param {string} host Hostname or IP literal.
 * @param {readonly number[]} ports Ports to probe.
 * @param {object} [options]
 * @param {number} [options.fetchTimeoutMs] Forwarded to probeWithFetch.
 * @param {number} [options.iceTimeoutMs] Forwarded to probeBatchWithIce.
 * @returns {Promise<ProbeResult[]>} Results in the same order as `ports`.
 */
export async function probeBatches(host, ports, options = {}) {
	const lowPorts = [];
	const highPorts = [];
	for (const port of ports) {
		(port < 1024 ? lowPorts : highPorts).push(port);
	}

	const highBatches = Array.from(
		{ length: Math.ceil(highPorts.length / ICE_BATCH_SIZE) },
		(_, index) =>
			highPorts.slice(index * ICE_BATCH_SIZE, (index + 1) * ICE_BATCH_SIZE),
	);

	const [lowResults, highResults] = await Promise.all([
		runPool(lowPorts, FETCH_CONCURRENCY, (port) =>
			probeWithFetch(host, port, options.fetchTimeoutMs),
		),
		runPool(highBatches, ICE_CONCURRENCY, (batch) =>
			probeBatchWithIce(host, batch, options.iceTimeoutMs),
		).then((batches) => batches.flat()),
	]);

	// Merge back into input order.
	const results = [];
	let low = 0;
	let high = 0;
	for (const port of ports) {
		results.push(port < 1024 ? lowResults[low++] : highResults[high++]);
	}
	return results;
}
