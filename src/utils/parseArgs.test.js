import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "./parseArgs.js";

test("parses explicit ports and inclusive ranges", () => {
	assert.deepEqual(parseArgs([80, 443]), [80, 443]);
	assert.deepEqual(parseArgs([0, 65535]), [0, 65535]);
	assert.deepEqual(parseArgs(80, 82), [80, 81, 82]);
});

test("rejects invalid port arguments", () => {
	assert.throws(() => parseArgs(-1, 80), RangeError);
	assert.throws(() => parseArgs(80, 65536), RangeError);
	assert.throws(() => parseArgs([80, 443.5]), RangeError);
	assert.throws(() => parseArgs(443, 80), RangeError);
	assert.throws(() => parseArgs([80], 443), TypeError);
	// @ts-expect-error verify the runtime guard rejects a missing argument
	assert.throws(() => parseArgs(), TypeError);
	// @ts-expect-error verify the runtime guard rejects a non-array/number argument
	assert.throws(() => parseArgs("80"), TypeError);
});
