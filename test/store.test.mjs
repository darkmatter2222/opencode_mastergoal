import test from "node:test";
import assert from "node:assert/strict";
import { replaceStateFile } from "../dist/store.js";
test("atomic state replacement retries transient Windows file locks", async () => {
  let attempts = 0;
  await replaceStateFile("source", "target", async (source, target) => {
    assert.equal(source, "source");
    assert.equal(target, "target");
    if (++attempts < 4)
      throw Object.assign(new Error("locked"), {
        code: ["EPERM", "EACCES", "EBUSY"][attempts - 1],
      });
  });
  assert.equal(attempts, 4);
});
test("atomic state replacement preserves permanent errors", async () => {
  const failure = Object.assign(new Error("missing"), { code: "ENOENT" });
  await assert.rejects(
    replaceStateFile("source", "target", async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
});
