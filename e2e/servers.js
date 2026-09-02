// All servers bind loopback. The page is served from 127.0.0.1 as well so it
// is a secure context and Local Network Access never engages.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".css": "text/css; charset=utf-8",
};

// Ports < 1024 that are not on Chromium's restricted list. Binding them needs
// privileges (CI lowers net.ipv4.ip_unprivileged_port_start); otherwise the
// low-port test skips.
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

// Serves e2e/harness.html and the /src module tree from one origin.
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

// Also the ICE-open target: libwebrtc only needs the TCP connect to succeed.
async function startHttpOpen() {
	const server = createHttpServer((_req, res) => {
		res.writeHead(200, { "content-type": "text/plain" }).end("ok");
	});
	const port = await listen(server, 0);
	return { port, close: () => closeServer(server) };
}

// Accepts connections but never responds: a fetch hangs until its abort fires.
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

// Bind an ephemeral port and release it; connections to it are then refused.
async function findClosedPort() {
	const server = createNetServer();
	const port = await listen(server, 0);
	await closeServer(server);
	return port;
}

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
