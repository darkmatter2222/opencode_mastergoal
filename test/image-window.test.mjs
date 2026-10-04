import test from "node:test";
import assert from "node:assert/strict";
import { Message, Media } from "@opencode/ai";
import {
  applyImageWindow,
  loadMasterGoalConfig,
  isImagePart,
} from "../dist/image-window.js";
const img = (id) => Message.media(Media.base64(id, "image/png"));
const images = (messages) =>
  messages
    .flatMap((m) =>
      m.content.flatMap((p) =>
        p?.type === "tool-result" && p.result?.type === "content"
          ? p.result.value
          : [p],
      ),
    )
    .filter(isImagePart);
const freeze = (x) => {
  if (x && typeof x === "object") {
    Object.freeze(x);
    Object.values(x).forEach(freeze);
  }
  return x;
};

test("native options, defaults, environment precedence and strict validation", () => {
  assert.equal(loadMasterGoalConfig({}, {}).imageWindow, 1);
  assert.equal(
    loadMasterGoalConfig({}, { MASTERGOAL_IMAGE_WINDOW: "4" }).imageWindow,
    4,
  );
  assert.equal(
    loadMasterGoalConfig(
      { imageWindow: 0 },
      { MASTERGOAL_IMAGE_WINDOW: "garbage" },
    ).imageWindow,
    0,
  );
  for (const value of [0, 1, 2, 4, 8])
    assert.equal(
      loadMasterGoalConfig({ imageWindow: value }).imageWindow,
      value,
    );
  for (const value of [
    -1,
    1.5,
    "banana",
    "2",
    NaN,
    Infinity,
    null,
    undefined,
    true,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(
      () => loadMasterGoalConfig({ imageWindow: value }, {}),
      /imageWindow/,
    );
  for (const value of [
    "-1",
    "1.5",
    "garbage",
    "NaN",
    "Infinity",
    "",
    " ",
    "0x2",
    "1e2",
  ])
    assert.throws(
      () => loadMasterGoalConfig({}, { MASTERGOAL_IMAGE_WINDOW: value }),
      /imageWindow/,
    );
});

test("newest global images, mixed messages, stable order and persistence safety", () => {
  const input = freeze([
    Message.user([Message.text("first"), img("A")]),
    Message.user([img("B"), img("C")]),
    Message.assistant("reply"),
    Message.user([img("D"), img("E"), img("F")]),
  ]);
  for (const limit of [0, 1, 2, 4, 8]) {
    const output = applyImageWindow(input, limit);
    assert.deepEqual(
      images(output.messages).map((p) => p.media.source.data),
      limit ? ["A", "B", "C", "D", "E", "F"].slice(-limit) : [],
    );
    assert.equal(output.found, 6);
    assert.equal(output.removed, Math.max(0, 6 - limit));
    assert.equal(output.messages[0].content[0].text, "first");
    assert(output.messages.every((m) => m.content.length));
    assert(output.messages.some((m) => m.content[0].text === "reply"));
  }
  assert.equal(images(input).length, 6);
  assert.equal(
    images(applyImageWindow(input).messages)[0].media,
    input[3].content[2].media,
  );
});

test("text only and a single image are unchanged", () => {
  for (const input of [[Message.user("hello")], [Message.user(img("A"))]])
    assert.equal(applyImageWindow(input).messages, input);
});

test("canonical media supports bytes, base64, URLs, data URLs and provider refs", () => {
  for (const asset of [
    Media.bytes(new Uint8Array([1]), "image/png"),
    Media.base64("AA==", "image/png"),
    Media.url("https://example.test/a", { mediaType: "image/png" }),
    Media.fromDataUrl("data:image/png;base64,AA=="),
    Media.ref("openai", "file-1", "image/png"),
  ]) {
    const input = [Message.user(Message.media(asset))];
    assert.equal(applyImageWindow(input, 0).messages.length, 0);
    assert.equal(
      applyImageWindow(input, 1).messages[0].content[0].media,
      asset,
    );
  }
});

test("tool screenshot files share the global budget; tool pairs and nonimages survive", () => {
  const files = ["A", "B"].map((id) => ({
    type: "file",
    mime: "image/png",
    uri: `data:image/png;base64,${id}`,
  }));
  const nonimages = [
    { type: "text", text: "result" },
    { type: "file", mime: "application/pdf", uri: "pdf" },
    { type: "file", mime: "audio/wav", uri: "audio" },
    { type: "file", mime: "text/plain", uri: "source" },
  ];
  const tool = Message.tool({
    id: "call",
    name: "browser",
    result: { type: "content", value: [...files, ...nonimages] },
  });
  const input = freeze([
    Message.assistant({
      type: "tool-call",
      id: "call",
      name: "browser",
      input: {},
    }),
    tool,
    Message.user(img("C")),
  ]);
  const out = applyImageWindow(input, 2).messages;
  assert.equal(images(out).length, 2);
  assert.equal(out[1].content[0].result.value[0].uri, files[1].uri);
  assert.deepEqual(out[1].content[0].result.value.slice(1), nonimages);
  const empty = applyImageWindow(
    [
      Message.tool({
        id: "x",
        name: "screen",
        result: { type: "content", value: files },
      }),
    ],
    0,
  ).messages;
  assert.equal(empty[0].content[0].id, "x");
  assert.equal(empty[0].content[0].result.type, "text");
  assert.equal(images(input).length, 3);
});

test("unusual unrelated content does not bypass enforcement", () => {
  const unusual = [
    null,
    { type: "future", payload: { type: "image" } },
    { type: "tool-result", result: null },
  ];
  const result = applyImageWindow([
    { role: "user", content: [img("A"), ...unusual, img("B")] },
  ]);
  assert.deepEqual(result.messages[0].content.slice(0, 3), unusual);
  assert.equal(images(result.messages).length, 1);
});

test("every growing request through 1000 images retains the newest N", () => {
  const history = [];
  for (let i = 0; i < 1000; i++) {
    history.push(Message.user([Message.text(`turn ${i}`), img(String(i))]));
    for (const limit of [1, 4]) {
      const out = applyImageWindow(history, limit);
      assert.deepEqual(
        images(out.messages).map((p) => p.media.source.data),
        Array.from({ length: Math.min(i + 1, limit) }, (_, n) =>
          String(i - Math.min(i + 1, limit) + n + 1),
        ),
      );
    }
  }
  assert.equal(images(history).length, 1000);
});
