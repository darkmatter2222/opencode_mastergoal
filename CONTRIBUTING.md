# Contributing

Use Node.js 22+ and `npm ci`. Run `npm run verify` before proposing changes. Core logic has no OpenCode dependency; adapters must compile against pinned public SDK types. Add a regression for any bug that could admit a false completion, duplicate continuation, lost cancellation, or incorrect usage count.

Do not add a model-facing lifecycle mutation tool. A new completion check must fail closed on malformed inputs, execution errors, and missing evidence. Never map budget exhaustion, interruption, checker timeout, or contract mutation to completed. Keep forever-mode completion structurally disabled.

Build with `npm run build`; release artifacts are generated into dist. `npm pack --dry-run` checks package contents. No registry publication is performed automatically. CI checks types, tests, benchmarks and package assembly. Real-host canaries use only a local fake provider and should be rerun whenever adapter APIs or packaging change.

Use explicit tests of invariants rather than inflating test counts with equivalent assertions. Benchmarks must disclose their population, driver and timing basis. Do not represent scripted-candidate benchmarks as live-model success rates.
