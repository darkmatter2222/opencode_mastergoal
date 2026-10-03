# Research notes and design decisions

Research date: 2026-10-03. This repository is an original implementation. Reference repositories were read to understand public APIs, behavior and tradeoffs; their goal engine, adapters, installers and tests were not copied.

## Primary sources inspected

- [OpenCode plugin documentation](https://opencode.ai/docs/plugins/), server SDK and command execution/compaction source.
- [OpenCode repository](https://github.com/anomalyco/opencode): 1.x source commit `907b3bc518fa48e90e8ec24dd327d13eee71c36c`; v2 branch commit `d1f8f5b35ef90499902797129457f2102abe18b6`. Current compilation uses `@opencode/plugin@2.0.22` only; the 1.x source inspection is historical research, not supported functionality.
- [ByBrawe/OpenCode Goals](https://github.com/ByBrawe/opencode-goal), version 1.3.45, commit `fb251573e65c6e25a8bbef7216eaf5c34491d24d`: package entries, contract/file verification, completion audit, semantic verifier, lifecycle integration, telemetry and sidebar.
- [Anthropic's Ralph Loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop), repository commit `d182ca456ca09d31d139f7d3818d1d333b103cce`: stop hook and completion-promise handling.
- [Ralph Orchestrator](https://github.com/mikeyobrien/ralph-orchestrator), commit `edc2b3268c9bd0c08a12c8193a7ace7ab2789261`: quality gates and reviewer/event workflow.
- [Aider lint/test documentation](https://aider.chat/docs/usage/lint-test.html): automatic checks and repair feedback.
- [OpenCode TPS meter](https://github.com/kkazakov/opencode-tps-meter-plugin) and [TPS meter](https://github.com/ChiR24/opencode-tps-meter): distinctions between estimated streaming throughput and provider-reported token counts.

## Comparison

| Approach             | Useful property                                                                  | Tradeoff for this project                                                                            | Master Goal decision                                                               |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| OpenCode Goals       | Already has persisted goals, host evidence and independent semantic verification | Semantic “proven” findings still need interpretation; it is not merely a completion-string loop      | Require explicit deterministic checks and never give prose a completion transition |
| Ralph Loop           | Simple persistent repetition through a stop hook                                 | Completion promises are assistant-emitted text; an iteration cap is a separate termination condition | No completion promises; no default iteration cap; stop is separate from success    |
| Ralph Orchestrator   | Quality gates and reviewer roles can reject unfinished work                      | More coordination roles do not by themselves prove the underlying evidence                           | Keep verification authority in a small host engine; optional review can only veto  |
| Aider test feedback  | Executes concrete lint/test commands and feeds failures back                     | Passing configured checks is narrower than proving a broad project objective                         | Use explicit, independently inspectable outcome tests                              |
| Streaming TPS meters | Immediate feedback during generation                                             | Byte-to-token estimates are approximate; rate windows differ                                         | Use OpenCode 2’s native speed display; retain goal token totals                    |

These are design observations, not measured competitor rankings. The reported premature stopping of the user's previous setup was not reproduced against its exact historical configuration. The current upstream repository already implements substantial verification and regression testing; attributing the issue to “it only trusts done” would be inaccurate.

## Host findings that affected implementation

As of 0.3.0, only OpenCode 2.x is supported. Earlier-generation findings below are historical comparisons.

1. OpenCode 1.x continuation is event-driven; there is no universal plugin stop-veto hook in the inspected interface.
2. Native 2.x commands can execute directly, so model-mediated lifecycle tools are unnecessary.
3. Sidebar slots are available, but have different API names between generations.
4. Native 2.x configured local plugins are directories, with server/tui entrypoint discovery. Direct file URLs are rejected there. Master Goal ships root entrypoint wrappers and a version-aware installer.
5. Native RPC calls need the selected session's server location. The sidebar supplies it explicitly.
6. Compaction hooks must carry durable task data back into context. A summary alone is not an authoritative contract.
7. Master Goal delegates throughput display to OpenCode 2 and retains token totals for goal budgets.

## Deliberate scope

No “best in the world,” zero-failure, or competitor-performance claim is made. The included corpus measures deterministic state-machine behavior with known candidate solutions, and local fake-model canaries measure actual host integration. Long production workloads, genuine model coding quality, provider outages and multi-process distributed execution require separate evidence.
