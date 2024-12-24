# Mutation Test Scope Planner

Offline, read-only planning from a complete exported function, dependency, and test-coverage map. It selects mutation targets and affected tests; it does not execute mutations or claim a mutation score.

## Run

Node.js 22+; no dependencies or network calls.

```sh
node bin/mutation-test-scope-planner.mjs --root examples/pass --input evidence.json
node bin/mutation-test-scope-planner.mjs --root examples/fail --input evidence.json
npm run check
```

`--help` prints usage. Normal runs emit one JSON report on stdout and no other stdout text: exit 0=`pass`, 1=`fail`, 2=`incomplete` or invalid configuration. Invalid options or root produce empty stdout; an unreadable, undecodable, malformed, or out-of-root named input produces an incomplete report. The named input is realpath-confined to the root. UTF-8 decoding is strict; duplicate decoded JSON keys are rejected. Nothing is written.

## Exported evidence

The input is one JSON object:

```json
{
  "schemaVersion": "1",
  "complete": {"changes": true, "dependencies": true, "coverage": true},
  "secondsPerMutant": 3,
  "functions": [
    {"id": "branch", "public": true, "changed": true, "mutants": 4},
    {"id": "wrapper", "public": true, "changed": false, "mutants": 0}
  ],
  "dependencies": [{"caller": "wrapper", "callee": "branch", "kind": "static"}],
  "tests": [{"id": "branch-test", "covers": ["branch"]}, {"id": "wrapper-test", "covers": ["wrapper"]}]
}
```

The producer must assert all three completeness flags from an actual export; this tool cannot establish completeness on its own. Function and test IDs are opaque identities, not paths. `dependencies` point from caller to callee. A changed target selects tests covering it or any transitively dependent caller. Dynamic and unsupported dependency kinds, partial evidence, unknown identities, malformed records, and no changed target are `incomplete`. A changed target with no dependent tests in otherwise complete evidence is a `fail`. Duplicated function/test identities or static dependency edges are incomplete. Optional top-level `metadata` is ignored, bounded by the same JSON limits.

The report's `plan` contains only logical source pointers, `risk` (`high` for public targets, `medium` otherwise), affected test pointers, declared estimated mutant count, and an estimated duration (`mutants × secondsPerMutant`). These are planning estimates, not outcomes or scores. `summary.checked` counts changed targets. Findings use fixed messages and `@evidence` as logical provenance; pointers identify the exact item in the file named at invocation. No raw IDs or source content enter the report. Findings sort by `(pointer, ruleId)` using UTF-16 code-unit order.

## Limits and non-goals

Input ≤65,536 bytes, ≤100 functions, ≤200 dependencies, ≤100 tests, ≤100 coverage references per test, JSON depth ≤16, and evaluation time ≤5,000 ms through an injected monotonic clock. `secondsPerMutant` is 1–3,600 and `mutants` is 0–1,000 per function; changed functions must have at least one candidate. Each inclusive maximum accepts N and rejects N+1. No implicit repository scan, source parsing, dynamic-call inference, mutation run, mutation score, or live CI integration is performed.
