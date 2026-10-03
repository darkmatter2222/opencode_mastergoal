import { Rpc } from "@opencode/plugin/rpc";
export const StatusRpc = Rpc.define({
  id: "mastergoal.status",
  methods: {
    read: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  events: {},
});
