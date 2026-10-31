import assert from "node:assert/strict";
import { checkFreeSpace, assertDiskSpace } from "../server/src/core/storage.ts";
assert.doesNotThrow(() => checkFreeSpace(3 * 1024 ** 3, 1024 ** 2));
assert.throws(
  () => checkFreeSpace(512 * 1024 ** 2, 1),
  (e) => e.status === 507 && e.code === "DISK_SPACE_LOW",
);
assert.throws(
  () => checkFreeSpace(1024 ** 3 + 100, 100),
  (e) => e.status === 507,
);
assert.throws(() => checkFreeSpace(NaN, 1));
await assertDiskSpace(1, "/tmp");
console.log("Storage write guard: 5 checks passed");
