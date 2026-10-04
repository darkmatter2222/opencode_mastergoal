import type { SessionRequest } from "@opencode/plugin/promise/session";

/** Read once at plugin startup. Explicit native plugin options win over env. */
export function loadMasterGoalConfig(
  options: Readonly<Record<string, unknown>> = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  const explicit = Object.prototype.hasOwnProperty.call(options, "imageWindow");
  const raw = explicit ? options.imageWindow : env.MASTERGOAL_IMAGE_WINDOW;
  const value =
    !explicit && raw === undefined
      ? 1
      : !explicit && typeof raw === "string" && /^\d+$/.test(raw)
        ? Number(raw)
        : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(
      "[mastergoal] imageWindow must be a non-negative safe integer (MASTERGOAL_IMAGE_WINDOW must contain decimal digits)",
    );
  return { imageWindow: value };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
const imageMime = (value: unknown) =>
  typeof value === "string" && /^image\//i.test(value);
/** Exact 2.0.22 canonical media and Tool.Content file representations. */
export function isImagePart(value: unknown): boolean {
  const part = record(value);
  if (part?.type === "media") {
    const media = record(part.media);
    return media?.kind === "image" || imageMime(media?.mediaType);
  }
  return part?.type === "file" && imageMime(part.mime);
}

/** Copy only changed containers; retain Media.Asset instances and payloads. */
export function applyImageWindow(
  messages: SessionRequest["messages"],
  limit = 1,
) {
  loadMasterGoalConfig({ imageWindow: limit }, {});
  let found = 0;
  const keep = (part: unknown) => !isImagePart(part) || ++found <= limit;
  const output: SessionRequest["messages"] = [];
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = messages[m]!;
    if (!Array.isArray(message?.content)) {
      output.push(message);
      continue;
    }
    const content = [];
    let changed = false;
    for (let p = message.content.length - 1; p >= 0; p--) {
      const part = message.content[p];
      if (!keep(part)) {
        changed = true;
        continue;
      }
      if (
        part?.type === "tool-result" &&
        part.result?.type === "content" &&
        Array.isArray(part.result.value)
      ) {
        const value = [];
        for (let i = part.result.value.length - 1; i >= 0; i--)
          if (keep(part.result.value[i])) value.push(part.result.value[i]);
        if (value.length !== part.result.value.length) {
          changed = true;
          // Keep the call/result pair valid even when the tool returned only images.
          content.push({
            ...part,
            result: value.length
              ? { ...part.result, value: value.reverse() }
              : {
                  type: "text" as const,
                  value:
                    "[Master Goal removed an older image from this request.]",
                },
          });
          continue;
        }
      }
      content.push(part);
    }
    if (!changed) output.push(message);
    else if (content.length)
      output.push({ ...message, content: content.reverse() });
  }
  const retained = Math.min(found, limit);
  return {
    messages: found > limit ? output.reverse() : messages,
    found,
    retained,
    removed: found - retained,
    limit,
  };
}
