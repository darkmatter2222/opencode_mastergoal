import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { type Check, digest, within } from "./contract.js";
export interface Result {
  id: string;
  passed: boolean;
  detail: string;
  durationMs: number;
  error?: boolean;
}
export async function runCheck(
  root: string,
  check: Check,
  signal?: AbortSignal,
): Promise<Result> {
  const start = Date.now();
  let passed = false,
    detail = "",
    error = false;
  try {
    if (signal?.aborted) throw new Error("Verification cancelled");
    if (check.type === "equals") {
      passed = isDeepStrictEqual(check.actual, check.expected);
      detail = passed ? "Values equal" : "Values differ";
    } else if (check.type === "file") {
      const file = await within(root, check.path);
      const info = await stat(file);
      if (!info.isFile() || info.size > 10_000_000)
        throw new Error("Expected a regular file <= 10 MB");
      const data = await readFile(file);
      passed =
        (check.contains === undefined ||
          data.toString("utf8").includes(check.contains)) &&
        (check.sha256 === undefined || digest(data) === check.sha256);
      detail = passed ? "File contract passed" : "File content did not match";
    } else {
      const script = await within(root, check.path);
      const outcome = await new Promise<{
        passed: boolean;
        detail: string;
        error: boolean;
      }>((resolve) => {
        let output = "",
          ended = false,
          failure: string | undefined,
          timer: ReturnType<typeof setTimeout> | undefined;
        const child = spawn(check.runtime, [script, ...(check.args ?? [])], {
          cwd: root,
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, MASTERGOAL_VERIFY: "1" },
        });
        const finish = (passed: boolean, detail: string, error = false) => {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          resolve({ passed, detail, error });
        };
        const kill = () => {
          try {
            if (process.platform !== "win32" && child.pid)
              process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {}
        };
        const stop = (reason: string) => {
          if (ended || failure) return;
          failure = reason;
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          kill();
          // Close our pipes as well: descendants may have inherited them.
          // Resolve only after the direct child has exited and closed its handles.
          child.stdout.destroy();
          child.stderr.destroy();
        };
        const cancel = () => stop("Verification cancelled");
        timer = setTimeout(
          () => stop("Verifier timed out"),
          check.timeoutMs ?? 30_000,
        );
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        const capture = (chunk: Buffer) => {
          if (failure) return;
          output += chunk.toString();
          if (Buffer.byteLength(output) > 64_000)
            stop("Verifier output exceeded 64 KB");
        };
        child.stdout.on("data", capture);
        child.stderr.on("data", capture);
        child.once("error", (e) => {
          failure ??= e.message;
        });
        child.once("close", (code, sig) =>
          finish(
            !failure && code === 0,
            failure ??
              `exit=${code} signal=${sig ?? "none"}\n${output.slice(-8000)}`,
            failure !== undefined || sig !== null,
          ),
        );
      });
      ({ passed, detail, error } = outcome);
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
    error = !(
      check.type === "file" && (e as NodeJS.ErrnoException).code === "ENOENT"
    );
  }
  return {
    id: check.id,
    passed,
    detail,
    durationMs: Date.now() - start,
    ...(error ? { error } : {}),
  };
}
