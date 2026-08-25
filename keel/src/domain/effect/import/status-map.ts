/**
 * effect/import/status-map.ts — Descriptor II.3: pure HTTP status -> ErrorClass.
 * Feeds `EffectSignature.errors`, which flows through the already-shipped
 * `classifyTerminal` into `decide()`'s terminalError branch. Pure, substrate-free.
 */
import type { ErrorClass } from "../errors";

/** `undefined` for a status this map doesn't recognize — the caller decides
 *  whether to drop it or fall back to something conservative; this function
 *  never guesses. */
export function statusToErrorClass(status: number): ErrorClass | undefined {
  switch (status) {
    case 400: return "InvalidResponse";
    case 401: return "AuthenticationFailed";
    case 403: return "PermissionDenied";
    case 404: return "InvalidResponse";
    case 409: return "Conflict";
    case 429: return "RateLimited";
    case 501: return "OperationUnsupported";
    default:
      // Generic 5xx: transient server failure — RateLimited is the closest
      // existing "worth a retry/backoff" class (Descriptor's "RateLimited-like").
      if (status >= 500 && status < 600) return "RateLimited";
      return undefined;
  }
}
