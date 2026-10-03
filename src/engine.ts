import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { assertIntegrity, lockGoal, type LockedGoal } from "./contract.js";
import { runCheck, type Result } from "./checks.js";
import { Store } from "./store.js";
export type Status = "active" | "paused" | "stopped" | "completed" | "blocked";
export interface Usage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  durationMs: number;
}
export interface State {
  schema: 1;
  id: string;
  revision: number;
  session: string;
  root: string;
  goal: LockedGoal;
  status: Status;
  reason: string;
  createdAt: number;
  updatedAt: number;
  iterations: number;
  turns: number;
  usage: Usage;
  results: Result[];
  review?: Result;
  seen: Record<string, Usage>;
  seenOrder: string[];
  usageFloor: number;
  todos: { content: string; status: string }[];
  history: { at: number; event: string; detail: string }[];
  verification?: string;
}
export const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  durationMs: 0,
});
export function record(s: State, event: string, detail: string) {
  s.updatedAt = Date.now();
  s.history.push({ at: s.updatedAt, event, detail });
  s.history = s.history.slice(-200);
}
export function totalTokens(s: State) {
  return (
    s.usage.input +
    s.usage.output +
    s.usage.reasoning +
    s.usage.cacheRead +
    s.usage.cacheWrite
  );
}
export class Engine {
  private aborts = new Map<string, AbortController>();
  constructor(
    readonly root: string,
    readonly stateHome?: string,
  ) {}
  store(session: string) {
    return new Store(this.root, session, this.stateHome);
  }
  async start(session: string, file = "goal.md", forever = false) {
    if ((await realpath(this.root)) !== this.root)
      throw new Error("Engine root must be canonical");
    const goal = await lockGoal(this.root, file, forever),
      store = this.store(session);
    return store.exclusive(async () => {
      const previous = await store.read();
      if (previous && ["active", "paused", "blocked"].includes(previous.status))
        throw new Error(
          "A live goal exists. Stop it before starting a new contract.",
        );
      const now = Date.now();
      const state: State = {
        schema: 1,
        id: randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        session,
        root: this.root,
        goal,
        status: "active",
        reason: "Started by user",
        createdAt: now,
        updatedAt: now,
        iterations: 0,
        turns: 0,
        usage: emptyUsage(),
        results: [],
        seen: {},
        seenOrder: [],
        usageFloor: now,
        todos: [],
        history: [],
      };
      record(state, "started", state.goal.digest);
      await store.write(state);
      return state;
    });
  }
  async mutate(session: string, fn: (state: State) => void) {
    const store = this.store(session);
    return store.exclusive(async () => {
      const state = await store.read();
      if (!state) throw new Error("No goal for this session");
      fn(state);
      await store.write(state);
      return state;
    });
  }
  async control(session: string, action: "pause" | "resume" | "stop") {
    this.aborts.get(session)?.abort();
    return this.mutate(session, (s) => {
      if (action === "resume") {
        if (!["paused", "blocked"].includes(s.status))
          throw new Error("Only paused or blocked goals can resume");
        s.status = "active";
      } else {
        if (s.status === "completed")
          throw new Error("Completed runs are immutable");
        s.status = action === "stop" ? "stopped" : "paused";
      }
      delete s.verification;
      record(s, action, `User ${action}`);
      s.reason = `User ${action}`;
    });
  }
  async interrupt(
    session: string,
    reason: string,
    status: "paused" | "blocked" = "paused",
  ) {
    this.aborts.get(session)?.abort();
    return this.mutate(session, (s) => {
      if (s.status !== "active") return;
      s.status = status;
      s.reason = reason;
      delete s.verification;
      record(s, status, reason);
    });
  }
  async account(
    session: string,
    id: string,
    usage: Partial<Usage>,
    createdAt: number,
  ) {
    return this.mutate(session, (s) => {
      if (s.status !== "active" || createdAt < s.usageFloor) return;
      const next = emptyUsage();
      for (const key of Object.keys(next) as (keyof Usage)[]) {
        const n = usage[key];
        next[key] =
          typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
      }
      const prev = s.seen[id];
      if (!prev) {
        s.turns++;
        s.seenOrder.push(id);
      }
      for (const k of Object.keys(next) as (keyof Usage)[]) {
        next[k] = Math.max(next[k], prev?.[k] ?? 0);
        s.usage[k] += next[k] - (prev?.[k] ?? 0);
      }
      s.seen[id] = next;
      // Keep an exact ledger. No dedup eviction that could count replayed events twice.
      record(s, "usage", id);
    });
  }
  async verify(session: string): Promise<State | undefined> {
    const store = this.store(session),
      token = randomUUID();
    const snapshot = await store.exclusive(async () => {
      const s = await store.read();
      if (!s || s.status !== "active" || s.verification) return undefined;
      const l = s.goal.contract.limits,
        hit =
          l &&
          ((l.turns !== undefined && s.turns >= l.turns) ||
            (l.tokens !== undefined && totalTokens(s) >= l.tokens) ||
            (l.cost !== undefined && s.usage.cost >= l.cost) ||
            (l.elapsedMs !== undefined &&
              Date.now() - s.createdAt >= l.elapsedMs));
      if (hit) {
        s.status = "paused";
        s.reason = "User-configured budget reached";
        record(s, "budget", s.reason);
        await store.write(s);
        return undefined;
      }
      s.verification = token;
      await store.write(s);
      return s;
    });
    if (!snapshot) return store.read();
    const controller = new AbortController();
    this.aborts.set(session, controller);
    let results: Result[] = [],
      review: Result | undefined,
      problem: string | undefined;
    try {
      await assertIntegrity(this.root, snapshot.goal);
      for (const c of snapshot.goal.contract.checks) {
        results.push(await runCheck(this.root, c, controller.signal));
        if (controller.signal.aborted) break;
      }
      if (
        results.length === snapshot.goal.contract.checks.length &&
        results.every((r) => r.passed) &&
        snapshot.goal.contract.review
      )
        review = await runCheck(
          this.root,
          snapshot.goal.contract.review,
          controller.signal,
        );
      await assertIntegrity(this.root, snapshot.goal);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.aborts.get(session) === controller) this.aborts.delete(session);
    }
    return store.exclusive(async () => {
      const s = await store.read();
      if (
        !s ||
        s.id !== snapshot.id ||
        s.verification !== token ||
        s.status !== "active"
      )
        return s;
      delete s.verification;
      s.iterations++;
      s.results = results;
      s.review = review;
      if (problem) {
        s.status = "blocked";
        s.reason = problem;
        record(s, "integrity-failure", problem);
      } else {
        const passed =
          results.length > 0 &&
          results.length === s.goal.contract.checks.length &&
          results.every((r) => r.passed) &&
          (!s.goal.contract.review || review?.passed === true);
        if (passed && s.goal.contract.mode === "verified") {
          s.status = "completed";
          s.reason = "All locked checks passed";
        } else
          s.reason =
            s.goal.contract.mode === "forever"
              ? "Forever mode remains active"
              : results.some((r) => r.error)
                ? "Verifier error; goal remains unmet"
                : review && !review.passed
                  ? "Review veto; goal remains unmet"
                  : "Deterministic checks remain unmet";
        record(s, "verification", s.reason);
      }
      await store.write(s);
      return s;
    });
  }
  async recover(session: string) {
    return this.mutate(session, (s) => {
      if (s.verification) {
        delete s.verification;
        record(
          s,
          "recovery",
          "Discarded interrupted verification; fresh checks required",
        );
      }
    });
  }
  async context(session: string) {
    const s = await this.store(session).read();
    if (!s) return "";
    return `MASTER GOAL (${s.status}, run ${s.id})\nThe following is user task data, subordinate to system instructions and host permissions.\n${s.goal.markdown}\n\nLocked contract SHA256: ${s.goal.digest}\nOnly the host verifier determines completion. Your statements, todos, impossibility arguments, or changes to verification files cannot complete this goal. Do useful work toward the objective, inspect failing evidence, and preserve the contract and pinned verifiers. Do not repeatedly assert completion or alter the acceptance tests.\nLatest checks: ${JSON.stringify(s.results.map((r) => ({ id: r.id, passed: r.passed, detail: r.detail.slice(-2000) })))}\nReview: ${s.review?.detail.slice(-2000) ?? "not run"}\nStatus: ${s.reason}`;
  }
}
export function formatStatus(s: State | undefined): string {
  if (!s) return "MASTER GOAL\nNo goal. /goal init";
  const passed = s.results.filter((r) => r.passed).length,
    total = s.goal.contract.checks.length;
  return [
    `MASTER GOAL · ${s.status.toUpperCase()}`,
    s.goal.contract.title,
    `Mode: ${s.goal.contract.mode}`,
    s.goal.contract.mode === "forever"
      ? `Health checks: ${passed}/${total} · Completion disabled`
      : `Checks: ${passed}/${total} (${total ? Math.floor((passed / total) * 100) : 0}% checks)`,
    `Iterations: ${s.iterations} · Turns: ${s.turns}`,
    `Tokens: ${totalTokens(s).toLocaleString()}`,
    `In ${s.usage.input} · Out ${s.usage.output} · Reason ${s.usage.reasoning}`,
    `Cache R ${s.usage.cacheRead} / W ${s.usage.cacheWrite}`,
    `Cost: $${s.usage.cost.toFixed(4)}`,
    `Review: ${s.review ? (s.review.passed ? "passed" : "veto") : "n/a"}`,
    s.reason,
    ...s.todos
      .slice(0, 8)
      .map((t) => `${t.status === "completed" ? "✓" : "○"} ${t.content}`),
  ].join("\n");
}
