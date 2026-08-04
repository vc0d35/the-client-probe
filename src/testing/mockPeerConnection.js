/**
 * @param {object} [options]
 * @param {number} [options.requestsSent=0] requestsSent on the fake pair.
 * @param {(instances: object[]) => Promise<unknown>} fn The test body; gets
 *   every created fake instance for inspection.
 */
export async function withFakePeerConnection({ requestsSent = 0 } = {}, fn) {
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
				["pair", { type: "candidate-pair", requestsSent }],
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
