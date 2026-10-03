import { constructionContext } from "./construct.js";
import { Plugin } from "@opencode/plugin";
import { realpath } from "node:fs/promises";
import { Engine, formatStatus } from "./engine.js";
import { Coordinator } from "./coordinator.js";
import { command, help } from "./commands.js";
import { guardTool } from "./guard.js";
import { StatusRpc } from "./rpc.js";

type Sid = Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"];
export default Plugin.define({
  id: "opencode-mastergoal",
  setup: async (ctx) => {
    const boundRoot = await realpath(ctx.location.directory);
    const engines = new Map<string, Engine>(),
      schedulers = new Map<string, Coordinator>(),
      running = new Set<string>(),
      starts = new Map<string, number>();
    const loaded = new Set<string>();
    const registrations: { dispose(): Promise<void> }[] = [];
    const abort = new AbortController();
    async function get(session: string) {
      const info = await ctx.session.get({ sessionID: session as Sid });
      const root = await realpath(info.location.directory);
      if (root !== boundRoot)
        throw new Error("Session belongs to another plugin location");
      let engine = engines.get(root);
      if (!engine) {
        engine = new Engine(root);
        engines.set(root, engine);
      }
      let scheduler = schedulers.get(root);
      if (!scheduler) {
        scheduler = new Coordinator(engine, {
          busy: async (s) => {
            await ctx.session.get({ sessionID: s as Sid });
            return running.has(s);
          },
          prompt: async (s, text) => {
            await ctx.session.prompt({
              sessionID: s as Sid,
              text,
              delivery: "queue",
              resume: true,
              metadata: { mastergoal: true },
            });
          },
          report: async (s, text) => {
            await ctx.session.synthetic({
              sessionID: s as Sid,
              text,
              resume: false,
            });
          },
        });
        schedulers.set(root, scheduler);
      }
      if (!loaded.has(session)) {
        loaded.add(session);
        const old = await engine.store(session).read();
        if (old?.status === "active")
          await engine.interrupt(
            session,
            "Host restarted; /goal resume to recover the locked run",
          );
      }
      return { engine, scheduler };
    }
    registrations.push(
      await ctx.command.transform((editor) =>
        editor.add({
          name: "goal",
          description: help,
          execute: async (input) => {
            const { engine, scheduler } = await get(input.sessionID);
            if (/^(pause|stop|end)(?:\s|$)/.test(input.prompt.text.trim()))
              scheduler.cancel(input.sessionID);
            const result = await command(
              engine,
              input.sessionID,
              input.prompt.text,
            );
            await ctx.session.synthetic({
              sessionID: input.sessionID,
              text: result.text,
              resume: false,
            });
            if (result.construction)
              await ctx.session.prompt({
                sessionID: input.sessionID,
                text: result.construction,
                delivery: "queue",
                resume: true,
              });
            if (result.kick) scheduler.schedule(input.sessionID, 250);
          },
        }),
      ),
    );
    registrations.push(
      await ctx.rpc.register(StatusRpc, {
        read: async (input) => {
          const { sessionID } = input as { sessionID: string };
          const { engine } = await get(sessionID);
          return { text: formatStatus(await engine.store(sessionID).read()) };
        },
      }),
    );
    const inject = async (e: {
      sessionID: Sid;
      system: { type: "text"; text: string }[];
    }) => {
      const { engine } = await get(e.sessionID);
      const text =
        (await constructionContext(engine, e.sessionID)) ||
        (await engine.context(e.sessionID));
      if (text) e.system.push({ type: "text", text });
    };
    registrations.push(await ctx.session.hook("context", inject));
    registrations.push(await ctx.session.hook("compaction", inject));
    registrations.push(
      await ctx.tool.hook("execute.before", async (e) => {
        const { engine } = await get(e.sessionID);
        await guardTool(engine, e.sessionID, e.tool, e.input);
      }),
    );
    registrations.push(
      await ctx.tool.hook("execute.after", async (e) => {
        if (e.status !== "completed" || !e.tool.endsWith("todowrite")) return;
        const input = e.input as {
          todos?: { content: string; status: string }[];
        };
        if (!Array.isArray(input?.todos)) return;
        const { engine } = await get(e.sessionID);
        if (await engine.store(e.sessionID).read())
          await engine.mutate(e.sessionID, (s) => {
            s.todos = input
              .todos!.filter(
                (t) =>
                  typeof t.content === "string" && typeof t.status === "string",
              )
              .map((t) => ({ content: t.content, status: t.status }));
          });
      }),
    );
    registrations.push(
      await ctx.tool.transform((editor) =>
        editor.add({
          name: "mastergoal_status",
          description: "Read goal state. No lifecycle mutation.",
          input: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          execute: async (_, toolCtx) => {
            const { engine } = await get(toolCtx.sessionID);
            return {
              content: formatStatus(
                await engine.store(toolCtx.sessionID).read(),
              ),
            };
          },
        }),
      ),
    );
    const events = (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (abort.signal.aborted) break;
        if (
          !("data" in event) ||
          !event.data ||
          typeof event.data !== "object" ||
          !("sessionID" in event.data)
        )
          continue;
        const id = String(event.data.sessionID);
        let pair;
        try {
          pair = await get(id);
        } catch {
          continue;
        }
        const { engine, scheduler } = pair;
        if (!(await engine.store(id).read())) continue;
        if (event.type === "session.execution.started") {
          running.add(id);
          scheduler.started(id);
        }
        if (event.type === "session.step.started")
          starts.set(id, event.created);
        if (event.type === "session.step.ended") {
          const d = event.data;
          await engine.account(
            id,
            event.id,
            {
              input: d.tokens.input,
              output: d.tokens.output,
              reasoning: d.tokens.reasoning,
              cacheRead: d.tokens.cache.read,
              cacheWrite: d.tokens.cache.write,
              cost: d.cost,
              durationMs: Math.max(
                0,
                event.created - (starts.get(id) ?? event.created),
              ),
            },
            event.created,
          );
        }
        if (event.type === "session.execution.succeeded") {
          running.delete(id);
          scheduler.settled(id);
        }
        if (
          event.type === "session.execution.failed" ||
          event.type === "session.execution.interrupted"
        ) {
          running.delete(id);
          scheduler.cancel(id);
          await engine.interrupt(
            id,
            `${event.type}; /goal resume to continue`,
            "blocked",
          );
        }
      }
    })();
    // Surface event-stream failures rather than silently claiming continued operation.
    void events.catch(async (e) => {
      if (!abort.signal.aborted)
        console.error("[mastergoal] Event stream failed:", e);
    });
    return async () => {
      abort.abort();
      await Promise.allSettled(
        [...schedulers.values()].map((s) => s.dispose()),
      );
      await Promise.allSettled(registrations.map((r) => r.dispose()));
      await events.catch(() => {});
    };
  },
});
