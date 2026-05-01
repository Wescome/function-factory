export interface FunctionSig {
  name: string;
  params: string;
  returnType?: string | undefined;
  startLine: number;
  endLine: number;
}

export interface FileStructure {
  exports: string[];
  imports: string[];
  functions: FunctionSig[];
  types: string[];
  classes: string[];
}

export interface FileContext {
  path: string;
  language: string;
  rawContent: string;
  structure: FileStructure;
  targetSlice?: string | undefined;
}

const EMPTY_STRUCTURE: FileStructure = {
  exports: [],
  imports: [],
  functions: [],
  types: [],
  classes: [],
};

export function extractContext(content: string, language: string, target?: string): FileContext {
  if (language !== 'typescript' && language !== 'ts') {
    return {
      path: '',
      language,
      rawContent: content,
      structure: { ...EMPTY_STRUCTURE },
      targetSlice: undefined,
    };
  }

  const structure = extractTypeScriptStructure(content);
  const targetSlice = target ? extractSlice(content, target) : undefined;

  return {
    path: '',
    language,
    rawContent: content,
    structure,
    targetSlice,
  };
}

function extractTypeScriptStructure(content: string): FileStructure {
  const imports = extractImports(content);
  const exports = extractExports(content);
  const functions = extractFunctions(content);
  const types = extractTypes(content);
  const classes = extractClasses(content);

  return { exports, imports, functions, types, classes };
}

function extractImports(content: string): string[] {
  const results: string[] = [];
  const regex = /^import\s+.*from\s+['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const path = match[1];
    if (path) results.push(path);
  }
  return results;
}

function extractExports(content: string): string[] {
  const results: string[] = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+class\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+type\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (name && !results.includes(name)) {
        results.push(name);
      }
    }
  }
  return results;
}

function extractFunctions(content: string): FunctionSig[] {
  const results: FunctionSig[] = [];
  const regex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/g;
  const lines = content.split('\n');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2];
    if (!name || params === undefined) continue;
    const returnType = match[3]?.trim();
    const startLine = content.slice(0, match.index).split('\n').length;
    const endLine = findEndLine(content, match.index, lines);

    results.push({ name, params: params.trim(), returnType, startLine, endLine });
  }
  return results;
}

function extractTypes(content: string): string[] {
  const results: string[] = [];
  const patterns = [
    /(?:export\s+)?interface\s+(\w+)/g,
    /(?:export\s+)?type\s+(\w+)/g,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (name && !results.includes(name)) {
        results.push(name);
      }
    }
  }
  return results;
}

function extractClasses(content: string): string[] {
  const results: string[] = [];
  const regex = /(?:export\s+)?class\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (name) results.push(name);
  }
  return results;
}

function findEndLine(content: string, fromIndex: number, lines: string[]): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = fromIndex; i < content.length; i++) {
    const ch = content[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inString) {
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(0, i + 1).split('\n').length;
      }
    }
  }
  return content.split('\n').length;
}

function extractSlice(content: string, target: string): string | undefined {
  const patterns = [
    new RegExp(`(?:export\\s+)?class\\s+${escapeRegex(target)}[^{]*\\{`, 'g'),
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegex(target)}\\s*\\([^)]*\\)[^{]*\\{`, 'g'),
    new RegExp(`(?:export\\s+)?interface\\s+${escapeRegex(target)}[^{]*\\{`, 'g'),
  ];

  for (const regex of patterns) {
    const match = regex.exec(content);
    if (match) {
      const start = match.index;
      const end = findClosingBraceIndex(content, start);
      if (end !== -1) {
        return content.slice(start, end);
      }
    }
  }
  return undefined;
}

function findClosingBraceIndex(content: string, fromIndex: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = fromIndex; i < content.length; i++) {
    const ch = content[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inString) {
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
