# Master Goal

**File-first goal orchestration for OpenCode. The model does the work. The host checks the result.**

Master Goal is an original implementation, built from scratch. It is not a fork of OpenCode Goals. It separates the agent's reasoning from the authority to declare completion.

A run locks a `goal.md` contract and the verifier scripts it references. Every deterministic check must pass before the run can complete. An optional independent reviewer can veto success. Model prose, completion promises, completed todos, and arguments that a goal is impossible cannot mark a run complete.

Explicit **forever mode** has no success transition and no default iteration, token, cost, or elapsed-time cap. `/goal stop` or `/goal end` stops it. Host shutdown, permission waits, errors, and unavailable providers can interrupt execution; none count as success.

## Install from this repository

Requires Node.js 22+ for the CLI/check runner. The TUI runs inside OpenCode's Bun runtime. Tested host versions and evidence are in [validation](docs/validation.md).

```sh
git clone https://github.com/darkmatter2222/opencode_mastergoal.git
cd opencode_mastergoal
npm ci
npm run build
node dist/cli.js install --host 1 /absolute/path/to/your/project
```

Use `--host 2` for OpenCode 2.x. On Windows, quote paths such as `"C:\Users\Ryan\projects\my-app"`. Installation adds local plugin references to the target project's configuration, preserves JSONC comments and existing settings, and backs up changed config files. Keep this checkout in place. Fully restart OpenCode afterward.

**Disable other plugins that own `/goal` or automatically inject continuation prompts in this session.** One scheduler should own the run. Do not load both Master Goal server adapters together.

This package is **not published to npm yet**. The source installation above works without an npm release. To update: `git pull`, `npm ci`, `npm run build`, then restart OpenCode. To unregister it:

```sh
node dist/cli.js uninstall --host 1 /absolute/path/to/your/project
```

Uninstall preserves goals, verifier scripts, and run history. For remote OpenCode 2 servers, install the server package on the server and configure the TUI package on the client; its sidebar reads state through RPC. The 1.x sidebar supports local client/server use only.

## First goal

In OpenCode:

```text
/goal init
```

This creates `goal.md` and `goal.verify.mjs` without overwriting existing files. Edit both before starting. The generated verifier deliberately fails until implemented. You can ask an agent to draft the contract, but review it before `/goal start`; starting is the action that locks it.

````markdown
# Implement addition

Implement `add(a, b)` in `src/add.mjs`. Preserve existing public APIs.

```mastergoal
{
  "version": 1,
  "title": "Correct addition implementation",
  "mode": "verified",
  "checks": [
    {
      "id": "addition-acceptance",
      "type": "script",
      "runtime": "node",
      "path": "goal.verify.mjs",
      "timeoutMs": 30000
    }
  ]
}
```
````

`goal.verify.mjs`:

```js
import assert from "node:assert/strict";
import { add } from "./src/add.mjs";
assert.equal(add(1, 1), 2);
assert.equal(add(-3, 4), 1);
assert.equal(add(0, 0), 0);
```

Then:

```text
/goal start
/goal status
```

The plugin executes checks itself when the host finishes working. Failing evidence is included in the next turn. `goal.md` is reinjected into system context and compaction context from its durable locked snapshot.

## Commands

| Command                     | Behavior                                                      |
| --------------------------- | ------------------------------------------------------------- |
| `/goal init [path]`         | Create the Markdown and script templates; default `goal.md`   |
| `/goal start [path]`        | Validate and lock a new goal; custom paths can contain spaces |
| `/goal forever [path]`      | Lock a goal with completion disabled                          |
| `/goal status`              | Show verified progress and usage                              |
| `/goal inspect`             | Show the full contract, evidence, and recent history          |
| `/goal check`               | Run a fresh verification on an active goal                    |
| `/goal pause`               | Pause automatic continuation                                  |
| `/goal resume`              | Resume the existing paused or blocked contract                |
| `/goal stop` or `/goal end` | Stop the run without claiming success                         |
| `/goal help`                | Show command help                                             |

Changing the goal or a pinned verifier during a run blocks verification. To revise the contract, stop, edit, and start a new run. Resuming does not approve changed files. Stop/pause cancel verification and future continuation; use OpenCode's interrupt control to cancel an already-running model/tool action.

The terminal CLI also supports `validate`, `status`, `inspect`, `check`, `pause`, `resume`, and `stop`. Session operations require `--session SESSION_ID` and the original project directory. Start new runs inside OpenCode so they bind to the correct session.

## Deterministic checks

All checks use AND semantics. `verified` mode rejects an empty check list.

| Type     | Required fields                    | Pass condition                                                               |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `equals` | `id`, `type`, `actual`, `expected` | Strict deep equality of JSON values; no coercion or expression evaluation    |
| `file`   | `id`, `type`, `path`               | Regular file exists; optional `contains` and `sha256` constraints also match |
| `script` | `id`, `type`, `path`, `runtime`    | Pinned local script exits 0 within timeout and output limits                 |

Script options: `args` (argument array), `timeoutMs` (default 30,000), and `pin` (additional verifier dependencies whose bytes must not change). The script path itself is always pinned. Script invocations do not interpolate a shell command. Paths must resolve inside the project, including symlink targets.

A check such as `{"id":"impossible","type":"equals","actual":2,"expected":3}` can never pass. The model's reasoning cannot change those values. For a computation, put the computation in a pinned script; a string like `"1+1"` is just a string, not executable arithmetic.

**Use outcome checks, not self-reports.** A file-existence test proves existence, not quality. A test that looks only for the word “done” is easy to satisfy. Independent assertions, fixed test datasets, exact artifact hashes, and external verification services are stronger. Pin test helpers, test configuration, and lockfiles where they are part of your acceptance boundary. See [contract design](docs/contracts.md).

## Optional non-deterministic review

Add a `review` script with the same shape as a script check. It runs only after all deterministic checks pass. Its nonzero exit, timeout, malformed response, or unavailability vetoes completion. It cannot override a failed deterministic check.

[Optional reviewer example](examples/optional-review/review.mjs) calls a separately configured OpenAI-compatible endpoint with tool-free review instructions and a strict JSON verdict. It uses `MASTERGOAL_REVIEW_URL`, `MASTERGOAL_REVIEW_MODEL`, and optionally `MASTERGOAL_REVIEW_KEY`. This can point to a local model. Add a review entry such as:

```json
"review": {
  "id": "independent-review",
  "type": "script",
  "runtime": "node",
  "path": "review.mjs",
  "args": ["README.md"],
  "timeoutMs": 30000
}
```

Copy and customize the script before starting. Review is probabilistic and susceptible to evidence bias; deterministic checks remain mandatory. A prose goal cannot in general be automatically converted into a complete proof of success.

## Sidebar and telemetry

The sidebar shows run state, mode, checked criteria, verification iterations, assistant turns/steps, input/output/reasoning tokens, cache reads/writes, host-reported cost, output tokens per second, review verdict, and available native todos.

- **Check percentage** means passing checks / total checks. It is not a prediction of time remaining or overall task completion.
- **Output/s** is provider-reported output tokens divided by measured request elapsed time. It includes request overhead. It is not raw GPU decode speed and is updated at completed message/step boundaries.
- **Turns** count completed assistant messages in 1.x and provider steps in 2.x. They are not user-message counts.
- **Cost** comes from the host. Zero can mean the provider did not supply pricing.
- Usage is scoped to the bound session after goal start. Child-agent sessions and optional external reviewer usage are not included.
- Replayed usage events are deduplicated. The exact usage ledger grows with the run; current history is capped at 200 events.

## Long-running behavior

There are no default budgets. If you want opt-in controls, add:

```json
"limits": { "turns": 1000, "tokens": 10000000, "cost": 50, "elapsedMs": 86400000 }
```

A reached budget pauses the goal; it never completes it. Limits are checked before the next verification/continuation, not mid-request. A single turn can exceed a budget. `elapsedMs` measures wall time since start, including pauses. To change a locked budget, stop and start a revised contract.

The contract and state persist outside the project at `~/.local/state/opencode-mastergoal`, indexed by canonical project path and session ID. Set `MASTERGOAL_STATE_DIR` before starting OpenCode to override it. Atomic state replacement, filesystem locking, cancellation tokens, and run IDs protect ordinary concurrent transitions. Interrupted verifications must be rerun. On host restart, the previous run pauses for explicit `/goal resume`; no successful state is inferred from a crash.

This is an in-process plugin, not an external watchdog or OS sandbox. It cannot run while OpenCode is closed, guarantee network availability, defeat a hostile process with the same OS permissions, or make an insufficient verifier prove your intent. Direct edit hooks and hash checks are tamper detection, not a security boundary against arbitrary shell access. [Architecture and boundaries](docs/architecture.md) explains these limits.

## Tests and benchmarks

```sh
npm run verify
npm run benchmark
```

The suite covers parser validation, path escapes, script crashes/timeouts/output overflow, false completion claims, verifier changes, cancellation races, duplicate idle events, pause/stop/resume, restart persistence, usage replay, adapters, and installer preservation.

Copy one example directory’s files into the root of a disposable project, then use `/goal start` there. Verifier paths are relative to the project root.

The [20 sample goals](examples/) include 12 runnable coding exercises and eight adversarial scenarios. `benchmarks/run.mjs` records per-case latency and expected state transitions to `benchmarks/latest.json`. This is a **deterministic harness benchmark using scripted candidate solutions**, not a claim of superior LLM coding performance. Real-host canaries exercise OpenCode with a local fake model that repeatedly claims completion. See [validation](docs/validation.md) for actual results and reproducible commands.

## Developer guide

`src/contract.ts` defines parsing and locking; `checks.ts` runs verifiers; `engine.ts` owns state transitions; `coordinator.ts` owns continuation admission. `v1.ts` and `server.ts` adapt the two host APIs. `tui-v1.ts` and `tui.ts` render read-only status. `rpc.ts` is the native sidebar's portable status contract.

See [research](docs/research.md), [architecture](docs/architecture.md), [contract design](docs/contracts.md), and [contributing](CONTRIBUTING.md). MIT licensed.
