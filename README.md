# The Client Probe

A browser-based TCP port scanner for localhost and LANs, written in vanilla
JavaScript. No build step, no runtime dependencies — ship it to a page and
scan from the visitor's browser.

Built for developers who need to know what's listening on a user's machine
or network: fraud detection (remote-access tools), local service discovery,
security research.

It works against any routable host, but it is optimized for localhost and
LAN targets: the ICE channel's pacing (~15 ports/s/connection) and loopback
RTTs make local sweeps practical, and loopback is exempt from the
mixed-content blocking that hits plain-HTTP LAN targets fetched from an
HTTPS page. Note that from a *public* origin, Chrome's Local Network
Access permission still gates the fetch leg (ports < 1024) — see
*Local Network Access* below. For internet hosts, use it for targeted
checks on known ports rather than sweeps, and give the timeouts RTT
headroom.

## See it live

<https://the-client-probe.vercel.app/example/index.html> — the example page,
deployed on Vercel. **Use Chrome**: the ICE channel (ports ≥ 1024) is
Chromium-only for now, so on other engines those ports silently misreport
as closed. On Chrome 142+, scanning from this public origin will trigger
the Local Network Access permission prompt for the fetch leg (ports < 1024).

## Browser support

Developed and verified against Chrome 150 on MacOS. Firefox and Safari
are untested (see *Further work*).

## Usage

```sh
npm install the-client-probe
```

```js
import { scanPorts } from "the-client-probe";

// Explicit list:
const results = await scanPorts("127.0.0.1", [22, 80, 443, 3389, 8080]);

// Or an inclusive range:
const sweep = await scanPorts("127.0.0.1", 1024, 10000);
```

Each result is `{ host, port, state, durationMs }` with `state` one of:

| State | Meaning |
|---|---|
| `"open"` | Port is listening and responded (fetch) or accepted a TCP connection (ICE) |
| `"open-silent"` | Port accepted TCP but never sent response bytes (fetch only) |
| `"closed"` | Connection refused (or silently filtered, off-loopback) |
| `"restricted"` | On Chromium's port blocklist — unscannable by design, reported without probing |

### Options

```js
await scanPorts(host, ports, {
  fetchTimeoutMs: 500,   // hang timeout before "open-silent" (ports < 1024). Default 2000
  iceTimeoutMs: 2000,    // per-batch deadline (ports >= 1024). Default: adaptive to batch size
  onProgress: ({ completed, total, result }) => { /* live progress */ },
});
```

### Ready-made configs

**Detect remote-access tools** (largely based in the article:
[eBay was caught scanning visitors for these ports](https://nullsweep.com/why-is-this-website-port-scanning-me/)
via ThreatMetrix):

```js
const RAT_PORTS = [
  3389,           // RDP
  5900, 5901, 5902, 5903,  // VNC 
  5939,           // TeamViewer — daemon binds 5939, loopback only
  7070,           // AnyDesk
  5931, 5938, 5944, 5950,  // Ammyy/TeamViewer/WinVNC variants 
];

const hits = (await scanPorts("127.0.0.1", RAT_PORTS))
  .filter((r) => r.state === "open");
// → one batch, a few seconds
```

Verified 2026-08 against real installations: RDP (xrdp), VNC (Xtigervnc)
and AnyDesk were all detected as `open`; the TeamViewer daemon binds
`5939` on loopback only — detectable when scanning the user's own machine
(localhost), not remotely. AnyDesk's `6563` is an outbound relay port,
not a listener. RustDesk was dropped from the list entirely: its direct
listener is UDP 21119, invisible to a TCP scanner.

**Full system sweep with live progress:**

```js
await scanPorts("127.0.0.1", 1, 65535, {
  fetchTimeoutMs: 500,
  onProgress({ completed, total, result }) {
    progressEl.textContent = `scanned ${completed} / ${total}`;
    if (result.state === "open") listEl.textContent += `${result.port}\n`;
  },
});
// ~7–8 minutes on loopback; open ports appear as found
```

**Quick health check of common dev services:**

```js
const services = await scanPorts("127.0.0.1", [
  3000, 4200, 5173, 8000, 8080,           // web dev servers
  5432, 3306, 6379, 27017, 9200, 2375,    // databases, search, docker
]);
```

**Check a remote host**:

```js
// Replace with your target's IPv4 literal (avoids DNS and happy-eyeballs
// distortion). Give the fetch timeout RTT headroom (default 2000 ms is
// fine for most links).
const results = await scanPorts("203.0.113.10", [22, 80, 443, 8080, 9999], {
  fetchTimeoutMs: 1500,
});
```

### Single-port and batch APIs

```js
import { probeWithFetch, probeWithIce, probeBatchWithIce, RESTRICTED_PORTS } from "the-client-probe";

await probeWithFetch("127.0.0.1", 80);              // one port, fetch channel
await probeWithIce("127.0.0.1", 8080);              // one port, ICE channel
await probeBatchWithIce("127.0.0.1", [8080, 8081]); // one RTCPeerConnection per 64 ports

RESTRICTED_PORTS.has(6000); // true — Chromium's blocklist as a Set
```

## Methodology

Two probe channels, routed by port number:

- **ports < 1024 → fetch** 
- **ports ≥ 1024 → ICE**

### ICE probing

The target is planted as a remote candidate in a forged SDP answer
(`a=candidate:… tcp … typ host tcptype passive`). Chromium's ICE machinery
then opens a real TCP connection to it and sends STUN connectivity checks.
A candidate pair with `requestsSent > 0` in `getStats()` proves the
connection was accepted — **the port is open no matter what protocol the
service speaks** (HTTP, SSH, VNC, databases, CORP-protected apps). No
traffic by the deadline means closed.

One `RTCPeerConnection` carries 64 candidates (one per port), 16
connections run concurrently, and the batch deadline adapts to Chromium's
~65 ms/candidate check pacing.

### Fetch probing

A `no-cors` fetch with an abort timeout classifies by outcome: resolve →
`open`, `TimeoutError` → `open-silent`, rejection → `closed`. Fast
(~2 ms per closed port), but with known false negatives: open ports whose
response is CORP/ORB-blocked or not valid HTTP (SSH banners, binary
protocols) also reject — which is why ICE is the default above 1024.

## Local Network Access (LNA)

Since Chrome 142, requests from a **public origin** to loopback or private
addresses require a user-granted permission (secure contexts only). The
check runs *after* the TCP connect but *before* any request bytes are
sent — so closed ports never trigger it (their connect fails first) and
report `closed` normally in every state. Only open ports are affected:

| Permission state | Fetch leg, open ports | ICE leg (≥ 1024) |
|---|---|---|
| **Prompt shown, unanswered** | hang until our abort fires → reported `open-silent` — which here *means* open: only a completed connect can hang | unaffected |
| **Granted** | correct verdict | unaffected |
| **Denied** | connect succeeds, then blocked → fast rejection → misreported `closed` | unaffected |

Two consequences worth knowing:

- **During the prompt, `open-silent` is a positive signal**, not an
  ambiguous one — closed ports refuse instantly, so anything hanging is
  listening. Once the user decides, verdicts normalize: granted → `open`,
  denied → `closed`.
- **The ICE channel is not gated** (`kLocalNetworkAccessChecksWebRTC` is
  disabled by default), so ports ≥ 1024 scan correctly no matter what the
  user chooses — the reason this library defaults to ICE above 1024.

From localhost or LAN origins, LNA never engages at all — the gate is
strictly public → local.

## Limitations

- **Local Network Access (Chrome 142+):** from a public HTTPS origin, the fetch leg is permission-gated — see the LNA section above for the prompt-pending / granted / denied behavior matrix. From localhost/LAN origins nothing is gated.
- **Restricted ports are unscannable:** Chromium blocks ~80 well-known ports (22, 25, 53, 6000, 6665–6669, 10080, … — [`kRestrictedPorts` in `net/base/port_util.cc`](https://github.com/chromium/chromium/blob/main/net/base/port_util.cc)) before any network I/O, for both channels. The scanner reports these as `"restricted"` without probing (`RESTRICTED_PORTS` is exported for filtering). Note Chromium also enforces a second, server-pushed localhost blocklist (`kRestrictAbusePortsOnLocalhost`) whose contents aren't in the source tree — a port can be unscannable even when it's not in the static list.
- **Performance:** ICE checks are paced by Chromium (~65 ms/candidate/connection, not configurable from JS). A full 1–65535 sweep takes ~7–8 minutes; targeted lists take seconds. Closed ports cost a full batch deadline — that's the price of an absence-based verdict.
- **Background tabs throttle timers** (`setTimeout` clamps to ≥1 s), degrading the polling loop and deadlines. Scans slow down noticeably; keep the tab visible for full sweeps.
- **TCP only.** UDP has no transport feedback in the browser (no ICMP delivery) and real STUN servers reject browser ICE checks with foreign credentials — there is no honest UDP verdict available to a web page.
- **Ambiguous when off-loopback:** firewalled (silently dropped) ports look like `closed` to ICE and like `open-silent` to fetch.

## Further work

What would make this library more universal:

- **Web Worker execution** — escape background-tab timer throttling
- **Service fingerprinting** — identify *what* is on an open port (favicon/asset probing for known products, HTTP title extraction where the SOP allows)
- **LAN discovery helpers** — subnet/gateway heuristics for sweeping beyond localhost
- **Trickle-pipelined ICE** — continuous candidate feeding instead of batch waves (~40% faster sweeps, measured pacing floor)
- **Firefox/Safari support** — the fetch channel is portable; the ICE channel needs per-engine verification (WebKit has no LNA, different stats surface)

## Running the example

```sh
npm run example
```

This serves the repo locally and opens `example/index.html` in your
browser. The page runs a full `1–65535` sweep of `127.0.0.1` with tuned
timeouts (~7–8 minutes), showing a live `scanned X / 65535` counter and
color-coded results as they're found: green for `open`, amber for
`open-silent`, purple for `restricted`, dim gray for `closed`.

## Development

```sh
npm test          # node:test unit suite (mocked fetch + RTCPeerConnection)
npm run test:e2e  # Playwright e2e in real Chrome — see below
npm run lint      # biome check
npm run example   # demo page with live progress at /example/index.html
```

### End-to-end tests

`npm run test:e2e` runs the real library in a real Chrome (via Playwright)
against hermetic loopback servers, verifying the behavior the unit suite can
only mock: the ICE-TCP channel against real libwebrtc, and `no-cors` fetch
classification. Install the browser once with `npx playwright install
chromium`.

Chrome only for now (the ICE channel is Chromium-specific); Firefox/WebKit are
staged as commented projects in `playwright.config.js`. CI runs the suite as a
blocking job and lowers the unprivileged port floor so the `< 1024` fetch route
is exercised end-to-end; where a low port can't be bound (e.g. macOS), that one
test skips itself.
