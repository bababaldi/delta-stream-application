import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Android CLI build refuses a missing standalone JDK instead of using editor or system Java", {
  skip: process.platform === "win32",
}, () => {
  const result = spawnSync(
    "sh",
    [
      fileURLToPath(new URL("../scripts/build-android.sh", import.meta.url)),
      ":app:assembleDebug",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, JAVA_HOME: "/delta-stream-missing-jdk" },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JDK 21 missing/);
  assert.doesNotMatch(result.stdout, /Gradle/);
});
