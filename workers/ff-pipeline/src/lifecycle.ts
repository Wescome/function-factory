/**
 * Represents the finite states of a pipeline lifecycle.
 */
export type LifecycleState =
  | 'created'
  | 'initialized'
  | 'configuring'
  | 'ready'
  | 'active'
  | 'pausing'
  | 'paused'
  | 'terminated';

/**
 * Represents a transition between two lifecycle states.
 */
export interface LifecycleTransition {
  from: LifecycleState;
  to: LifecycleState;
}
