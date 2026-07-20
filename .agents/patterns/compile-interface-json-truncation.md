# Pattern: compile-interface JSON truncation

**Observed:** 2026-06-08, pipeline runs d409750f and b2e88972

## Symptom

`compile-interface` step fails with:
```
Compile pass interface: JSON parse failed after repair.
Error: Expected ',' or '}' after property value in JSON at position N
```

All 3 retries fail. Pipeline terminates at this step.

## Trigger

Signals that generate complex interface contracts with deeply nested JSON schemas (e.g. cache invalidation, rate-limiting). The LLM produces output that is truncated mid-JSON, likely due to hitting the output token limit.

## Examples of failing signal domains
- "Refactor rate-limiter middleware for edge caching"
- "Refactor distributed cache invalidation layer"

Both generate interface contracts with complex nested object schemas that overflow the model output.

## Mitigation

Use simpler signals for test runs — prefer domains that generate flat/shallow interface contracts (auth, logging, simple CRUD). Avoid cache/performance optimization signals for pipeline E2E tests.

## Permanent fix (not yet implemented)

The compile-interface pass should instruct the LLM to produce minimal interface definitions — no deep nesting, no inline JSON Schema. A simpler output format would reduce token pressure and prevent truncation.
