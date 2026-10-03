import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Remove retired adapters and stale declarations when upgrading a checkout.
await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc")], {
  stdio: "inherit",
});
