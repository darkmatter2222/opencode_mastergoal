# Validation record

Executed 2026-10-03 on Linux x64, Node.js 24.19.0. This records observed results, not a guarantee of production perfection.

| Gate                    | Result                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript check | Passed against both pinned SDKs                                                                                                                                           |
| Automated tests         | 106 passed, 0 failed                                                                                                                                                      |
| Deterministic corpus    | 20/20 scenarios passed                                                                                                                                                    |
| Real OpenCode 1.18.34   | Command loaded; construct reached model; 3 run fake-model requests; 3 verifications; completion only after artifact passed; 36 output tokens accounted                    |
| Real OpenCode 2.0.22    | Command loaded; construct reached model; 3 run fake-model requests; 3 verifications; completion only after artifact passed; 30 output tokens accounted; status RPC passed |
| Native sidebar render   | OpenTUI test renderer at 42×18; status/progress/TPS visible; remote session location passed to RPC                                                                        |
| npm package assembly    | Packaged npm exec install/uninstall passed for local v1 and global v2; durable runtime CLI passed                                                                         |

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
npm install --prefix .host-v1 opencode-ai@1.18.34
npm install --prefix .host-v2 @opencode/cli@2.0.22
node scripts/host-canary-v1.mjs "$PWD/.host-v1/node_modules/.bin/opencode"
node scripts/host-canary-v2.mjs "$PWD/.host-v2/node_modules/.bin/opencode"
BUN_BE_BUN=1 .host-v2/node_modules/.bin/opencode --conditions=browser scripts/tui-canary.mjs
```

Both canaries start an isolated local fake provider and temporary OpenCode state. The provider emits premature completion claims. A checked artifact is deliberately absent until later requests; the goal may complete only afterward. Construction dispatch is also checked at the model request boundary. These fake models do not generate verifiers; semantic quality of model-generated checks is not measured. No real provider credentials or paid model calls are used. The TUI canary renders the actual sidebar component with a mocked RPC boundary, not a full interactive terminal session.

## Limits of this evidence

The six-platform/node CI matrix and real-host job passed on GitHub for the Windows process-cleanup fix (run 37157718683). The 0.2.1 workflow additionally tests packaged installation on Windows with Node 22.18.0 and npm 10.9.3. Windows process-tree cancellation is limited to the direct child. Live cloud-provider reliability, weeks-long runs, genuine coding-task success rate, model-specific compaction quality, malicious same-user shell attacks, and active-active server operation are not certified by these tests. This release is version 0.2.1; report reproducible host/runtime issues with the locked contract and redacted state.
