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
        const [value, setValue] = createSignal("MASTER GOAL\nLoading…");
        insert(text, value);
        insert(box, text);
        let generation = 0,
          closed = false,
          busy = false;
        const refresh = async () => {
          if (closed || busy) return;
          busy = true;
          const current = ++generation;
          const session = props.sessionID;
          try {
            const location = ctx.data.session.get(session)?.location;
            if (!location) throw new Error("Session location unavailable");
            const result = await rpc.read({ sessionID: session }, { location });
            if (
              !closed &&
              current === generation &&
              session === props.sessionID
            )
              setValue((result as { text: string }).text);
          } catch {
            if (!closed && current === generation)
              setValue("MASTER GOAL\nServer status unavailable");
          } finally {
            busy = false;
          }
        };
        createEffect(() => {
          props.sessionID;
          generation++;
          setValue("MASTER GOAL\nLoading…");
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
