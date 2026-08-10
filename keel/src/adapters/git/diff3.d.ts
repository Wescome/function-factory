/**
 * PLAYBOOK-KEEL-SCR-PORT-2, Track 1: `diff3` (npm, MIT, independently
 * versioned) ships no type declarations of its own. This is the "public
 * door" OD-PORT-2 requires -- the same real dependency isomorphic-git's
 * OWN internal (unexported) `mergeFile()` wraps, confirmed against its
 * source (`node_modules/diff3/diff3.js`) and its own README.
 */
declare module "diff3" {
  export interface Diff3Ok {
    readonly ok: readonly string[];
  }
  export interface Diff3Conflict {
    readonly conflict: {
      readonly a: readonly string[];
      readonly aIndex: number;
      readonly o: readonly string[];
      readonly oIndex: number;
      readonly b: readonly string[];
      readonly bIndex: number;
    };
  }
  export type Diff3Chunk = Diff3Ok | Diff3Conflict;
  export default function diff3Merge(a: string[], o: string[], b: string[]): Diff3Chunk[];
}
