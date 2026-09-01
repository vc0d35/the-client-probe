// Hermetic target servers for the e2e suite. Every server binds on loopback so
// the whole matrix runs offline, and the page is served from 127.0.0.1 too so
// the browser treats it as a secure context (WebRTC + fetch behave normally and
// Local Network Access never engages — the gate is strictly public -> local).

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";

// The repo root, so the page server can serve both e2e/harness.html and the
// library's source module tree (/src/index.js and its relative imports).
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".css": "text/css; charset=utf-8",
};

// Low ports (< 1024) that are NOT on Chromium's restricted list, so a real
// fetch to one is not short-circuited. Only reachable when the runtime can bind
// privileged ports (CI lowers net.ipv4.ip_unprivileged_port_start); otherwise
// low-port assertions skip.
const LOW_PORT_CANDIDATES = [888, 999, 900, 700, 456, 321];

function listen(server, port) {
	return new Promise((resolve, reject) => {
		const onError = (error) => {
			server.removeListener("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.removeListener("error", onError);
			resolve(server.address().port);
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, HOST);
	});
}

function closeServer(server) {
	return new Promise((resolve) => server.close(() => resolve()));
}

// Static file server rooted at the repo. Serves the harness page and the
// library module to the browser over one origin.
async function startPageServer() {
	const server = createHttpServer(async (req, res) => {
		try {
			const pathname = new URL(req.url, `http://${HOST}`).pathname;
			const relative = normalize(decodeURIComponent(pathname)).replace(
				/^(\.\.[/\\])+/,
				"",
			);
			const filePath = join(REPO_ROOT, relative);
			if (!filePath.startsWith(REPO_ROOT)) {
				res.writeHead(403).end();
				return;
			}
			const info = await stat(filePath);
			if (!info.isFile()) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, {
				"content-type": MIME[extname(filePath)] ?? "application/octet-stream",
			});
			createReadStream(filePath).pipe(res);
		} catch {
			res.writeHead(404).end();
		}
	});
	const port = await listen(server, 0);
	return { port, close: () => closeServer(server) };
}

// An HTTP server that answers 200. Doubles as the ICE-open target: libwebrtc
// only needs the TCP connection to be accepted to record requestsSent > 0.
async function startHttpOpen() {
	const server = createHttpServer((_req, res) => {
		res.writeHead(200, { "content-type": "text/plain" }).end("ok");
	});
	const port = await listen(server, 0);
	return { port, close: () => closeServer(server) };
}

// Accepts TCP connections but never writes a byte, so a fetch to it hangs until
// the caller's abort timeout fires -> open-silent.
async function startSilent() {
	const sockets = new Set();
	const server = createNetServer((socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => sockets.delete(socket));
	});
	const port = await listen(server, 0);
	return {
		port,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await closeServer(server);
		},
	};
}

// Bind an ephemeral port, read it, then release it — leaving a port the OS is
// unlikely to reassign immediately. Connections to it are refused -> closed.
async function findClosedPort() {
	const server = createNetServer();
	const port = await listen(server, 0);
	await closeServer(server);
	return port;
}

// Try to bind an open HTTP server on a non-restricted low port. Succeeds only
// where privileged binds are allowed; reports availability so tests can skip.
async function startLowOpen() {
	for (const candidate of LOW_PORT_CANDIDATES) {
		const server = createHttpServer((_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" }).end("ok");
		});
		try {
			await listen(server, candidate);
			return {
				port: candidate,
				available: true,
				close: () => closeServer(server),
			};
		} catch {
			await closeServer(server);
		}
	}
	return { port: null, available: false, close: async () => {} };
}

// Start the full set once and return their ports plus a single teardown.
export async function startServers() {
	const [page, httpOpen, silent, lowOpen] = await Promise.all([
		startPageServer(),
		startHttpOpen(),
		startSilent(),
		startLowOpen(),
	]);
	const closedHigh = await findClosedPort();

	return {
		host: HOST,
		pageBaseUrl: `http://${HOST}:${page.port}`,
		httpOpen: httpOpen.port,
		silent: silent.port,
		closedHigh,
		lowOpen: lowOpen.port,
		lowPortsAvailable: lowOpen.available,
		async stop() {
			await Promise.all([
				page.close(),
				httpOpen.close(),
				silent.close(),
				lowOpen.close(),
			]);
		},
	};
}
