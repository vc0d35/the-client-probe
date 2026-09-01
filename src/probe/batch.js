import { PortState, probeWithFetch } from "./probeWithFetch.js";
import { probeBatchWithIce } from "./probeWithIce.js";
import { RESTRICTED_PORTS } from "./restrictedPorts.js";

const FETCH_CONCURRENCY = 128;
const ICE_BATCH_SIZE = 64;
const ICE_CONCURRENCY = 16;

// Bounded worker pool: each worker claims the next index as soon as it frees up,
// so a slow item never stalls the rest. Results keep input order.
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

// Route each port to the channel that can reach it: fetch below 1024 (libwebrtc
// rejects ICE candidates to low local ports), batched ICE above, restricted
// ports reported without probing. The two channels run concurrently on
// independent socket pools so neither starves the other; results stay in the
// caller's order.
export async function probeBatches(host, ports, options = {}) {
	const { fetchTimeoutMs, iceTimeoutMs, onProgress } = options;
	const total = ports.length;
	let completed = 0;
	const track = (result) => {
		completed += 1;
		onProgress?.({ completed, total, result });
		return result;
	};

	const lowPorts = [];
	const highPorts = [];
	for (const port of ports) {
		if (RESTRICTED_PORTS.has(port)) continue;
		(port < 1024 ? lowPorts : highPorts).push(port);
	}

	const highBatches = Array.from(
		{ length: Math.ceil(highPorts.length / ICE_BATCH_SIZE) },
		(_, index) =>
			highPorts.slice(index * ICE_BATCH_SIZE, (index + 1) * ICE_BATCH_SIZE),
	);

	const [lowResults, highResults] = await Promise.all([
		runPool(lowPorts, FETCH_CONCURRENCY, async (port) =>
			track(await probeWithFetch(host, port, fetchTimeoutMs)),
		),
		runPool(highBatches, ICE_CONCURRENCY, async (batch) =>
			(await probeBatchWithIce(host, batch, iceTimeoutMs)).map(track),
		).then((batches) => batches.flat()),
	]);

	// Reinsert restricted ports and restore the caller's original order.
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
