import { PortState } from "./probeWithFetch.js";

const ICE_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 100;

/**
 * Build a minimal SDP answer that plants one ICE candidate pointing at the
 * probe target. Chromium accepts literal IP candidates for ports >= 1024 on
 * local addresses; lower ports are rejected by libwebrtc's VerifyCandidate
 * ("Disallow all ports below 1024, except for 80 and 443 on public
 * addresses") — see p2p/base/ice_transport_internal.cc in webrtc/src
 * (https://webrtc.googlesource.com/src/+/main/p2p/base/ice_transport_internal.cc).
 */
function buildAnswerSdp({ mid, protocol, host, port }) {
	const candidate =
		protocol === "udp"
			? `a=candidate:1 1 udp 2130706431 ${host} ${port} typ host`
			: `a=candidate:1 1 tcp 2124414975 ${host} ${port} typ host tcptype passive`;

	return [
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
		candidate,
		"",
	].join("\r\n");
}

/**
 * Return the first ICE candidate pair report, or null if none exists yet.
 */
async function candidatePair(connection) {
	const stats = await connection.getStats();
	for (const report of stats.values()) {
		if (report.type === "candidate-pair") {
			return report;
		}
	}
	return null;
}

/**
 * Probe one TCP or UDP port with a WebRTC ICE connectivity check.
 *
 * The port is planted as a remote ICE candidate; Chromium then opens a real
 * connection to it and sends STUN bytes. The verdict depends on protocol:
 *
 * - TCP: a pair with requestsSent > 0 proves the connection was accepted —
 *   the port is open, no matter what protocol the service speaks (HTTP,
 *   SSH, CORP-protected, ...). No traffic before the timeout means closed.
 *   This channel is immune to CORP/ORB and non-HTTP responses.
 * - UDP: only a valid STUN reply (responsesReceived > 0) is informative —
 *   the port speaks STUN (OpenStun). Open, closed and filtered UDP ports
 *   are otherwise indistinguishable (no ICMP feedback reaches the browser),
 *   so everything else is Unknown.
 *
 * Limitations: ports must be >= 1024 and off Chromium's restricted-port
 * list; one RTCPeerConnection per probe.
 *
 * @param {string} host Hostname or IP literal.
 * @param {number} port TCP/UDP port number, 1024–65535.
 * @param {"tcp"|"udp"} [protocol="tcp"] Transport to probe.
 * @returns {Promise<{host: string, port: number, protocol: string, state: string, durationMs: number}>}
 */
export async function probeWithIce(host, port, protocol = "tcp") {
	if (typeof RTCPeerConnection === "undefined") {
		throw new Error("probeWithIce requires a browser with RTCPeerConnection");
	}

	const started = performance.now();
	const connection = new RTCPeerConnection({ iceServers: [] });
	const classify = (pair) => {
		if (pair?.responsesReceived > 0) return PortState.OpenStun;
		if (protocol === "tcp" && pair?.requestsSent > 0) return PortState.Open;
		return null;
	};
	const timeoutState =
		protocol === "tcp" ? PortState.Closed : PortState.Unknown;

	try {
		connection.createDataChannel("probe");
		await connection.setLocalDescription(await connection.createOffer());
		const mid = /a=mid:(\S+)/.exec(connection.localDescription.sdp)?.[1] ?? "0";
		await connection.setRemoteDescription({
			type: "answer",
			sdp: buildAnswerSdp({ mid, protocol, host, port }),
		});

		const deadlineAt = started + ICE_TIMEOUT_MS;
		while (performance.now() < deadlineAt) {
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			const state = classify(await candidatePair(connection));
			if (state) {
				return {
					host,
					port,
					protocol,
					state,
					durationMs: performance.now() - started,
				};
			}
		}

		return {
			host,
			port,
			protocol,
			state: timeoutState,
			durationMs: performance.now() - started,
		};
	} finally {
		connection.close();
	}
}
