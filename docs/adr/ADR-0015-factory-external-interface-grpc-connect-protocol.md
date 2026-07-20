# ADR-0015 — Factory External Interface: Connect Protocol for gRPC Transport

**Status:** ACCEPTED  
**Date:** 2026-06-15  
**Closes:** OPEN-Q-1 from Factory-External-Interface-gRPC-GraphQL_v3.md

## Decision

The `factory-gateway` Worker uses the **Connect protocol** (buf.build/connect) as the gRPC transport over HTTP/1.1 + binary framing.

## Rationale

Native gRPC requires HTTP/2 for inbound traffic, which CF Workers does not support. Three options were evaluated:

| Option | Verdict |
|--------|---------|
| gRPC-Web | Works, but requires gRPC-Web client library on every caller; standard gRPC clients cannot connect directly |
| **Connect protocol** | Works on CF Workers natively; compatible with standard gRPC clients via Connect SDK; first-class TypeScript/Node support matching the stack |
| CF Tunnel + grpc-gateway sidecar | Adds infra outside the CF boundary — contradicts the CF-native architecture |

Connect is the only option that works cleanly from **CF Workers callers** (WeOps Kernel, which is the primary submission path) and from external callers (CI/CD pipelines, developer CLI) without a sidecar.

## Client impact

- **WeOps Kernel (CF Worker):** uses Connect TypeScript client — no native gRPC required
- **CI/CD pipelines (GitHub Actions):** uses Connect Node.js or Go client
- **Developer CLI:** uses Connect TypeScript/Node client
- **Linear:** not a direct gRPC client — routes through `linear-bridge` Worker (already built, GAP-010)
- **Dashboards:** use GraphQL surface — not affected

## Implementation note

`factory-gateway` depends on `@connectrpc/connect` and `@connectrpc/connect-web`. Proto definitions compile via `buf generate`. No grpc-gateway sidecar, no CF Tunnel.
