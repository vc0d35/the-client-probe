import { PortState } from "./probeWithFetch.js";

const ICE_TIMEOUT_MS = 2000;
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

/**
 * Create a peer connection pointing at the given ports and return it with
 * the start timestamp.
 */
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
 * Collect per-port traffic from the connection's stats: for every
 * candidate pair that carried STUN requests, record the target port.
 */
async function collectReachablePorts(connection, reachable) {
	const stats = await connection.getStats();
	const remotePorts = new Map();
	const pairs = [];
	for (const report of stats.values()) {
		if (report.type === "remote-candidate") {
			remotePorts.set(report.id, report.port);
		}
		if (report.type === "candidate-pair" && report.requestsSent > 0) {
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
 * Probe one TCP port with a WebRTC ICE connectivity check.
 *
 * The port is planted as a remote ICE candidate; Chromium then opens a real
 * TCP connection to it and writes STUN bytes. If any candidate pair shows
 * requestsSent > 0, the connection was accepted — the port is open, no
 * matter what protocol the service speaks (HTTP, SSH, CORP-protected, ...).
 * If no traffic appears before the timeout, the port is closed.
 *
 * Unlike probeWithFetch this observes connect success directly, so it is
 * immune to CORP/ORB and non-HTTP responses — but it needs one
 * RTCPeerConnection per probe and only works for ports >= 1024. For
 * scanning many ports prefer probeBatchWithIce, which shares one
 * connection across 64+ ports.
 *
 * @param {string} host Hostname or IP literal.
 * @param {number} port TCP port number, 1024–65535.
 * @param {number} [timeoutMs=2000] How long to wait for traffic before
 *   classifying as closed. 500 ms is safe on loopback.
 * @returns {Promise<{host: string, port: number, state: string, durationMs: number}>}
 */
export async function probeWithIce(host, port, timeoutMs = ICE_TIMEOUT_MS) {
	const [result] = await probeBatchWithIce(host, [port], timeoutMs);
	return result;
}

/**
 * Probe many TCP ports with ICE connectivity checks, sharing one
 * RTCPeerConnection for the whole batch (one planted candidate per port).
 * This amortizes the connection setup and, crucially, the closed-port
 * timeout: a batch of closed ports costs one timeout, not one per port.
 *
 * Verified on Chrome 150 / macOS: pairs for open ports show requestsSent
 * within ~300 ms even with 64 candidates; refused ports never produce one.
 *
 * @param {string} host Hostname or IP literal.
 * @param {readonly number[]} ports TCP ports, each 1024–65535.
 * @param {number} [timeoutMs=2000] Per-batch deadline; "closed" is an
 *   absence-of-traffic verdict, so this bounds every closed port in the
 *   batch. 500 ms is safe on loopback; use ~1000 ms for LAN targets.
 * @returns {Promise<{host: string, port: number, state: string, durationMs: number}[]>}
 */
export async function probeBatchWithIce(
	host,
	ports,
	timeoutMs = ICE_TIMEOUT_MS,
) {
	if (typeof RTCPeerConnection === "undefined") {
		throw new Error(
			"probeBatchWithIce requires a browser with RTCPeerConnection",
		);
	}

	const started = performance.now();
	const connection = await startChecks(host, ports);

	try {
		const reachable = new Set();
		const deadlineAt = started + timeoutMs;
		while (reachable.size < ports.length && performance.now() < deadlineAt) {
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
