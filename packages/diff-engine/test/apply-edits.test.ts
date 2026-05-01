import { describe, it, expect } from 'vitest';
import { applyEdits, type Edit } from '../src/index.js';

describe('applyEdits', () => {
  const original = `import { foo } from './foo';
import { bar } from './bar';

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export const VERSION = '1.0.0';
`;

  describe('basic operations', () => {
    it('applies a single search/replace edit', () => {
      const edits: Edit[] = [
        { search: "return `Hello, ${name}!`;", replace: "return `Hi, ${name}!`;" }
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(1);
      expect(result.failedEdits).toHaveLength(0);
      expect(result.content).toContain("return `Hi, ${name}!`;");
      expect(result.content).not.toContain("return `Hello, ${name}!`;");
    });

    it('applies multiple edits sequentially', () => {
      const edits: Edit[] = [
        { search: "export const VERSION = '1.0.0';", replace: "export const VERSION = '2.0.0';" },
        { search: "return a + b;", replace: "return a + b + 0;" },
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(2);
      expect(result.content).toContain("'2.0.0'");
      expect(result.content).toContain("return a + b + 0;");
    });

    it('later edits operate on post-prior-edit text', () => {
      const edits: Edit[] = [
        { search: "export function greet(name: string): string {", replace: "export function greet(name: string, prefix?: string): string {" },
        { search: "export function greet(name: string, prefix?: string): string {", replace: "export function greet(name: string, prefix = 'Hello'): string {" },
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(true);
      expect(result.appliedEdits).toBe(2);
      expect(result.content).toContain("prefix = 'Hello'");
    });

    it('preserves unmodified content exactly', () => {
      const edits: Edit[] = [
        { search: "export const VERSION = '1.0.0';", replace: "export const VERSION = '1.0.1';" }
      ];
      const result = applyEdits(original, edits);
      expect(result.content).toContain("import { foo } from './foo';");
      expect(result.content).toContain("export function greet");
      expect(result.content).toContain("export function add");
    });
  });

  describe('failure handling', () => {
    it('reports not-found when search string missing', () => {
      const edits: Edit[] = [
        { search: "this string does not exist in the file at all", replace: "anything" }
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(false);
      expect(result.failedEdits).toHaveLength(1);
      expect(result.failedEdits[0].reason).toBe('not-found');
    });

    it('reports too-short when search < 10 chars', () => {
      const edits: Edit[] = [
        { search: "foo", replace: "baz" }
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(false);
      expect(result.failedEdits).toHaveLength(1);
      expect(result.failedEdits[0].reason).toBe('too-short');
    });

    it('reports ambiguous-match when search matches multiple times', () => {
      const edits: Edit[] = [
        { search: "export function", replace: "function" }
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(false);
      expect(result.failedEdits).toHaveLength(1);
      expect(result.failedEdits[0].reason).toBe('ambiguous-match');
      expect(result.failedEdits[0].matchCount).toBeGreaterThan(1);
    });

    it('continues applying after a failed edit', () => {
      const edits: Edit[] = [
        { search: "this does not exist anywhere here", replace: "x" },
        { search: "export const VERSION = '1.0.0';", replace: "export const VERSION = '2.0.0';" },
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(false);
      expect(result.appliedEdits).toBe(1);
      expect(result.failedEdits).toHaveLength(1);
      expect(result.content).toContain("'2.0.0'");
    });
  });

  describe('whitespace tolerance', () => {
    it('matches with trailing whitespace differences', () => {
      const fileWithTrailing = "export function foo() {  \n  return 1;\n}\n";
      const edits: Edit[] = [
        { search: "export function foo() {\n  return 1;\n}", replace: "export function foo() {\n  return 2;\n}" }
      ];
      const result = applyEdits(fileWithTrailing, edits);
      expect(result.success).toBe(true);
      expect(result.content).toContain("return 2;");
    });

    it('normalizes CRLF to LF for matching', () => {
      const crlfFile = "export function foo() {\r\n  return 1;\r\n}\r\n";
      const edits: Edit[] = [
        { search: "export function foo() {\n  return 1;\n}", replace: "export function foo() {\n  return 2;\n}" }
      ];
      const result = applyEdits(crlfFile, edits);
      expect(result.success).toBe(true);
    });

    it('strict mode requires exact byte match', () => {
      const fileWithTrailing = "export function foo() {  \n  return 1;\n}\n";
      const edits: Edit[] = [
        { search: "export function foo() {\n  return 1;\n}", replace: "export function foo() {\n  return 2;\n}" }
      ];
      const result = applyEdits(fileWithTrailing, edits, { strictMatch: true });
      expect(result.success).toBe(false);
      expect(result.failedEdits[0].reason).toBe('not-found');
    });
  });

  describe('scope hints', () => {
    const fileWithDuplicates = `export class Foo {
  getValue(): number {
    return 1;
  }
}

export class Bar {
  getValue(): number {
    return 2;
  }
}
`;

    it('uses scope to disambiguate when search matches multiple times', () => {
      const edits: Edit[] = [
        { search: "getValue(): number {\n    return", replace: "getValue(): number {\n    return 42 +", scope: "Bar" }
      ];
      const result = applyEdits(fileWithDuplicates, edits);
      expect(result.success).toBe(true);
      expect(result.content).toContain("return 42 +");
      expect(result.content).toMatch(/class Foo[\s\S]*return 1/);
    });

    it('fails ambiguous if scope does not help resolve', () => {
      const edits: Edit[] = [
        { search: "getValue(): number {\n    return", replace: "x", scope: "Nonexistent" }
      ];
      const result = applyEdits(fileWithDuplicates, edits);
      expect(result.success).toBe(false);
      expect(result.failedEdits[0].reason).toBe('ambiguous-match');
    });
  });

  describe('edge cases', () => {
    it('handles empty edit array', () => {
      const result = applyEdits(original, []);
      expect(result.success).toBe(true);
      expect(result.content).toBe(original);
      expect(result.appliedEdits).toBe(0);
    });

    it('handles edit that replaces with empty string (deletion)', () => {
      const edits: Edit[] = [
        { search: "import { bar } from './bar';\n", replace: "" }
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(true);
      expect(result.content).not.toContain("import { bar }");
    });

    it('handles edit that adds content (empty search replacement not allowed but inserting via context)', () => {
      const edits: Edit[] = [
        { search: "import { bar } from './bar';", replace: "import { bar } from './bar';\nimport { baz } from './baz';" }
      ];
      const result = applyEdits(original, edits);
      expect(result.success).toBe(true);
      expect(result.content).toContain("import { baz } from './baz';");
    });
  });
});
