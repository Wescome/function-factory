// The single place codemode's runtime is constructed. Adapters below take the
// handle it returns; the domain never sees any of this (D6).
import { createCodemodeRuntime, DynamicWorkerExecutor, type CodemodeConnector } from "@cloudflare/codemode";

export type CodemodeHandle = ReturnType<typeof createCodemodeRuntime>;

export function makeRuntime(
  ctx: DurableObjectState,
  loader: unknown,
  connectors: CodemodeConnector<unknown>[],
): CodemodeHandle {
  return createCodemodeRuntime({
    ctx,
    connectors,
    executor: new DynamicWorkerExecutor({ loader: loader as never }),
    // globalOutbound omitted -> defaults to null (isolated), confirmed M0/S4.
  });
}
