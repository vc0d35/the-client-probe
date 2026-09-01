const MIN_PORT = 0;
const MAX_PORT = 65535;

// TCP and UDP port fields are unsigned 16-bit integers.
function isValidPort(port) {
	return (
		typeof port === "number" &&
		Number.isInteger(port) &&
		port >= MIN_PORT &&
		port <= MAX_PORT
	);
}

function validatePorts(ports) {
	for (const port of ports) {
		if (!isValidPort(port)) {
			throw new RangeError(
				`Port must be an integer between ${MIN_PORT} and ${MAX_PORT}: ${port}`,
			);
		}
	}
}

export function parseArgs(portsOrMin, max) {
	// Array input is copied after validation so later caller mutations cannot
	// change work already handed to the scanner.
	if (typeof portsOrMin !== "number") {
		if (!Array.isArray(portsOrMin)) {
			throw new TypeError("ports must be an array or min/max numbers");
		}

		if (max !== undefined) {
			throw new TypeError("Do not provide max when ports is an array");
		}

		validatePorts(portsOrMin);
		return [...portsOrMin];
	}

	// Numeric input represents an inclusive range, so both bounds are required
	// and independently validated before allocating the result.
	if (!isValidPort(portsOrMin)) {
		throw new RangeError(
			`Port must be an integer between ${MIN_PORT} and ${MAX_PORT}: ${portsOrMin}`,
		);
	}

	if (!isValidPort(max)) {
		throw new RangeError(
			`Port must be an integer between ${MIN_PORT} and ${MAX_PORT}: ${max}`,
		);
	}

	if (portsOrMin > max) {
		throw new RangeError("Minimum port cannot be greater than maximum port");
	}

	return Array.from(
		{ length: max - portsOrMin + 1 },
		(_, index) => portsOrMin + index,
	);
}
