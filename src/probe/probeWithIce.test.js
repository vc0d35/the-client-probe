import assert from "node:assert/strict";
import test from "node:test";

import { PortState, probeWithIce } from "../index.js";

/**
 * Install a fake RTCPeerConnection whose getStats() reports the given
 * candidate-pair traffic, run `fn`, then restore the global.
 */
async function withFakePeerConnection({ requestsSent }, fn) {
	const instances = [];
	const original = globalThis.RTCPeerConnection;

	globalThis.RTCPeerConnection = class {
		constructor() {
			this.localDescription = null;
			this.remoteDescription = null;
			this.closed = false;
			instances.push(this);
		}

		createDataChannel() {}

		async createOffer() {
			return { type: "offer", sdp: "v=0\r\na=mid:0\r\n" };
		}

		async setLocalDescription(description) {
			this.localDescription = description;
		}

		async setRemoteDescription(description) {
			this.remoteDescription = description;
		}

		async getStats() {
			return new Map([
				[
					"pair",
					{ type: "candidate-pair", requestsSent, responsesReceived: 0 },
				],
			]);
		}

		close() {
			this.closed = true;
		}
	};

	try {
		return await fn(instances);
	} finally {
		globalThis.RTCPeerConnection = original;
	}
}

test("probeWithIce classifies candidate-pair traffic as open", async () => {
	await withFakePeerConnection({ requestsSent: 1 }, async (instances) => {
		const result = await probeWithIce("127.0.0.1", 8080);

		assert.equal(result.state, PortState.Open);
		assert.equal(result.port, 8080);
		assert.equal(typeof result.durationMs, "number");

		const pc = instances[0];
		assert.ok(pc.closed, "the peer connection is closed afterwards");
		assert.match(
			pc.remoteDescription.sdp,
			/a=candidate:1 1 tcp 2124414975 127\.0\.0\.1 8080 typ host tcptype passive/,
		);
		assert.match(pc.remoteDescription.sdp, /a=setup:active/);
	});
});

test("probeWithIce classifies no traffic as closed", async () => {
	await withFakePeerConnection({ requestsSent: 0 }, async () => {
		const result = await probeWithIce("127.0.0.1", 8080);

		assert.equal(result.state, PortState.Closed);
		assert.ok(result.durationMs >= 2000, "waits out the full timeout");
	});
});
