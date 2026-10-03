import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createElement, insert } from "@opentui/solid";
import { createSignal, onCleanup } from "solid-js";
import { realpath } from "node:fs/promises";
import { Engine, formatStatus } from "./engine.js";
const plugin: TuiPluginModule = {
  id: "opencode-mastergoal-sidebar",
  tui: async (api) => {
    const root = await realpath(api.state.path.directory);
    const engine = new Engine(root);
    api.slots.register({
      slots: {
        sidebar_content: (_, props) => {
          const el = createElement("text");
          const [text, setText] = createSignal("MASTER GOAL");
          insert(el, text);
          let closed = false,
            busy = false;
          const update = async () => {
            if (closed || busy) return;
            busy = true;
            const id = props.session_id;
            try {
              const value = formatStatus(await engine.store(id).read());
              if (!closed && id === props.session_id) setText(value);
            } catch {
              if (!closed) setText("MASTER GOAL\nStatus unavailable");
            } finally {
              busy = false;
            }
          };
          void update();
          const timer = setInterval(() => void update(), 1000);
          onCleanup(() => {
            closed = true;
            clearInterval(timer);
          });
          return el as unknown as JSX.Element;
        },
      },
    });
  },
};
export default plugin;
