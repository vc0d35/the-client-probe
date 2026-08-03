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
function buildAnswerSdp({ mid, host, port }) {
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
		`a=candidate:1 1 tcp 2124414975 ${host} ${port} typ host tcptype passive`,
		"",
	].join("\r\n");
}

/**
 * Report whether any ICE candidate pair carried STUN traffic.
 */
async function candidatePairSentTraffic(pc) {
	const stats = await pc.getStats();
	for (const report of stats.values()) {
		if (report.type === "candidate-pair" && report.requestsSent > 0) {
			return true;
		}
	}
	return false;
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
 * RTCPeerConnection per probe and only works for ports >= 1024.
 *
 * @param {string} host Hostname or IP literal.
 * @param {number} port TCP port number, 1024–65535.
 * @returns {Promise<{host: string, port: number, state: string, durationMs: number}>}
 */
export async function probeWithIce(host, port) {
	if (typeof RTCPeerConnection === "undefined") {
		throw new Error("probeWithIce requires a browser with RTCPeerConnection");
	}

	const started = performance.now();
	const connection = new RTCPeerConnection({ iceServers: [] });

	try {
		connection.createDataChannel("probe");
		await connection.setLocalDescription(await connection.createOffer());
		const mid = /a=mid:(\S+)/.exec(connection.localDescription.sdp)?.[1] ?? "0";
		await connection.setRemoteDescription({
			type: "answer",
			sdp: buildAnswerSdp({ mid, host, port }),
		});

		const deadlineAt = started + ICE_TIMEOUT_MS;
		while (performance.now() < deadlineAt) {
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			if (await candidatePairSentTraffic(connection)) {
				return {
					host,
					port,
					state: PortState.Open,
					durationMs: performance.now() - started,
				};
			}
		}

		return {
			host,
			port,
			state: PortState.Closed,
			durationMs: performance.now() - started,
		};
	} catch (error) {
		console.error("Error while trying to probe port with ICE:", error);
	} finally {
		connection.close();
	}
}
