import { describe, it, expect } from 'vitest';
import { resolveImportPaths, type ImportResolution } from '../src/index.js';

describe('resolveImportPaths', () => {
  describe('relative imports', () => {
    it('resolves ./state to sibling .ts file', () => {
      const result = resolveImportPaths(
        ['./state'],
        'workers/ff-pipeline/src/coordinator/coordinator.ts',
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.resolvedPath).toBe('workers/ff-pipeline/src/coordinator/state.ts');
      expect(result[0]!.kind).toBe('relative');
    });

    it('resolves ../agents/coder-agent to parent directory', () => {
      const result = resolveImportPaths(
        ['../agents/coder-agent'],
        'workers/ff-pipeline/src/coordinator/coordinator.ts',
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.resolvedPath).toBe('workers/ff-pipeline/src/agents/coder-agent.ts');
    });

    it('strips .js extension before resolving', () => {
      const result = resolveImportPaths(
        ['./state.js'],
        'workers/ff-pipeline/src/coordinator/coordinator.ts',
      );
      expect(result[0]!.resolvedPath).toBe('workers/ff-pipeline/src/coordinator/state.ts');
    });

    it('handles deeply nested relative imports', () => {
      const result = resolveImportPaths(
        ['../coordinator/state'],
        'workers/ff-pipeline/src/stages/compile.ts',
      );
      expect(result[0]!.resolvedPath).toBe('workers/ff-pipeline/src/coordinator/state.ts');
    });
  });

  describe('workspace package imports', () => {
    it('resolves @factory/* to packages/*/src/index.ts', () => {
      const result = resolveImportPaths(
        ['@factory/arango-client'],
        'workers/ff-pipeline/src/index.ts',
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.resolvedPath).toBe('packages/arango-client/src/index.ts');
      expect(result[0]!.kind).toBe('workspace');
    });

    it('resolves @weops/* to packages/*/src/index.ts', () => {
      const result = resolveImportPaths(
        ['@weops/gdk-agent'],
        'workers/ff-pipeline/src/agents/coder-agent.ts',
      );
      expect(result[0]!.resolvedPath).toBe('packages/gdk-agent/src/index.ts');
    });

    it('resolves @factory/diff-engine', () => {
      const result = resolveImportPaths(
        ['@factory/diff-engine'],
        'workers/ff-pipeline/src/stages/generate-pr.ts',
      );
      expect(result[0]!.resolvedPath).toBe('packages/diff-engine/src/index.ts');
    });
  });

  describe('external packages', () => {
    it('skips node_modules packages', () => {
      const result = resolveImportPaths(
        ['vitest', 'zod', 'agents'],
        'workers/ff-pipeline/src/index.ts',
      );
      expect(result).toHaveLength(0);
    });
  });

  describe('mixed imports', () => {
    it('resolves all resolvable imports from a real-world file', () => {
      const imports = [
        './state',
        '../agents/coder-agent',
        '@factory/arango-client',
        'vitest',
        '@factory/diff-engine',
      ];
      const result = resolveImportPaths(
        imports,
        'workers/ff-pipeline/src/coordinator/atom-executor.ts',
      );
      expect(result).toHaveLength(4);
      expect(result.map(r => r.kind)).toEqual(['relative', 'relative', 'workspace', 'workspace']);
    });
  });

  describe('edge cases', () => {
    it('handles empty import list', () => {
      const result = resolveImportPaths([], 'any/file.ts');
      expect(result).toHaveLength(0);
    });

    it('normalizes double slashes from parent traversal', () => {
      const result = resolveImportPaths(
        ['../index'],
        'workers/ff-pipeline/src/stages/compile.ts',
      );
      expect(result[0]!.resolvedPath).toBe('workers/ff-pipeline/src/index.ts');
      expect(result[0]!.resolvedPath).not.toContain('//');
    });
  });
});
