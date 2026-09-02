import { PortState, probeWithFetch } from "./probeWithFetch.js";
import { probeBatchWithIce } from "./probeWithIce.js";
import { RESTRICTED_PORTS } from "./restrictedPorts.js";

const FETCH_CONCURRENCY = 128;
const ICE_BATCH_SIZE = 64;
const ICE_CONCURRENCY = 16;

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

// Ports < 1024 go through fetch because libwebrtc rejects ICE candidates to
// low ports on local addresses. Restricted ports are never probed.
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
