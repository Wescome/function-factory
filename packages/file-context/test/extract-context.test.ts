import { describe, it, expect } from 'vitest';
import { extractContext } from '../src/index.js';

describe('extractContext', () => {
  const sampleTS = `import { Request, Response } from 'express';
import { db } from '../database';
import type { User } from './types';

export interface Config {
  port: number;
  host: string;
  debug?: boolean;
}

export type UserId = string;

export class UserService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getUser(id: UserId): Promise<User | null> {
    return this.db.findOne(id);
  }

  async createUser(data: Partial<User>): Promise<User> {
    return this.db.insert(data);
  }
}

export function validateConfig(config: unknown): Config {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid config');
  }
  return config as Config;
}

export async function startServer(config: Config): Promise<void> {
  console.log(\`Starting on \${config.host}:\${config.port}\`);
}

export const DEFAULT_PORT = 3000;

const internalHelper = () => 'not exported';
`;

  describe('imports', () => {
    it('extracts import paths', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      expect(ctx.structure.imports).toContain('express');
      expect(ctx.structure.imports).toContain('../database');
      expect(ctx.structure.imports).toContain('./types');
    });
  });

  describe('exports', () => {
    it('extracts exported symbols', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      expect(ctx.structure.exports).toContain('Config');
      expect(ctx.structure.exports).toContain('UserId');
      expect(ctx.structure.exports).toContain('UserService');
      expect(ctx.structure.exports).toContain('validateConfig');
      expect(ctx.structure.exports).toContain('startServer');
      expect(ctx.structure.exports).toContain('DEFAULT_PORT');
    });

    it('does not include non-exported symbols', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      expect(ctx.structure.exports).not.toContain('internalHelper');
    });
  });

  describe('functions', () => {
    it('extracts function signatures', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      const validateFn = ctx.structure.functions.find(f => f.name === 'validateConfig');
      expect(validateFn).toBeDefined();
      expect(validateFn!.params).toContain('config: unknown');
      expect(validateFn!.returnType).toContain('Config');
    });

    it('extracts async functions', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      const startFn = ctx.structure.functions.find(f => f.name === 'startServer');
      expect(startFn).toBeDefined();
      expect(startFn!.params).toContain('config: Config');
    });

    it('includes line numbers', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      const validateFn = ctx.structure.functions.find(f => f.name === 'validateConfig');
      expect(validateFn!.startLine).toBeGreaterThan(0);
      expect(validateFn!.endLine).toBeGreaterThan(validateFn!.startLine);
    });
  });

  describe('types and interfaces', () => {
    it('extracts interfaces', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      expect(ctx.structure.types).toContain('Config');
    });

    it('extracts type aliases', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      expect(ctx.structure.types).toContain('UserId');
    });
  });

  describe('classes', () => {
    it('extracts class names', () => {
      const ctx = extractContext(sampleTS, 'typescript');
      expect(ctx.structure.classes).toContain('UserService');
    });
  });

  describe('target slicing', () => {
    it('extracts specific function body when target specified', () => {
      const ctx = extractContext(sampleTS, 'typescript', 'validateConfig');
      expect(ctx.targetSlice).toBeDefined();
      expect(ctx.targetSlice).toContain('validateConfig');
      expect(ctx.targetSlice).toContain('Invalid config');
    });

    it('extracts class body when target is a class', () => {
      const ctx = extractContext(sampleTS, 'typescript', 'UserService');
      expect(ctx.targetSlice).toBeDefined();
      expect(ctx.targetSlice).toContain('UserService');
      expect(ctx.targetSlice).toContain('getUser');
      expect(ctx.targetSlice).toContain('createUser');
    });

    it('returns undefined targetSlice when target not found', () => {
      const ctx = extractContext(sampleTS, 'typescript', 'NonexistentThing');
      expect(ctx.targetSlice).toBeUndefined();
    });
  });

  describe('language handling', () => {
    it('returns raw content for non-typescript files', () => {
      const json = '{"key": "value"}';
      const ctx = extractContext(json, 'json');
      expect(ctx.rawContent).toBe(json);
      expect(ctx.structure.exports).toHaveLength(0);
      expect(ctx.structure.functions).toHaveLength(0);
    });

    it('returns raw content for markdown', () => {
      const md = '# Title\n\nSome content';
      const ctx = extractContext(md, 'markdown');
      expect(ctx.rawContent).toBe(md);
    });
  });
});
