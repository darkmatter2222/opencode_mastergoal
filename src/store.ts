import { mkdir, readFile, rename, open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { digest } from "./contract.js";
import type { State } from "./engine.js";
export class Store {
  readonly directory: string;
  constructor(
    readonly root: string,
    readonly session: string,
    home = process.env.MASTERGOAL_STATE_DIR ??
      path.join(homedir(), ".local", "state", "opencode-mastergoal"),
  ) {
    this.directory = path.join(home, digest(root), digest(session));
  }
  async read(): Promise<State | undefined> {
    try {
      const state = JSON.parse(
        await readFile(path.join(this.directory, "state.json"), "utf8"),
      ) as State;
      if (
        state.schema !== 1 ||
        state.session !== this.session ||
        state.root !== this.root ||
        !state.goal ||
        !Array.isArray(state.results)
      )
        throw new Error("Invalid persisted state");
      return state;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }
  async write(state: State) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const tmp = path.join(this.directory, `${randomUUID()}.tmp`);
    const file = await open(tmp, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(state, null, 2));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tmp, path.join(this.directory, "state.json"));
  }
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.directory, {
      realpath: false,
      stale: 30000,
      update: 5000,
      retries: { retries: 100, factor: 1, minTimeout: 20, maxTimeout: 50 },
    });
    try {
      return await work();
    } finally {
      await release();
    }
  }
}
