# Domain Factory Kernel

**Status:** Active architecture anchor
**Date:** 2026-05-10

The Function Factory is a domain-neutral compiler for trustworthy executable
Functions. Coding is one adapter domain. It is not the Factory's identity.

The kernel accepts domain Signals, derives Pressures and Capabilities, proposes
Functions, compiles Intent Specifications into Executable Specifications,
executes Functions through a domain adapter, verifies evidence, and feeds
observations back into the loop.

## Kernel Vocabulary

These are the canonical concepts for active architecture work:

| Concept | Meaning |
| --- | --- |
| Signal | An observation from any domain substrate. |
| Pressure | A forcing function on the organization or system. |
| Capability | A needed ability exposed by one or more Pressures. |
| Function Proposal | A proposed executable capability with lineage. |
| Function | The governed executable unit produced by the Factory. |
| Intent Specification | The human/domain-facing specification of desired behavior. |
| Executable Specification | The machine-actionable plan for execution. |
| Verification | A fail-closed evidence check. |
| Evidence | Observations, traces, results, reports, or domain proofs used by Verification. |
| Lifecycle | The governed state machine for a Function. |
| Domain Adapter | The boundary that maps kernel execution to a specific substrate. |

## Kernel Pipeline

```
Signal -> Pressure -> Capability -> Function Proposal
  -> Intent Specification -> Executable Specification
  -> Domain Adapter Execution -> Evidence
  -> Verification -> Lifecycle Decision
  -> Observation -> Signal
```

This loop is domain-neutral. The same kernel can govern software changes,
document operations, financial controls, legal review workflows, clinical
protocol checks, manufacturing operations, or any other domain where an Intent
can be compiled into a governed executable Function.

## Domain Adapter Boundary

A Domain Adapter owns substrate-specific translation. It can expose domain
tools, evidence sources, execution semantics, and artifact renderers, but it
does not redefine the kernel.

The coding adapter owns terms such as:

| Coding adapter term | Kernel role |
| --- | --- |
| repository | domain substrate |
| branch | execution workspace |
| pull request | handoff artifact |
| diff | effector realization artifact |
| CI check | Verification evidence source |
| test result | Evidence |
| code review | human governance input |
| deployment | lifecycle transition substrate |

Those terms must not appear as kernel categories in new architecture. They may
appear inside coding-adapter docs, tests, workers, or historical references.

## Hard Cutover Rule

New refactors should not add dual ontology/coding names as a permanent strategy.
When a surface is cut over, it should move to the kernel term and delete the old
active name in the same change, with data migration where persisted records are
affected.

Historical artifacts may keep their original names. Active architecture and new
source code should use kernel names first and restrict coding-specific language
to adapter boundaries.

## First Adapter

The current repository is the bootstrap coding adapter and implementation host.
That gives useful evidence, but it is not the product boundary. The product
boundary is the kernel above plus any number of Domain Adapters.
