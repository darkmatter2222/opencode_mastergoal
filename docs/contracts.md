# Writing a completion contract

A useful contract tests the objective outside the executor's narrative. Draft it before work starts, inspect the failure case, and confirm the test fails on an incomplete implementation. Then `/goal start` pins the contract and verifier bytes.

## What to test

| Objective              | Stronger acceptance test                                                     | Weak substitute                               |
| ---------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Fix a bug              | Reproduce the bug with a pinned regression test and assert expected behavior | Search a changelog for “fixed”                |
| Produce a dataset      | Validate schema, row counts, invariants and a fixed holdout dataset          | Check that output.csv exists                  |
| Build an API           | Make independent requests and assert status, payload and failure behavior    | Read an agent-created test report             |
| Improve performance    | Run a fixed benchmark and compare a specified metric and environment         | Accept “looks faster”                         |
| Continuous maintenance | Explicit forever mode with useful work and a cadence in the objective        | Invent a pass condition that is normally true |
| Write documentation    | Check required examples/links plus an independent review veto                | Rely on one unconstrained model vote          |

The sample scripts import the implementation under test without pinning it; that implementation is the artifact the agent is supposed to change. Pin the verifier's own helpers, baseline data, runner configuration and dependency lockfile if changing them could weaken the test. A pinned script that invokes unpinned `npm test` can still be undermined by changing package.json or the tests. Pin those files too, or use an external trusted verifier.

## Equality checks

Equality uses strict deep comparison. Numbers do not equal numeric strings. Object key order is irrelevant; array order matters. Expressions are never evaluated. `actual: 2, expected: 3` is a permanently false contract. For `1 + 1 === 3`, an equivalent script is `process.exitCode = 1 + 1 === 3 ? 0 : 1`.

## Script execution

The runner passes an executable and an argument array directly to spawn, with no implicit shell. Runtimes can be `node`, `python3`, or an absolute executable path. Commands inherit the host environment and working directory, and run with host OS permissions. A script should be read-only with respect to acceptance artifacts, bounded, repeatable, and independently inspectable.

Output is capped at 64 KB, with up to 8 KB retained in evidence. File checks accept regular files up to 10 MB. Script timeouts default to 30 seconds and may be configured up to an hour. Linux/macOS timeout cancellation kills the spawned process group; Windows cancels the direct child and does not promise to terminate grandchildren.

Tests execute sequentially. The engine rechecks contract integrity after execution and only commits results to the same active run and verification token. It cannot make arbitrary mutable project inputs an atomic snapshot. For strict external assurance, test a fixed commit or isolated artifact with a separately permissioned service.

## Revision workflow

Never “fix” a failing test just to finish the run. If acceptance truly needs changing, use `/goal stop`, edit the contract, inspect it, then `/goal start`. A new run gets a new ID and revision; old evidence and usage cannot satisfy it. Keep goals and verifiers in version control so revisions are reviewable.

No LLM-generated function can prove every interpretation of natural-language intent. The narrow guarantee is: completion is gated by the locked checks you chose, and model prose has no completion authority.
