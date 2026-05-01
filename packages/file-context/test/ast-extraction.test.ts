import { describe, it, expect } from 'vitest';
import { extractContext } from '../src/index.js';

describe('AST-based extraction — cases regex missed', () => {
  describe('arrow functions', () => {
    it('extracts exported arrow functions', () => {
      const code = `export const greet = (name: string): string => \`Hello \${name}\`;`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.exports).toContain('greet');
      expect(ctx.structure.functions.find(f => f.name === 'greet')).toBeDefined();
    });

    it('extracts exported async arrow functions', () => {
      const code = `export const fetchData = async (url: string): Promise<Response> => {
  return fetch(url);
};`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.exports).toContain('fetchData');
      expect(ctx.structure.functions.find(f => f.name === 'fetchData')).toBeDefined();
    });

    it('extracts non-exported arrow functions', () => {
      const code = `const helper = (x: number): number => x * 2;`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.functions.find(f => f.name === 'helper')).toBeDefined();
    });
  });

  describe('class methods', () => {
    it('extracts class method signatures', () => {
      const code = `export class UserService {
  async getUser(id: string): Promise<User | null> {
    return this.db.findOne(id);
  }

  createUser(data: Partial<User>): User {
    return this.db.insert(data);
  }
}`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.classes).toContain('UserService');
      expect(ctx.structure.exports).toContain('UserService');
    });
  });

  describe('destructured exports', () => {
    it('extracts re-exports from other modules', () => {
      const code = `export { foo, bar } from './utils';`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.exports).toContain('foo');
      expect(ctx.structure.exports).toContain('bar');
    });

    it('extracts renamed re-exports', () => {
      const code = `export { default as MyComponent } from './component';`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.exports).toContain('MyComponent');
    });

    it('extracts local destructured exports', () => {
      const code = `const x = 1;
const y = 2;
export { x, y };`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.exports).toContain('x');
      expect(ctx.structure.exports).toContain('y');
    });
  });

  describe('type exports', () => {
    it('extracts export type declarations', () => {
      const code = `export type { Config } from './config';
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.exports).toContain('Config');
      expect(ctx.structure.exports).toContain('Result');
      expect(ctx.structure.types).toContain('Result');
    });
  });

  describe('generics', () => {
    it('extracts generic function signatures', () => {
      const code = `export function identity<T>(value: T): T {
  return value;
}`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.functions.find(f => f.name === 'identity')).toBeDefined();
      expect(ctx.structure.exports).toContain('identity');
    });

    it('extracts generic interfaces', () => {
      const code = `export interface Repository<T extends Entity> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
}`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.types).toContain('Repository');
      expect(ctx.structure.exports).toContain('Repository');
    });
  });

  describe('enum exports', () => {
    it('extracts exported enums', () => {
      const code = `export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.exports).toContain('Status');
    });
  });

  describe('default exports', () => {
    it('extracts default export of class', () => {
      const code = `export default class App {
  start(): void {}
}`;
      const ctx = extractContext(code, 'typescript');
      expect(ctx.structure.classes).toContain('App');
    });
  });

  describe('complex real-world file', () => {
    it('extracts all symbols from a coordinator-like file', () => {
      const code = `import { Agent } from 'agents';
import type { ArangoClient } from '@factory/arango-client';
import { extractContext, resolveImportPaths, type FileContext } from '@factory/file-context';

export interface ExecutorEnv {
  ARANGO_URL: string;
  GITHUB_TOKEN?: string;
}

export type ExecutionMode = 'dry-run' | 'live';

const MAX_RETRIES = 3;

export const buildHeaders = (token: string): Record<string, string> => ({
  Authorization: \`Bearer \${token}\`,
});

export class AtomExecutor extends Agent<ExecutorEnv> {
  private cache = new Map<string, string>();

  async execute(spec: Record<string, unknown>): Promise<void> {
    // implementation
  }
}

export async function runPipeline(env: ExecutorEnv): Promise<boolean> {
  return true;
}

export { MAX_RETRIES };
`;
      const ctx = extractContext(code, 'typescript');

      // Imports
      expect(ctx.structure.imports).toContain('agents');
      expect(ctx.structure.imports).toContain('@factory/arango-client');
      expect(ctx.structure.imports).toContain('@factory/file-context');

      // Exports
      expect(ctx.structure.exports).toContain('ExecutorEnv');
      expect(ctx.structure.exports).toContain('ExecutionMode');
      expect(ctx.structure.exports).toContain('buildHeaders');
      expect(ctx.structure.exports).toContain('AtomExecutor');
      expect(ctx.structure.exports).toContain('runPipeline');
      expect(ctx.structure.exports).toContain('MAX_RETRIES');

      // Types
      expect(ctx.structure.types).toContain('ExecutorEnv');
      expect(ctx.structure.types).toContain('ExecutionMode');

      // Classes
      expect(ctx.structure.classes).toContain('AtomExecutor');

      // Functions (including arrow)
      expect(ctx.structure.functions.find(f => f.name === 'runPipeline')).toBeDefined();
      expect(ctx.structure.functions.find(f => f.name === 'buildHeaders')).toBeDefined();
    });
  });
});
