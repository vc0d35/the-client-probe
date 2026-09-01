// Replace the browser API with the smallest stateful implementation needed by
// the probe. The returned stats preserve the real remote-candidate/candidate-
// pair join so tests exercise port attribution instead of bypassing it.
export async function withFakePeerConnection(
	{ requestsSent = 0, remotePort } = {},
	fn,
) {
	const instances = [];
	const original = globalThis.RTCPeerConnection;

	globalThis.RTCPeerConnection = class {
		constructor() {
			// Retain descriptions and lifecycle state for assertions made after the
			// probe closes the connection.
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
			const entries = [];
			// Omitting the remote candidate simulates a pair that cannot be
			// attributed to a target port.
			if (remotePort !== undefined) {
				entries.push([
					"remote",
					{ type: "remote-candidate", id: "cand1", port: remotePort },
				]);
			}
			entries.push([
				"pair",
				{
					type: "candidate-pair",
					remoteCandidateId: "cand1",
					requestsSent,
				},
			]);
			return new Map(entries);
		}

		close() {
			this.closed = true;
		}
	};

	try {
		return await fn(instances);
	} finally {
		// Avoid leaking the fake into subsequent tests.
		globalThis.RTCPeerConnection = original;
	}
}
