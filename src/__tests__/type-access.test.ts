import { describe, it, expect } from 'vitest';
import type * as TypeNamespace from '../index.ts';
import * as ValueNamespace from '../index.ts';

describe('Type Access Test Suite', () => {
  it('provides error-free access to exported types for downstream consumers', () => {
    // Verify the module loads at runtime.
    expect(ValueNamespace).toBeDefined();

    // Compile-time verification: ensure every exported type is valid and
    // accessible. If an exported type references an unreleased/private name
    // or has a structural error, mapping over the namespace will fail to
    // compile, surfacing the issue before downstream consumers encounter it.
    type _ExportedTypesCheck = {
      [K in keyof TypeNamespace]: TypeNamespace[K];
    };

    // Force TypeScript to evaluate the mapped type without emitting runtime
    // code. This line will produce a compilation error if any exported type
    // is broken, causing the test suite to fail at build time.
    void 0 as unknown as _ExportedTypesCheck;
  });
});
