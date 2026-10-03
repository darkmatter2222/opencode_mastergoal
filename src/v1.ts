import { constructionContext } from "./construct.js";
import { type Plugin, tool } from "@opencode-ai/plugin";
import { realpath } from "node:fs/promises";
import { Engine, formatStatus } from "./engine.js";
import { command, help } from "./commands.js";
import { Coordinator } from "./coordinator.js";
import { guardTool } from "./guard.js";
const plugin: Plugin = async ({ client, directory }) => {
  const engine = new Engine(await realpath(directory));
  const loaded = new Set<string>();
  const ensure = async (id: string) => {
    if (loaded.has(id)) return;
    loaded.add(id);
    const old = await engine.store(id).read();
    if (old?.status === "active")
      await engine.interrupt(
        id,
        "Host restarted; /goal resume to recover the locked run",
      );
  };
  const notify = async (session: string, text: string) => {
    await client.tui.showToast({
      body: { title: "Master Goal", message: text, variant: "info" },
    });
  };
  const coordinator = new Coordinator(engine, {
    busy: async (s) => {
      const res = await client.session.status();
      if (res.error) throw new Error("Unable to read host status");
      return res.data?.[s]?.type !== "idle" && res.data?.[s] !== undefined;
    },
    prompt: async (s, text) => {
      const res = await client.session.promptAsync({
        path: { id: s },
        body: { parts: [{ type: "text", text }] },
      });
      if (res.error) throw new Error(JSON.stringify(res.error));
    },
    report: notify,
  });
  return {
    dispose: () => coordinator.dispose(),
    config: async (c) => {
      c.command ??= {};
      if (c.command.goal)
        throw new Error(
          "Another plugin owns /goal; disable it before enabling Master Goal",
        );
      c.command.goal = {
        description: help,
        template: "Master Goal host command: $ARGUMENTS",
      };
    },
    "command.execute.before": async (input, output) => {
      if (input.command !== "goal") return;
      if (/^(pause|stop|end)(?:\s|$)/.test(input.arguments.trim()))
        coordinator.cancel(input.sessionID);
      await ensure(input.sessionID);
      const result = await command(engine, input.sessionID, input.arguments);
      output.parts = [
        {
          type: "text",
          text: `Host command result:\n${result.text}\n${result.construction ? result.construction : result.kick ? await engine.context(input.sessionID) : "Report this status briefly; do not perform goal work."}`,
        } as (typeof output.parts)[number],
      ];
      await notify(input.sessionID, result.text);
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (input.sessionID) {
        await ensure(input.sessionID);
        const context =
          (await constructionContext(engine, input.sessionID)) ||
          (await engine.context(input.sessionID));
        if (context) output.system.push(context);
      }
    },
    "experimental.session.compacting": async (input, output) => {
      const context =
        (await constructionContext(engine, input.sessionID)) ||
        (await engine.context(input.sessionID));
      if (context) output.context.push(context);
    },
    "tool.execute.before": async (input, output) =>
      guardTool(engine, input.sessionID, input.tool, output.args),
    tool: {
      mastergoal_status: tool({
        description:
          "Read host-verified Master Goal state. Cannot change lifecycle or claim completion.",
        args: {},
        execute: async (_, ctx) =>
          formatStatus(await engine.store(ctx.sessionID).read()),
      }),
    },
    event: async ({ event }) => {
      if (
        "sessionID" in event.properties &&
        typeof event.properties.sessionID === "string"
      )
        await ensure(event.properties.sessionID);
      if (
        event.type === "session.status" &&
        event.properties.status.type === "busy"
      )
        coordinator.started(event.properties.sessionID);
      if (event.type === "session.idle")
        coordinator.settled(event.properties.sessionID);
      if (event.type === "session.error") {
        const id = event.properties.sessionID;
        if (id && (await engine.store(id).read())) {
          coordinator.cancel(id);
          await engine.interrupt(
            id,
            "Host error or interruption; /goal resume after resolving it",
            "blocked",
          );
        }
      }
      if (event.type === "session.deleted") {
        const id = event.properties.info.id;
        coordinator.cancel(id);
        if (await engine.store(id).read())
          await engine.interrupt(id, "Session deleted");
      }
      if (event.type === "todo.updated") {
        const p = event.properties;
        if (await engine.store(p.sessionID).read())
          await engine.mutate(p.sessionID, (s) => {
            s.todos = p.todos.map((t) => ({
              content: t.content,
              status: t.status,
            }));
          });
      }
      if (event.type === "message.updated") {
        const m = event.properties.info;
        if (
          m.role !== "assistant" ||
          !m.time.completed ||
          !(await engine.store(m.sessionID).read())
        )
          return;
        await engine.account(
          m.sessionID,
          m.id,
          {
            input: m.tokens.input,
            output: m.tokens.output,
            reasoning: m.tokens.reasoning,
            cacheRead: m.tokens.cache.read,
            cacheWrite: m.tokens.cache.write,
            cost: m.cost,
            durationMs: Math.max(0, m.time.completed - m.time.created),
          },
          m.time.created,
        );
      }
    },
  };
};
export default plugin;
