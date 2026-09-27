import assert from "node:assert/strict";
import test from "node:test";
import { assertConfig } from "../scripts/build-data.js";

test("optional usage data is explicitly disabled, never replaced by a previous format", () => {
  assert.doesNotThrow(() => assertConfig({ activeRegulation: "champions-regulation-mc", pikalyticsFormat: null }));
  assert.doesNotThrow(() => assertConfig({ activeRegulation: "champions-regulation-mc", pikalyticsFormat: "verified-format" }));
  for (const pikalyticsFormat of ["", "../old-format", "format?fallback=old"]) {
    assert.throws(() => assertConfig({ activeRegulation: "champions-regulation-mc", pikalyticsFormat }), /pikalyticsFormat/);
  }
  assert.throws(() => assertConfig({ activeRegulation: "", pikalyticsFormat: null }), /activeRegulation/);
});
