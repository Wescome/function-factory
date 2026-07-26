/**
 * PLAYBOOK-KEEL-UPGRADE-001 (A.3): a compile-level existence check that the
 * new Agent primitives KEEL will need in later phases (subAgent, stash,
 * onFiberRecovered, keepAlive/keepAliveWhile) are present on the base `Agent`
 * class in `agents@0.19.0`. Type-only -- erased at compile time, no runtime
 * code, nothing wired. If any of these members are renamed or removed in a
 * future bump, this file fails to typecheck at exactly that line.
 */
import type { Agent } from "agents";

type AnyAgent = Agent<unknown>;

export type _SubAgent = AnyAgent["subAgent"];
export type _Stash = AnyAgent["stash"];
export type _OnFiberRecovered = AnyAgent["onFiberRecovered"];
export type _KeepAlive = AnyAgent["keepAlive"];
export type _KeepAliveWhile = AnyAgent["keepAliveWhile"];
export type _StartFiber = AnyAgent["startFiber"];
