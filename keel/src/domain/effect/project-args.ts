/**
 * effect/project-args.ts — the input-side dual of `projectResponse`
 * (foreign/policy.ts): validates a recorded ConnectorCall's `args` against
 * the declared `argSchema` (INV-EFFECT-ARG-BOUNDED). Reuses `projectFields`
 * so both directions share one validation rule, not two.
 */
import { projectFields, type SchemaFields, type Projection } from "../foreign/policy";

export function projectArgs(argSchema: SchemaFields, args: unknown): Projection {
  const dropped: string[] = [];
  const projected = projectFields(args, argSchema, dropped, "");
  return { projected, dropped };
}
