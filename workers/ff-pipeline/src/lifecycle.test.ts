import type { LifecycleTransition } from './lifecycle';

/**
 * Atom 005: Verify that LifecycleTransition is exported as an interface.
 *
 * TypeScript interfaces support declaration merging, while type aliases do not.
 * If LifecycleTransition were a type alias, the augmentation below would
 * raise a compile-time duplicate identifier error.
 */
declare module './lifecycle' {
  interface LifecycleTransition {
    __atom005InterfaceBrand?: true;
  }
}

export type _Atom005LifecycleTransitionIsInterface = LifecycleTransition;
