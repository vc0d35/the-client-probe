import { PortState } from "./probeWithFetch.js";

const POLL_INTERVAL_MS = 100;

/**
 * Build a minimal SDP answer that plants one ICE candidate per probe target.
 * Chromium accepts literal IP candidates for ports >= 1024 on local
 * addresses; lower ports are rejected by libwebrtc's VerifyCandidate
 * ("Disallow all ports below 1024, except for 80 and 443 on public
 * addresses") — see p2p/base/ice_transport_internal.cc in webrtc/src
 * (https://webrtc.googlesource.com/src/+/main/p2p/base/ice_transport_internal.cc).
 */
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

/**
 * Per-port connect evidence: only a candidate pair that actually SENT STUN
 * traffic proves the connect succeeded. Pair existence is not sufficient —
 * blocked sockets (restricted ports, P2P pool exhaustion) leave pairs
 * pending in "waiting" forever.
 */
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

/**
 * ICE-TCP checks are paced at ~65 ms per candidate per connection
 * (kWeakPingInterval = 48 ms plus per-tick overhead; 64 candidates → last
 * check at ~4.1 s), so the deadline must scale with batch size or
 * late-paced open ports look closed.
 */
const adaptiveTimeoutMs = (portCount) => portCount * 100 + 500;

/**
 * Probe one TCP port with a WebRTC ICE connectivity check (a one-port
 * probeBatchWithIce — see it for how detection works).
 *
 * Unlike probeWithFetch this observes connect success directly, so it is
 * immune to CORP/ORB and non-HTTP responses — but it needs one
 * RTCPeerConnection per probe and only works for ports >= 1024 that are
 * not on Chromium's restricted-port list (e.g. 6000, 5060, 6665-6669).
 *
 * @param {string} host Hostname or IP literal.
 * @param {number} port TCP port number, 1024–65535.
 * @param {number} [timeoutMs] How long to wait for traffic before
 *   classifying as closed. Default: adaptive to batch size.
 * @returns {Promise<import("./probeWithFetch.js").ProbeResult>}
 */
export async function probeWithIce(host, port, timeoutMs) {
	const [result] = await probeBatchWithIce(host, [port], timeoutMs);
	return result;
}

/**
 * Probe many TCP ports with ICE connectivity checks, sharing one
 * RTCPeerConnection per batch (one planted candidate per port), so a
 * batch of closed ports costs one timeout instead of one per port.
 *
 * The oracle is STUN traffic on the pair (requestsSent > 0); a silently
 * filtered port (SYN dropped, no RST) produces none, so "closed" means
 * refused-or-filtered. Restricted ports (6000, 5060, 6665-6669, ...) are
 * blocked at Chromium's P2P socket layer and always report closed.
 *
 * @param {string} host Hostname or IP literal.
 * @param {readonly number[]} ports TCP ports, each 1024–65535.
 * @param {number} [timeoutMs] Per-batch deadline; "closed" is an
 *   absence-of-traffic verdict, so this bounds every closed port in the
 *   batch. Default adapts to batch size (ports.length * 100 + 500 ms) to
 *   cover Chromium's check pacing; shorter explicit values are only safe
 *   for small batches.
 * @returns {Promise<import("./probeWithFetch.js").ProbeResult[]>}
 */
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
