/**
 * @param {object} [options]
 * @param {number} [options.requestsSent=0] requestsSent on the fake pair.
 * @param {number} [options.remotePort] When set, the fake also reports a
 *   remote-candidate with this port and links the pair to it, so batched
 *   probes can attribute the traffic to a port.
 * @param {(instances: object[]) => Promise<unknown>} fn The test body; gets
 *   every created fake instance for inspection.
 */
export async function withFakePeerConnection(
	{ requestsSent = 0, remotePort } = {},
	fn,
) {
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
			const entries = [];
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
		globalThis.RTCPeerConnection = original;
	}
}
