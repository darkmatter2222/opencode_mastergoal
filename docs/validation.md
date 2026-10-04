# Validation record

Executed 2026-10-03 on Linux x64, Node.js 24.19.0. This records observed results, not a guarantee of production perfection.

| Gate                    | Result                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript check | Passed against the pinned OpenCode 2 SDK                                                                                                                                  |
| Automated tests         | 106 passed, 0 failed                                                                                                                                                      |
| Deterministic corpus    | 20/20 scenarios passed                                                                                                                                                    |
| Real OpenCode 2.0.22    | Command loaded; construct reached model; 3 run fake-model requests; 3 verifications; completion only after artifact passed; 30 output tokens accounted; status RPC passed |
| Native sidebar render   | OpenTUI test renderer at 42×18; status/progress/token totals visible; remote session location passed to RPC                                                               |
| npm package assembly    | Packaged npm exec install/uninstall passed for local and global OpenCode 2 configurations; durable runtime CLI passed                                                     |

## Reproduce

```sh
npm ci
npm run verify
npm pack --dry-run
node scripts/install-canary.mjs
```

The committed [benchmark results](benchmark-results.json) identify every scenario, expected state and measured local duration. Timing is platform-dependent. These tests use scripted candidates, not an LLM coding benchmark.

For real-host tests, install the exact host executables in disposable directories:

```sh
npm install --prefix .host-v2 @opencode/cli@2.0.22
node scripts/host-canary-v2.mjs "$PWD/.host-v2/node_modules/.bin/opencode"
BUN_BE_BUN=1 .host-v2/node_modules/.bin/opencode --conditions=browser scripts/tui-canary.mjs
```

The host canary starts an isolated local fake provider and temporary OpenCode state. The provider emits premature completion claims. A checked artifact is deliberately absent until later requests; the goal may complete only afterward. Construction dispatch is also checked at the model request boundary. These fake models do not generate verifiers; semantic quality of model-generated checks is not measured. No real provider credentials or paid model calls are used. The TUI canary renders the actual sidebar component with a mocked RPC boundary, not a full interactive terminal session.

## Limits of this evidence

The six-platform/node CI matrix and real-host job passed on GitHub for the Windows process-cleanup fix (run 37157718683). The current workflow additionally tests packaged installation on Windows with Node 22.18.0 and npm 10.9.3. Windows process-tree cancellation is limited to the direct child. Live cloud-provider reliability, weeks-long runs, genuine coding-task success rate, model-specific compaction quality, malicious same-user shell attacks, and active-active server operation are not certified by these tests. This release is version 0.3.0; report reproducible host/runtime issues with the locked contract and redacted state.

## Rolling image window — 2026-10-04 UTC

Pinned `@opencode/plugin@2.0.22` remains unchanged. Validation ran on Node 24.19.0 with the actual OpenCode 2.0.22 Linux x64 binary.

- `npm run verify`: 117 tests passed; 20/20 deterministic benchmark scenarios passed.
- `npm run test:install`: packaged local/global install, durable runtime and uninstall passed.
- `scripts/host-canary-v2.mjs`: admitted 100 distinct image-bearing user prompts with execution initially suspended, then started a finite goal. Three provider HTTP requests each contained exactly one image with no configuration supplied. All 100 screenshot filenames survived session export; construction, continuation, usage and sidebar RPC also passed.
- The same host canary with `CANARY_IMAGE_WINDOW=4` captured `[4, 4, 4]`; with `CANARY_IMAGE_WINDOW=0`, `[0, 0, 0]`. Both preserved all 100 persisted attachments.
- The canary additionally compares the final retained image URL against a distinct newest PNG. Automatic compaction is disabled in this fixture to prove pruning happens independently of compaction. The fake model does not implement the host's summary template. Compaction/title/generate filtering and existing goal injection are exercised at the official hook boundary by adapter tests.
- Unit tests cover 1,000 growing image-bearing turns, limits 0/1/2/4, ordering within/across messages, native `Media.Asset` sources, tool-result screenshot files, empty-image results, unusual non-image content, frozen source history, strict configuration and upgrade preservation.

Reproduce after `npm ci`:

```sh
npm run verify
npm run test:install
node scripts/host-canary-v2.mjs /absolute/path/to/opencode
CANARY_IMAGE_WINDOW=4 node scripts/host-canary-v2.mjs /absolute/path/to/opencode
CANARY_IMAGE_WINDOW=0 node scripts/host-canary-v2.mjs /absolute/path/to/opencode
```

The provider capture uses OpenAI-compatible HTTP, not a live vLLM model. Other provider formats are covered by the shared canonical API implementation, not by independent live-provider tests. Later third-party hook rewrites and opaque provider-managed image history are outside this plugin's enforceable boundary; see architecture notes.
