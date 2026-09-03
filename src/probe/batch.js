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

// Only Chromium's ICE stack dials loopback candidates; other engines drop them,
// so their loopback high ports fall back to fetch (which on those engines
// resolves for any open port, not just HTTP).
function isChromium() {
	const brands = globalThis.navigator?.userAgentData?.brands;
	if (brands) return brands.some((brand) => brand.brand === "Chromium");
	return /Chrome\//.test(globalThis.navigator?.userAgent ?? "");
}

const isLoopbackHost = (host) =>
	host === "localhost" || host === "::1" || host.startsWith("127.");

// Route each non-restricted port: fetch below 1024 (browsers reject ICE
// candidates to low local ports), batched ICE above. Where ICE can't reach the
// host's loopback, high ports use fetch too.
export async function probeBatches(host, ports, options = {}) {
	const { fetchTimeoutMs, iceTimeoutMs, onProgress } = options;
	const total = ports.length;
	let completed = 0;
	const track = (result) => {
		completed += 1;
		onProgress?.({ completed, total, result });
		return result;
	};

	const iceCanReachHost = isChromium() || !isLoopbackHost(host);
	const routeToFetch = (port) => port < 1024 || !iceCanReachHost;

	const fetchPorts = [];
	const icePorts = [];
	for (const port of ports) {
		if (RESTRICTED_PORTS.has(port)) continue;
		(routeToFetch(port) ? fetchPorts : icePorts).push(port);
	}

	const iceBatches = Array.from(
		{ length: Math.ceil(icePorts.length / ICE_BATCH_SIZE) },
		(_, index) =>
			icePorts.slice(index * ICE_BATCH_SIZE, (index + 1) * ICE_BATCH_SIZE),
	);

	const [fetchResults, iceResults] = await Promise.all([
		runPool(fetchPorts, FETCH_CONCURRENCY, async (port) =>
			track(await probeWithFetch(host, port, fetchTimeoutMs)),
		),
		runPool(iceBatches, ICE_CONCURRENCY, async (batch) =>
			(await probeBatchWithIce(host, batch, iceTimeoutMs)).map(track),
		).then((batches) => batches.flat()),
	]);

	const results = [];
	let fetchIndex = 0;
	let iceIndex = 0;
	for (const port of ports) {
		if (RESTRICTED_PORTS.has(port)) {
			results.push(
				track({ host, port, state: PortState.Restricted, durationMs: 0 }),
			);
		} else {
			results.push(
				routeToFetch(port)
					? fetchResults[fetchIndex++]
					: iceResults[iceIndex++],
			);
		}
	}
	return results;
}
