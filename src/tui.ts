import { Plugin } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createElement, insert, setProp } from "@opentui/solid";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { StatusRpc } from "./rpc.js";
export default Plugin.define({
  id: "opencode-mastergoal-sidebar",
  setup: (ctx) => {
    const rpc = ctx.client.rpc(StatusRpc);
    return ctx.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        const box = createElement("box");
        setProp(box, "flexDirection", "column");
        setProp(box, "paddingTop", 1);
        const text = createElement("text");
        setProp(text, "fg", ctx.theme.text.base);
        const [value, setValue] = createSignal({ session: "", text: "" });
        insert(text, () =>
          value().session === props.sessionID
            ? value().text
            : "MASTER GOAL\nLoading…",
        );
        insert(box, text);
        let generation = 0,
          closed = false;
        let selected: string | undefined;
        let pending: number | undefined;
        const refresh = async () => {
          if (closed) return;
          const session = props.sessionID;
          if (selected !== session) {
            selected = session;
            generation++;
            pending = undefined;
            setValue({ session, text: "MASTER GOAL\nLoading…" });
          }
          if (pending !== undefined) return;
          const current = ++generation;
          pending = current;
          try {
            const location = ctx.data.session.get(session)?.location;
            if (!location) throw new Error("Session location unavailable");
            const result = await rpc.read({ sessionID: session }, { location });
            if (
              !closed &&
              current === generation &&
              session === props.sessionID
            )
              setValue({ session, text: (result as { text: string }).text });
          } catch {
            if (
              !closed &&
              current === generation &&
              session === props.sessionID
            )
              setValue({
                session,
                text: "MASTER GOAL\nServer status unavailable",
              });
          } finally {
            if (pending === current) pending = undefined;
          }
        };
        createEffect(() => {
          props.sessionID;
          void refresh();
        });
        const timer = setInterval(() => void refresh(), 1000);
        onCleanup(() => {
          closed = true;
          generation++;
          clearInterval(timer);
        });
        return box as unknown as JSX.Element;
      },
    });
  },
});
