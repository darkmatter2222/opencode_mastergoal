import { Engine } from "./engine.js";
export interface Host {
  busy(session: string): Promise<boolean>;
  prompt(session: string, text: string): Promise<void>;
  report(session: string, text: string): Promise<void>;
}
/** One scheduler owns admission; model text never reaches the state transition API. */
export class Coordinator {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = new Map<string, Promise<void>>();
  private epochs = new Map<string, number>();
  private disposed = false;
  private intervals = new Map<string, number>();
  private awaiting = new Set<string>();
  private observed = new Set<string>();
  constructor(
    readonly engine: Engine,
    readonly host: Host,
  ) {}
  started(session: string) {
    this.observed.add(session);
  }
  settled(session: string) {
    if (this.awaiting.has(session) && !this.observed.has(session)) return;
    this.awaiting.delete(session);
    this.observed.delete(session);
    this.schedule(session);
  }
  cancel(session: string) {
    this.awaiting.delete(session);
    this.observed.delete(session);
    clearTimeout(this.timers.get(session));
    this.timers.delete(session);
    this.epochs.set(session, (this.epochs.get(session) ?? 0) + 1);
  }
  schedule(session: string, delay?: number) {
    if (this.disposed || this.timers.has(session)) return;
    const timer = setTimeout(
      () => {
        this.timers.delete(session);
        void this.tick(session).catch((e) =>
          this.host
            .report(session, `Master Goal: ${String(e)}`)
            .catch(() => {}),
        );
      },
      delay ?? this.intervals.get(session) ?? 1000,
    );
    timer.unref?.();
    this.timers.set(session, timer);
  }
  async tick(session: string): Promise<void> {
    if (this.disposed || this.awaiting.has(session)) return;
    const prior = this.running.get(session);
    if (prior) return prior;
    const epoch = this.epochs.get(session) ?? 0;
    const task = (async () => {
      const initial = await this.engine.store(session).read();
      if (!initial || initial.status !== "active") return;
      this.intervals.set(session, initial.goal.contract.intervalMs);
      if (await this.host.busy(session)) {
        this.schedule(session, initial.goal.contract.intervalMs);
        return;
      }
      const state = await this.engine.verify(session);
      if (this.disposed || (this.epochs.get(session) ?? 0) !== epoch) return;
      if (!state || state.status !== "active") {
        if (state) await this.host.report(session, state.reason);
        return;
      }
      if (await this.host.busy(session)) {
        this.schedule(session, state.goal.contract.intervalMs);
        return;
      }
      const latest = await this.engine.store(session).read();
      if (latest?.status !== "active" || latest.id !== state.id) return;
      const context = await this.engine.context(session);
      if (this.disposed || (this.epochs.get(session) ?? 0) !== epoch) return;
      this.awaiting.add(session);
      this.observed.delete(session);
      try {
        await this.host.prompt(session, context);
      } catch (e) {
        this.awaiting.delete(session);
        await this.engine.interrupt(
          session,
          `Prompt delivery failed: ${String(e)}. /goal resume to retry.`,
          "blocked",
        );
        await this.host.report(
          session,
          "Master Goal could not deliver the next turn. Goal is blocked, not completed.",
        );
      }
    })();
    this.running.set(session, task);
    try {
      await task;
    } finally {
      this.running.delete(session);
    }
  }
  async dispose() {
    this.disposed = true;
    for (const s of this.timers.keys()) this.cancel(s);
    for (const s of this.running.keys())
      await this.engine
        .interrupt(s, "Plugin disposed; resume after restart")
        .catch(() => {});
    await Promise.allSettled(this.running.values());
  }
}
