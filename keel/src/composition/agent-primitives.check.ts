/**
 * PLAYBOOK-KEEL-UPGRADE-001 (A.3): a compile-level existence check that the
 * new Agent primitives KEEL will need in later phases (subAgent, stash,
 * onFiberRecovered, keepAlive/keepAliveWhile) are present on the base `Agent`
 * class in `agents@0.19.0`. Type-only -- erased at compile time, no runtime
 * code, nothing wired. If any of these members are renamed or removed in a
 * future bump, this file fails to typecheck at exactly that line.
 *
 * PLAYBOOK-KEEL-TYPING-001: also the canonical pattern reference for
 * REACHING these primitives -- call them directly on `this`
 * (`this.startFiber(...)`, and later `this.subAgent(...)`, `this.stash(...)`,
 * `this.keepAlive()`/`this.keepAliveWhile(...)`), never through an
 * `as unknown as {...}` cast. `Orchestrator extends Agent<Env>`, so the base
 * class's real types already cover the call site -- a cast-through-`unknown`
 * only hides drift (a real removal would compile clean) instead of
 * surfacing it.
 */
import type { Agent } from "agents";

type AnyAgent = Agent<unknown>;

export type _SubAgent = AnyAgent["subAgent"];
export type _Stash = AnyAgent["stash"];
export type _OnFiberRecovered = AnyAgent["onFiberRecovered"];
export type _KeepAlive = AnyAgent["keepAlive"];
export type _KeepAliveWhile = AnyAgent["keepAliveWhile"];
export type _StartFiber = AnyAgent["startFiber"];
