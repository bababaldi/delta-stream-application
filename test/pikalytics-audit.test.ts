import assert from "node:assert/strict";
import audit from "../data/review/pikalytics-mc-spread-audit.json" with { type: "json" };
import config from "../data/config.json" with { type: "json" };
import test from "node:test";

test("current Pikalytics M-C audit supplies no spread or nature recommendations", () => {
  assert.equal(audit.reviewStatus, "verified-no-spread-data");
  assert.equal(audit.pikalyticsFormat, "gen9championsvgc2026regmc");
  assert.equal(audit.entries.length, 21);
  assert.ok(audit.entries.every((entry) => entry.noSpreadNatureData));
  assert.equal(config.pikalyticsFormat, null);
});
