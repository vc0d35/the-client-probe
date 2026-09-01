import { PortState } from "./probeWithFetch.js";

const POLL_INTERVAL_MS = 100;

// Construct the remote half of the negotiation without a second peer. The SDP
// only needs enough structure for Chromium to create an ICE transport and
// accept the planted candidates; this probe does not need DTLS or SCTP to
// complete.
function buildAnswerSdp({ mid, host, ports }) {
	const lines = [
		// Session-level preamble.
		"v=0",
		"o=- 0 0 IN IP4 127.0.0.1",
		"s=-",
		"t=0 0",
		// The application m-line matches the data channel in the local offer.
		"m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
		"c=IN IP4 0.0.0.0",
		`a=mid:${mid}`,
		// Syntactically valid remote ICE and DTLS parameters are required even
		// though no peer will authenticate or finish either protocol.
		"a=ice-ufrag:tfab",
		"a=ice-pwd:theclientprobe000000000000",
		`a=fingerprint:sha-256 ${"00:".repeat(31)}00`,
		"a=setup:active",
		"a=sctp-port:5000",
	];

	// A passive ICE-TCP candidate says the remote side accepts connections, so
	// the local active candidate initiates TCP. Unique foundations avoid grouping
	// the fabricated endpoints under one ICE foundation, while descending remote
	// priorities bias their candidate pairs toward input order.
	for (const [index, port] of ports.entries()) {
		lines.push(
			`a=candidate:${index + 1} 1 tcp ${2124414975 - index} ${host} ${port} typ host tcptype passive`,
		);
	}
	lines.push("");
	return lines.join("\r\n");
}

async function startChecks(host, ports) {
	// No configured STUN or TURN server is needed because the forged answer
	// supplies every remote address directly. ICE still sends STUN connectivity
	// checks to those addresses.
	const connection = new RTCPeerConnection({ iceServers: [] });

	// Without a track or data channel createOffer() has no m-line and therefore
	// no ICE transport to which the remote candidates could be attached.
	connection.createDataChannel("probe");
	await connection.setLocalDescription(await connection.createOffer());

	// Reuse the browser-generated MID so the answer's media section is matched
	// to the transport created by the offer.
	const mid = /a=mid:(\S+)/.exec(connection.localDescription.sdp)?.[1] ?? "0";

	// Applying the answer installs all candidates and starts ICE checks.
	await connection.setRemoteDescription({
		type: "answer",
		sdp: buildAnswerSdp({ mid, host, ports }),
	});
	return connection;
}

async function collectReachablePorts(connection, reachable) {
	const stats = await connection.getStats();
	const remotePorts = new Map();
	const pairs = [];

	// Collect both report types before joining them so port attribution does not
	// depend on the order in which the stats report yields its entries.
	for (const report of stats.values()) {
		if (report.type === "remote-candidate") {
			remotePorts.set(report.id, report.port);
		} else if (report.type === "candidate-pair" && report.requestsSent > 0) {
			pairs.push(report);
		}
	}

	// Pair creation alone is not evidence because ICE forms pairs before checking
	// connectivity. requestsSent counts transmitted connectivity checks; ICE-TCP
	// establishes TCP before it can send that framed STUN request.
	for (const pair of pairs) {
		const port = remotePorts.get(pair.remoteCandidateId);
		if (port !== undefined) {
			reachable.add(port);
		}
	}
}

// Chromium's current libwebrtc defaults pace weak-connectivity checks rather
// than sending every check at once. Scale the heuristic deadline by candidate
// count, with a fixed setup margin, to reduce premature classification of
// candidates near the end of the checklist.
const adaptiveTimeoutMs = (portCount) => portCount * 100 + 500;

// Keep the single-port operation on the same code path as batching so both
// APIs use identical SDP, stats, timeout, and cleanup behavior.
export async function probeWithIce(host, port, timeoutMs) {
	const [result] = await probeBatchWithIce(host, [port], timeoutMs);
	return result;
}

export async function probeBatchWithIce(host, ports, timeoutMs) {
	if (typeof RTCPeerConnection === "undefined") {
		throw new Error(
			"probeBatchWithIce requires a browser with RTCPeerConnection",
		);
	}

	// Duplicate input ports produce duplicate output rows but only one distinct
	// endpoint must become reachable before the batch can finish early.
	const deadline = timeoutMs ?? adaptiveTimeoutMs(ports.length);
	const pending = new Set(ports).size;
	const started = performance.now();
	const connection = await startChecks(host, ports);

	try {
		const reachable = new Set();
		const deadlineAt = started + deadline;

		// Reachable ports accumulate monotonically. If any target remains unobserved,
		// the loop runs to the shared deadline; if all are observed, it exits early.
		while (reachable.size < pending && performance.now() < deadlineAt) {
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			await collectReachablePorts(connection, reachable);
		}

		// The measurement belongs to the shared operation, so every row receives
		// the batch duration rather than an artificial per-candidate duration.
		const durationMs = performance.now() - started;
		return ports.map((port) => ({
			host,
			port,
			state: reachable.has(port) ? PortState.Open : PortState.Closed,
			durationMs,
		}));
	} finally {
		// Once setup has succeeded, release the P2P sockets after classification or
		// after an error in the polling block.
		connection.close();
	}
}
