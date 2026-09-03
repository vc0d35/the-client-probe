# The Client Probe

A TCP port scanner that runs in the browser. Vanilla JavaScript, no build
step, no runtime dependencies. It scans localhost, LAN hosts, or any
routable IP from the visitor's browser.

Demo: <https://the-client-probe.vercel.app/example/index.html> (Chrome or
Firefox).

## Browser support

| Browser | < 1024 | Loopback >= 1024 | LAN / remote >= 1024 |
|---|---|---|---|
| Chrome / Chromium | fetch | ICE | ICE |
| Firefox | fetch | fetch | ICE |
| Safari | fetch | fetch | untested |

Chromium is fully verified (Chrome 150 on macOS, Playwright Chromium on
Linux in CI). Firefox is supported through a different split: its WebRTC
stack refuses to dial loopback candidates, so loopback ports >= 1024 fall
back to fetch, while LAN and remote ports >= 1024 use ICE as on Chromium.
Firefox's fetch is more lenient than Chromium's, so that fallback still
detects non-HTTP services (see *How it works*). Safari is untested and
routes like Firefox. The engine is chosen at runtime from `navigator`.

## Install

```sh
npm install the-client-probe
```

## Usage

```js
import { scanPorts } from "the-client-probe";

// Explicit list
const results = await scanPorts("127.0.0.1", [22, 80, 443, 3389, 8080]);

// Inclusive range
const sweep = await scanPorts("127.0.0.1", 1024, 10000);
```

Every result is `{ host, port, state, durationMs }`. `state` is one of:

| State | Meaning |
|---|---|
| `open` | The port accepted a TCP connection (ICE) or responded over it (fetch). |
| `open-silent` | The port accepted a TCP connection but sent nothing before the timeout. Fetch channel only. |
| `closed` | The connection was refused, or no traffic was seen before the deadline. |
| `restricted` | The port is on Chromium's blocklist. Reported without probing. |

### Options

```js
await scanPorts(host, ports, {
  fetchTimeoutMs: 2000,
  iceTimeoutMs: undefined,
  onProgress: ({ completed, total, result }) => {},
});
```

| Option | Default | Applies to | Description |
|---|---|---|---|
| `fetchTimeoutMs` | `2000` | ports < 1024 | How long a fetch may hang before the port is classified `open-silent`. |
| `iceTimeoutMs` | adaptive | ports >= 1024 | Deadline for one ICE batch of up to 64 ports. The default is `batchSize * 100 + 500` ms. |
| `onProgress` | none | all | Called once per port as results arrive. `completed` and `total` count ports, `result` is the port's result object. |

### Lower-level API

```js
import {
  probeWithFetch,
  probeWithIce,
  probeBatchWithIce,
  RESTRICTED_PORTS,
  PortState,
} from "the-client-probe";

await probeWithFetch("127.0.0.1", 80, 2000);       // one port, fetch channel
await probeWithIce("127.0.0.1", 8080, 1000);       // one port, ICE channel
await probeBatchWithIce("127.0.0.1", [8080, 8081]); // one RTCPeerConnection for the batch

RESTRICTED_PORTS.has(6000); // true
PortState.Open;             // "open"
```

`scanPorts` skips restricted ports and routes by port number and target.
The lower-level functions do not: `probeWithFetch` works on any port, and
`probeWithIce` / `probeBatchWithIce` work on ports >= 1024 (browsers reject
ICE candidates to lower local ports) and, on non-Chromium engines, only for
non-loopback hosts. Prefer `scanPorts` for cross-engine coverage.

## Examples

Remote-access tools:

```js
const RAT_PORTS = [
  3389,                    // RDP
  5900, 5901, 5902, 5903,  // VNC
  5939,                    // TeamViewer (binds loopback only)
  7070,                    // AnyDesk
  5931, 5938, 5944, 5950,  // Ammyy / TeamViewer / WinVNC variants
];

const hits = (await scanPorts("127.0.0.1", RAT_PORTS))
  .filter((r) => r.state === "open");
```

Checked in 2026-08 against real installs: xrdp, TigerVNC and AnyDesk were
reported `open`. TeamViewer listens on loopback only, so it is detectable
from the user's own machine but not from another host. RustDesk is not on
the list because its direct listener is UDP.

Common development services:

```js
const services = await scanPorts("127.0.0.1", [
  3000, 4200, 5173, 8000, 8080,          // web dev servers
  5432, 3306, 6379, 27017, 9200, 2375,   // databases, search, docker
]);
```

Full sweep with live progress:

```js
await scanPorts("127.0.0.1", 1, 65535, {
  fetchTimeoutMs: 500,
  onProgress({ completed, total, result }) {
    progressEl.textContent = `scanned ${completed} / ${total}`;
    if (result.state === "open") listEl.textContent += `${result.port}\n`;
  },
});
```

A full sweep of loopback takes about 7 to 8 minutes in Chrome.

Remote host:

```js
// Use an IP literal to avoid DNS and happy-eyeballs effects.
const results = await scanPorts("203.0.113.10", [22, 80, 443, 8080, 9999], {
  fetchTimeoutMs: 1500,
});
```

## How it works

Ports are split by number and by target. Ports below 1024 go through
`fetch`; ports at or above 1024 go through WebRTC ICE, except that
non-Chromium engines route loopback high ports through fetch too, because
their ICE cannot reach loopback. Restricted ports are reported without any
network I/O. The channels run concurrently and results keep the caller's
order.

### Fetch channel (ports < 1024)

A `no-cors` fetch to `http://host:port/` with an abort timeout. The outcome
classifies the port:

- Resolved (opaque response): `open`
- `TimeoutError` from the abort signal: `open-silent`
- Any other rejection: `closed`

This is fast, about 2 ms per closed port on loopback. On Chromium the
`closed` bucket is lossy: an open port that speaks something other than HTTP
or whose response is blocked by CORP/ORB also rejects and is reported
`closed`, which is why Chromium uses ICE above 1024. Firefox's `no-cors`
fetch is more lenient and resolves for any open port that sends bytes, HTTP
or not, so its loopback fallback keeps that coverage without ICE. A port
that accepts a connection then stays silent reads as `open-silent` on both;
one that accepts then immediately resets reads as `closed`.

### ICE channel (ports >= 1024)

An `RTCPeerConnection` is created with a data channel, and a forged SDP
answer plants one passive ICE-TCP candidate per target port. There is no
real peer. The browser's ICE agent opens a TCP connection to each candidate
and sends STUN connectivity checks. The library polls `getStats()` and
treats a candidate pair whose check is in flight (state `in-progress` or
`succeeded`) as proof the connection was accepted, so the port is `open`
regardless of the protocol behind it. This state signal works on both
engines; `requestsSent`, the older signal, is Chromium-only. No such pair by
the deadline means `closed`. Firefox will not dial loopback candidates, so
loopback high ports never reach this channel.

One connection carries up to 64 ports and 16 connections run in parallel.
Browsers pace ICE-TCP checks (roughly 65 ms per candidate on Chromium),
which is why the default batch deadline grows with batch size and why a
batch of closed ports always costs the full deadline.

### Restricted ports

Chromium refuses connections to a fixed list of well-known ports (22, 25,
53, 6000, 6665 to 6669, 10080 and others; `kRestrictedPorts` in
[`net/base/port_util.cc`](https://github.com/chromium/chromium/blob/main/net/base/port_util.cc))
before any network I/O, on both channels. The scanner reports them as
`restricted` and exports the list as `RESTRICTED_PORTS`. Chromium also
applies a second, server-pushed localhost blocklist that is not in the
source tree, so a port can be unscannable even when it is not in the
static list.

## Caveats

- **Local Network Access (Chrome 142+).** From a public origin, requests to
  loopback and private addresses require a user permission. The check
  happens after the TCP connect and before any bytes are sent, and it
  applies to the fetch channel only. Closed ports are unaffected because
  their connect fails first. For open ports below 1024: while the prompt
  is unanswered the fetch hangs and reports `open-silent`, if granted it
  reports `open`, if denied it reports `closed`. The ICE channel is not
  gated. From localhost or LAN origins nothing is gated.
- **Firefox loopback uses fetch.** Firefox's ICE cannot dial loopback, so
  loopback ports >= 1024 fall back to fetch. That is silent and handles
  non-HTTP services, but a port that accepts then resets without sending is
  read as `closed`. LAN and remote high ports use ICE as on Chromium.
- **Mixed content.** An HTTPS page cannot fetch plain HTTP from a LAN
  address, so the fetch channel does not work against LAN targets from an
  HTTPS origin. Loopback is exempt. This is a further reason LAN high ports
  use ICE, which is unaffected.
- **Filtered ports look different per channel.** Off loopback, a firewall
  that silently drops packets reports `closed` on ICE and `open-silent` on
  fetch.
- **Speed is bounded by Chromium's ICE pacing.** It is not configurable
  from JavaScript. Targeted lists take seconds; a 1 to 65535 sweep takes
  minutes.
- **Background tabs throttle timers** to one second or more, which slows
  the polling loop and distorts deadlines. Keep the tab visible for long
  scans.
- **TCP only.** The browser gives no feedback for UDP, so there is no
  honest UDP verdict.
- **Remote hosts.** The scanner works against any routable IP, but give
  the fetch timeout headroom for the round-trip time and prefer targeted
  lists over sweeps.

## Development

```sh
npm test          # unit tests (node:test, mocked fetch and RTCPeerConnection)
npm run test:e2e  # Playwright tests in real Chrome and Firefox
npm run lint      # biome check
npm run example   # serves the repo and opens example/index.html
```

The e2e suite runs the library in Chrome and Firefox against loopback
servers started by the test harness. Install the browsers once with
`npx playwright install chromium firefox`. The loopback ICE specs run on
Chromium only, since Firefox routes those ports to fetch. CI runs the suite
on Linux and lowers the unprivileged port floor so the fetch route for ports
below 1024 is covered; where a low port cannot be bound that test skips
itself. A WebKit project is present but commented out in
`playwright.config.js`.
