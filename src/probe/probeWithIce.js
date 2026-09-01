import { PortState } from "./probeWithFetch.js";

const POLL_INTERVAL_MS = 100;

// Forge an SDP answer (there is no second peer) that plants one passive ICE-TCP
// candidate per target port. libwebrtc rejects candidates to ports < 1024 on
// local addresses (VerifyCandidate), which is why batch.js sends the low range
// through fetch instead.
function buildAnswerSdp({ mid, host, ports }) {
	const lines = [
		"v=0",
		"o=- 0 0 IN IP4 127.0.0.1",
		"s=-",
		"t=0 0",
		"m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
		"c=IN IP4 0.0.0.0",
		`a=mid:${mid}`,
		"a=ice-ufrag:tfab",
		"a=ice-pwd:theclientprobe000000000000",
		`a=fingerprint:sha-256 ${"00:".repeat(31)}00`,
		"a=setup:active",
		"a=sctp-port:5000",
	];
	for (const [index, port] of ports.entries()) {
		lines.push(
			`a=candidate:${index + 1} 1 tcp ${2124414975 - index} ${host} ${port} typ host tcptype passive`,
		);
	}
	lines.push("");
	return lines.join("\r\n");
}

async function startChecks(host, ports) {
	const connection = new RTCPeerConnection({ iceServers: [] });
	connection.createDataChannel("probe"); // an m-line is required for ICE to run
	await connection.setLocalDescription(await connection.createOffer());
	const mid = /a=mid:(\S+)/.exec(connection.localDescription.sdp)?.[1] ?? "0";
	await connection.setRemoteDescription({
		type: "answer",
		sdp: buildAnswerSdp({ mid, host, ports }),
	});
	return connection;
}

// Open-port oracle: a candidate pair counts only once it has actually sent STUN
// traffic (requestsSent > 0). Pairs are formed before connectivity is checked,
// so pair existence alone proves nothing — a blocked socket leaves its pair
// waiting forever.
async function collectReachablePorts(connection, reachable) {
	const stats = await connection.getStats();
	const remotePorts = new Map();
	const pairs = [];
	for (const report of stats.values()) {
		if (report.type === "remote-candidate") {
			remotePorts.set(report.id, report.port);
		} else if (report.type === "candidate-pair" && report.requestsSent > 0) {
			pairs.push(report);
		}
	}
	for (const pair of pairs) {
		const port = remotePorts.get(pair.remoteCandidateId);
		if (port !== undefined) {
			reachable.add(port);
		}
	}
}

// libwebrtc paces ICE-TCP checks at ~65 ms per candidate per connection, so the
// deadline must grow with batch size or late-checked open ports look closed.
const adaptiveTimeoutMs = (portCount) => portCount * 100 + 500;

export async function probeWithIce(host, port, timeoutMs) {
	const [result] = await probeBatchWithIce(host, [port], timeoutMs);
	return result;
}

// One RTCPeerConnection carries the whole batch (one planted candidate per
// port), so a batch of closed ports costs a single shared deadline instead of
// one timeout each. "closed" is an absence-of-traffic verdict, so a silently
// filtered port is indistinguishable from a refused one.
export async function probeBatchWithIce(host, ports, timeoutMs) {
	if (typeof RTCPeerConnection === "undefined") {
		throw new Error(
			"probeBatchWithIce requires a browser with RTCPeerConnection",
		);
	}

	const deadline = timeoutMs ?? adaptiveTimeoutMs(ports.length);
	// A Set collapses duplicate ports; without this the loop below would
	// never exit early for duplicated input and always burn the deadline.
	const pending = new Set(ports).size;
	const started = performance.now();
	const connection = await startChecks(host, ports);

	try {
		const reachable = new Set();
		const deadlineAt = started + deadline;
		while (reachable.size < pending && performance.now() < deadlineAt) {
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			await collectReachablePorts(connection, reachable);
		}

		const durationMs = performance.now() - started;
		return ports.map((port) => ({
			host,
			port,
			state: reachable.has(port) ? PortState.Open : PortState.Closed,
			durationMs,
		}));
	} finally {
		connection.close();
	}
}
