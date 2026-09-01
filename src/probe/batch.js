import { PortState, probeWithFetch } from "./probeWithFetch.js";
import { probeBatchWithIce } from "./probeWithIce.js";
import { RESTRICTED_PORTS } from "./restrictedPorts.js";

const FETCH_CONCURRENCY = 128;
const ICE_BATCH_SIZE = 64;
const ICE_CONCURRENCY = 16;

/**
 * @typedef {{host: string, port: number, state: "open"|"open-silent"|"closed"|"restricted", durationMs: number}} ProbeResult
 */

// Run tasks through a bounded number of workers. Workers claim indices before
// awaiting, so each item is claimed once while results retain input order.
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

	// For non-empty input, never spawn more workers than items. Empty input uses
	// one no-op worker and still resolves to an empty result array.
	const workerCount = Math.max(1, Math.min(concurrency, items.length));
	await Promise.all(Array.from({ length: workerCount }, worker));
	return results;
}

export async function probeBatches(host, ports, options = {}) {
	const { fetchTimeoutMs, iceTimeoutMs, onProgress } = options;
	const total = ports.length;
	let completed = 0;

	// Both worker pools report through the same counter. ICE results reach this
	// function together when their shared connection finishes.
	const track = (result) => {
		completed += 1;
		onProgress?.({ completed, total, result });
		return result;
	};

	// libwebrtc rejects passive remote candidates below port 1024, except ports
	// 80 and 443 on public addresses. Route the entire low range through fetch so
	// behavior does not depend on classifying the target address. Remove static
	// Chromium-restricted ports because both fetch and its P2P path reject them.
	const lowPorts = [];
	const highPorts = [];
	for (const port of ports) {
		if (RESTRICTED_PORTS.has(port)) continue;
		(port < 1024 ? lowPorts : highPorts).push(port);
	}

	// Put at most 64 remote candidates in each peer connection. This amortizes
	// connection setup and, more importantly, shares one deadline across closed
	// ports instead of waiting once per port.
	const highBatches = Array.from(
		{ length: Math.ceil(highPorts.length / ICE_BATCH_SIZE) },
		(_, index) =>
			highPorts.slice(index * ICE_BATCH_SIZE, (index + 1) * ICE_BATCH_SIZE),
	);

	// Start the fetch and ICE work together, with a separate concurrency limit
	// for each channel so scheduling in one does not gate scheduling in the other.
	const [lowResults, highResults] = await Promise.all([
		runPool(lowPorts, FETCH_CONCURRENCY, async (port) =>
			track(await probeWithFetch(host, port, fetchTimeoutMs)),
		),
		runPool(highBatches, ICE_CONCURRENCY, async (batch) =>
			(await probeBatchWithIce(host, batch, iceTimeoutMs)).map(track),
		).then((batches) => batches.flat()),
	]);

	// Each pool preserves its filtered input order. Walk the original list to
	// reinsert restricted ports and restore the caller's ordering.
	const results = [];
	let low = 0;
	let high = 0;
	for (const port of ports) {
		if (RESTRICTED_PORTS.has(port)) {
			results.push(
				track({ host, port, state: PortState.Restricted, durationMs: 0 }),
			);
		} else {
			results.push(port < 1024 ? lowResults[low++] : highResults[high++]);
		}
	}
	return results;
}
