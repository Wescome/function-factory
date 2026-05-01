export interface ImportResolution {
  specifier: string;
  resolvedPath: string;
  kind: 'relative' | 'workspace';
}

const WORKSPACE_SCOPES = ['@factory/', '@weops/'];

export function resolveImportPaths(
  imports: string[],
  fromFile: string,
): ImportResolution[] {
  const results: ImportResolution[] = [];
  const fromDir = fromFile.slice(0, fromFile.lastIndexOf('/'));

  for (const specifier of imports) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const cleaned = specifier.replace(/\.js$/, '');
      const resolved = normalizePath(fromDir + '/' + cleaned) + '.ts';
      results.push({ specifier, resolvedPath: resolved, kind: 'relative' });
      continue;
    }

    const scope = WORKSPACE_SCOPES.find(s => specifier.startsWith(s));
    if (scope) {
      const packageName = specifier.slice(scope.length);
      results.push({
        specifier,
        resolvedPath: `packages/${packageName}/src/index.ts`,
        kind: 'workspace',
      });
      continue;
    }
  }
  return results;
}

function normalizePath(path: string): string {
  const parts = path.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..' && normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join('/');
}

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

export type ExtractionConfidence = 'extracted' | 'inferred' | 'ambiguous';

export interface FileContext {
  path: string;
  language: string;
  rawContent: string;
  structure: FileStructure;
  confidence: ExtractionConfidence;
  targetSlice?: string | undefined;
}

const EMPTY_STRUCTURE: FileStructure = {
  exports: [],
  imports: [],
  functions: [],
  types: [],
  classes: [],
};

import { parse, type ParserPlugin } from '@babel/parser';

const BABEL_PLUGINS: ParserPlugin[] = ['typescript', 'decorators'];
const BABEL_OPTS = { sourceType: 'module' as const, plugins: BABEL_PLUGINS, errorRecovery: true };

export function extractContext(content: string, language: string, target?: string): FileContext {
  if (language !== 'typescript' && language !== 'ts') {
    return {
      path: '',
      language,
      rawContent: content,
      structure: { ...EMPTY_STRUCTURE },
      confidence: 'ambiguous',
      targetSlice: undefined,
    };
  }

  const { structure, confidence } = extractTypeScriptStructure(content);
  const targetSlice = target ? extractSlice(content, target) : undefined;

  return {
    path: '',
    language,
    rawContent: content,
    structure,
    confidence,
    targetSlice,
  };
}

function extractTypeScriptStructure(content: string): { structure: FileStructure; confidence: ExtractionConfidence } {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(content, BABEL_OPTS);
  } catch {
    return { structure: { ...EMPTY_STRUCTURE }, confidence: 'ambiguous' };
  }

  const hasErrors = ast.errors && ast.errors.length > 0;
  const confidence: ExtractionConfidence = hasErrors ? 'inferred' : 'extracted';

  const imports: string[] = [];
  const exports: string[] = [];
  const functions: FunctionSig[] = [];
  const types: string[] = [];
  const classes: string[] = [];
  const lines = content.split('\n');

  for (const node of ast.program.body) {
    // import ... from '...'
    if (node.type === 'ImportDeclaration') {
      imports.push(node.source.value);
      continue;
    }

    // export function foo() {}
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        const decl = node.declaration;

        if (decl.type === 'FunctionDeclaration' && decl.id) {
          const name = decl.id.name;
          addUnique(exports, name);
          functions.push(buildFunctionSig(name, decl, content));
        }

        if (decl.type === 'VariableDeclaration') {
          for (const declarator of decl.declarations) {
            if (declarator.id.type === 'Identifier') {
              const name = declarator.id.name;
              addUnique(exports, name);
              if (isArrowOrFunctionExpr(declarator.init)) {
                functions.push(buildArrowSig(name, declarator, content));
              }
            }
          }
        }

        if (decl.type === 'ClassDeclaration' && decl.id) {
          addUnique(exports, decl.id.name);
          addUnique(classes, decl.id.name);
        }

        if (decl.type === 'TSInterfaceDeclaration') {
          addUnique(exports, decl.id.name);
          addUnique(types, decl.id.name);
        }

        if (decl.type === 'TSTypeAliasDeclaration') {
          addUnique(exports, decl.id.name);
          addUnique(types, decl.id.name);
        }

        if (decl.type === 'TSEnumDeclaration') {
          addUnique(exports, decl.id.name);
        }
      }

      // export { foo, bar } or export { foo } from './mod'
      if (node.specifiers) {
        for (const spec of node.specifiers) {
          if (spec.type === 'ExportSpecifier') {
            const exported = spec.exported;
            const name = exported.type === 'Identifier' ? exported.name : exported.value;
            addUnique(exports, name);
          }
        }
      }

      // export type { Foo } from './mod'
      // Already handled by specifiers above
      continue;
    }

    // export default class Foo {}
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      if (decl.type === 'ClassDeclaration' && decl.id) {
        addUnique(classes, decl.id.name);
      }
      if (decl.type === 'FunctionDeclaration' && decl.id) {
        functions.push(buildFunctionSig(decl.id.name, decl, content));
      }
      continue;
    }

    // Non-exported declarations
    if (node.type === 'FunctionDeclaration' && node.id) {
      functions.push(buildFunctionSig(node.id.name, node, content));
    }

    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        if (declarator.id.type === 'Identifier' && isArrowOrFunctionExpr(declarator.init)) {
          functions.push(buildArrowSig(declarator.id.name, declarator, content));
        }
      }
    }

    if (node.type === 'ClassDeclaration' && node.id) {
      addUnique(classes, node.id.name);
    }

    if (node.type === 'TSInterfaceDeclaration') {
      addUnique(types, node.id.name);
    }

    if (node.type === 'TSTypeAliasDeclaration') {
      addUnique(types, node.id.name);
    }

    if (node.type === 'TSEnumDeclaration') {
      // non-exported enum — don't add to exports, but it exists
    }
  }

  return { structure: { exports, imports, functions, types, classes }, confidence };
}

function isArrowOrFunctionExpr(init: any): boolean {
  if (!init) return false;
  return init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression';
}

function buildFunctionSig(name: string, decl: any, content: string): FunctionSig {
  const params = decl.params
    ?.map((p: any) => content.slice(p.start, p.end))
    .join(', ') ?? '';
  const returnType = decl.returnType
    ? content.slice(decl.returnType.start + 1, decl.returnType.end).trim()
    : undefined;
  return {
    name,
    params,
    returnType,
    startLine: decl.loc?.start?.line ?? 1,
    endLine: decl.loc?.end?.line ?? 1,
  };
}

function buildArrowSig(name: string, declarator: any, content: string): FunctionSig {
  const init = declarator.init;
  const params = init?.params
    ?.map((p: any) => content.slice(p.start, p.end))
    .join(', ') ?? '';
  const returnType = init?.returnType
    ? content.slice(init.returnType.start + 1, init.returnType.end).trim()
    : undefined;
  const startLine = declarator.loc?.start?.line ?? 1;
  const endLine = init?.loc?.end?.line ?? declarator.loc?.end?.line ?? 1;
  return { name, params, returnType, startLine, endLine };
}

function addUnique(arr: string[], value: string): void {
  if (!arr.includes(value)) arr.push(value);
}

function extractSlice(content: string, target: string): string | undefined {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(content, BABEL_OPTS);
  } catch {
    return undefined;
  }

  for (const node of ast.program.body) {
    const decl = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
      ? (node as any).declaration
      : node;
    if (!decl) continue;

    if (
      (decl.type === 'ClassDeclaration' || decl.type === 'TSInterfaceDeclaration' ||
       decl.type === 'FunctionDeclaration') &&
      decl.id?.name === target
    ) {
      return content.slice(decl.start, decl.end);
    }
  }
  return undefined;
}
