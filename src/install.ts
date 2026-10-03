import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export async function install(
  root: string,
  remove = false,
  packageRoot?: string,
) {
  const runtime =
    packageRoot ?? path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const spec = pathToFileURL(runtime).href;
  const owned = (value: unknown) => {
    const item =
      typeof value === "string"
        ? value
        : value && typeof value === "object" && "package" in value
          ? value.package
          : undefined;
    if (typeof item !== "string") return false;
    return (
      item === spec ||
      item.startsWith(spec + "/dist/") ||
      /^@darkmatter2222\/opencode-mastergoal(?:@|$)/.test(item) ||
      /\/\.mastergoal-runtime\/node_modules\/@darkmatter2222\/opencode-mastergoal(?:\/(?:dist\/(?:v1|tui-v1|server|tui)\.js))?\/?$/.test(
        item,
      )
    );
  };
  const plans: {
    file: string;
    before: string;
    after: string;
    exists: boolean;
  }[] = [];
  // OpenCode 2 discovers the TUI entrypoint from the server registration.
  // Old tui/cli entries are cleaned up only if present; never create them.
  for (const name of ["opencode", "tui", "cli"]) {
    let before = "{}\n",
      file = path.join(root, name + ".json"),
      exists = false;
    for (const ext of name === "cli" ? ["json"] : ["jsonc", "json"]) {
      try {
        before = await readFile(path.join(root, `${name}.${ext}`), "utf8");
        file = path.join(root, `${name}.${ext}`);
        exists = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (!exists && (name !== "opencode" || remove)) continue;
    const errors: ParseError[] = [];
    const config = parse(before, errors, { allowTrailingComma: true });
    if (
      errors.length ||
      !config ||
      typeof config !== "object" ||
      Array.isArray(config)
    )
      throw new Error(`Invalid config: ${file}`);
    let after = before;
    const set = (key: string, value: unknown) => {
      after = applyEdits(
        after,
        modify(after, [key], value, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      );
    };
    for (const key of ["plugin", "plugins"])
      if (config[key] !== undefined && !Array.isArray(config[key]))
        throw new Error(`${key} must be an array in ${file}`);
    if (name === "opencode" && !remove) {
      const entries = [
        ...(config.plugin ?? []),
        ...(config.plugins ?? []),
      ].filter((x) => !owned(x));
      const unique = [
        ...new Map(entries.map((x) => [JSON.stringify(x), x])).values(),
      ];
      set("plugins", [...unique, spec]);
      if (config.plugin !== undefined) set("plugin", undefined);
    } else {
      for (const key of ["plugin", "plugins"]) {
        const entries: unknown[] | undefined = config[key];
        if (entries?.some(owned))
          set(
            key,
            entries.filter((x) => !owned(x)),
          );
      }
    }
    if (after !== before) plans.push({ file, before, after, exists });
  }
  await mkdir(root, { recursive: true });
  for (const p of plans) {
    if (p.exists) await writeFile(p.file + ".mastergoal.bak", p.before);
    await writeFile(p.file + ".mastergoal.tmp", p.after);
    await rename(p.file + ".mastergoal.tmp", p.file);
  }
  return plans.length
    ? plans.map((p) => p.file)
    : ["Configuration already up to date."];
}
