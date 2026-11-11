import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function check(bytes, environment = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "nexus-privacy-"));
  const filename = path.join(directory, "payload.bin");
  try {
    writeFileSync(filename, bytes);
    const result = spawnSync(
      process.execPath,
      ["scripts/check-release-privacy.mjs", filename],
      { encoding: "utf8", env: { ...process.env, ...environment } },
    );
    assert.equal(result.signal, null);
    assert.ok(
      result.status === 0 || result.status === 1,
      "The scanner must exit normally.",
    );
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("ordinary ASCII and odd-length payloads scan without a decoder crash", () => {
  assert.equal(check(Buffer.from("Public release documentation.")).status, 0);
  assert.equal(check(Buffer.alloc(827, 65)).status, 0);
});

for (const offset of [0, 1]) {
  test(
    "user-directory strings are caught in UTF-16 at byte offset " + offset,
    () => {
      const value = ["C:", "Users", "example", "private.txt"].join(
        path.win32.sep,
      );
      const bytes = Buffer.concat([
        Buffer.alloc(offset, 1),
        Buffer.from(value, "utf16le"),
        Buffer.from([0]),
      ]);
      const result = check(bytes);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /user directory/);
      assert.ok(!result.stderr.includes(value));
    },
  );
}

test("access-token findings print a category without exposing the value", () => {
  const value = "ghp_" + "a".repeat(40);
  const result = check(Buffer.from(value));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /access token/);
  assert.ok(!result.stderr.includes(value));
});

test("identity markers match complete identifiers instead of word fragments", () => {
  const environment = { NEXUS_PRIVACY_TERMS: JSON.stringify(["samplemarker"]) };
  assert.equal(check(Buffer.from("samplemarker"), environment).status, 1);
  assert.equal(
    check(Buffer.from("prefixsamplemarkersuffix"), environment).status,
    0,
  );
});
