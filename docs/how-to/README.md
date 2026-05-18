# How-To Guides

This directory contains task-oriented operating procedures for the Function
Factory. A how-to should help an operator complete a concrete task without
also being the canonical architecture, contract, or backlog for that area.

## Current Guides

| Guide | Task |
| --- | --- |
| [`OPERATOR_RUN_CONTROLS.md`](OPERATOR_RUN_CONTROLS.md) | Use authenticated live run note, retry, redispatch, and cancel controls. |
| [`STRATEGY_RECIPES_DOGFOOD.md`](STRATEGY_RECIPES_DOGFOOD.md) | Run the Strategy.Recipes autonomous-scheduler dogfood flow. |

## Current Boundary

No other root-level `docs/*.md` file is currently classified as a pure how-to:

| Document | Current mode | Reason |
| --- | --- | --- |
| [`../AUTONOMOUS_FACTORY_TRANSITION.md`](../AUTONOMOUS_FACTORY_TRANSITION.md) | Explanation | Defines the operating model and transition sequence. |
| [`../TERMINAL_INTEGRATION_CONTRACT.md`](../TERMINAL_INTEGRATION_CONTRACT.md) | Reference | Defines the terminal integration contract. |
| [`../TERMINAL_IMPLEMENTATION_BACKLOG.md`](../TERMINAL_IMPLEMENTATION_BACKLOG.md) | Reference | Tracks implementation atoms and phase gates. |

Move additional files here only when the document is primarily procedural. Keep
a compatibility stub at the old path while the docs migration is in progress.
