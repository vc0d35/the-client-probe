import assert from "node:assert/strict";
import test from "node:test";

import { PortState, probeWithIce } from "../index.js";
import { withFakePeerConnection } from "../testing/mockPeerConnection.js";

test("probeWithIce classifies candidate-pair traffic as open", async () => {
	await withFakePeerConnection(
		{ requestsSent: 1, remotePort: 8080 },
		async (instances) => {
			const result = await probeWithIce("127.0.0.1", 8080);

			assert.equal(result.state, PortState.Open);
			assert.equal(result.port, 8080);
			assert.equal(typeof result.durationMs, "number");

			const connection = instances[0];
			assert.ok(connection.closed, "the peer connection is closed afterwards");
			assert.match(
				connection.remoteDescription.sdp,
				/a=candidate:1 1 tcp 2124414975 127\.0\.0\.1 8080 typ host tcptype passive/,
			);
			assert.match(connection.remoteDescription.sdp, /a=setup:active/);
		},
	);
});

test("probeWithIce classifies no traffic as closed", async () => {
	await withFakePeerConnection({ requestsSent: 0 }, async () => {
		const result = await probeWithIce("127.0.0.1", 8080);

		assert.equal(result.state, PortState.Closed);
		assert.ok(result.durationMs >= 2000, "waits out the full timeout");
	});
});
