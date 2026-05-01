export interface Edit {
  search: string;
  replace: string;
  scope?: string;
}

export interface EditFailure {
  edit: Edit;
  reason: 'not-found' | 'ambiguous-match' | 'too-short';
  matchCount?: number;
}

export interface ApplyOptions {
  strictMatch?: boolean;
}

export interface ApplyResult {
  success: boolean;
  content: string;
  appliedEdits: number;
  failedEdits: EditFailure[];
}

const MIN_SEARCH_LENGTH = 10;

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
}

function findScopeRange(text: string, scope: string): { start: number; end: number } | null {
  const patterns = [
    new RegExp(`(?:export\\s+)?class\\s+${escapeRegex(scope)}\\s*(?:extends|implements|\\{)`, 'g'),
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRegex(scope)}\\s*\\(`, 'g'),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const start = match.index;
      const end = findClosingBrace(text, start);
      if (end !== -1) return { start, end };
    }
  }
  return null;
}

function findClosingBrace(text: string, fromIndex: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
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

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += 1;
  }
  return count;
}

function findInScope(text: string, search: string, scope: string): number {
  const range = findScopeRange(text, scope);
  if (!range) return -1;

  const scopeText = text.slice(range.start, range.end);
  const localIndex = scopeText.indexOf(search);
  if (localIndex === -1) return -1;

  const localCount = countOccurrences(scopeText, search);
  if (localCount > 1) return -1;

  return range.start + localIndex;
}

export function applyEdits(original: string, edits: Edit[], options?: ApplyOptions): ApplyResult {
  if (edits.length === 0) {
    return { success: true, content: original, appliedEdits: 0, failedEdits: [] };
  }

  const strict = options?.strictMatch ?? false;
  let content = original;
  let appliedEdits = 0;
  const failedEdits: EditFailure[] = [];

  for (const edit of edits) {
    if (edit.search.length < MIN_SEARCH_LENGTH) {
      failedEdits.push({ edit, reason: 'too-short' });
      continue;
    }

    let searchText = edit.search;
    let workingContent = content;

    if (!strict) {
      searchText = normalizeWhitespace(searchText);
      workingContent = normalizeWhitespace(workingContent);
    }

    const occurrences = countOccurrences(workingContent, searchText);

    if (occurrences === 0) {
      failedEdits.push({ edit, reason: 'not-found' });
      continue;
    }

    if (occurrences > 1) {
      if (edit.scope) {
        const normalizedContent = strict ? content : normalizeWhitespace(content);
        const scopeIndex = findInScope(normalizedContent, searchText, edit.scope);
        if (scopeIndex !== -1) {
          if (strict) {
            content = content.slice(0, scopeIndex) + edit.replace + content.slice(scopeIndex + edit.search.length);
          } else {
            const originalIndex = findOriginalIndex(content, normalizeWhitespace(content), scopeIndex, searchText);
            content = content.slice(0, originalIndex) + edit.replace + content.slice(originalIndex + findOriginalLength(content, originalIndex, searchText));
          }
          appliedEdits++;
          continue;
        }
      }
      failedEdits.push({ edit, reason: 'ambiguous-match', matchCount: occurrences });
      continue;
    }

    if (strict) {
      const index = content.indexOf(edit.search);
      content = content.slice(0, index) + edit.replace + content.slice(index + edit.search.length);
    } else {
      const normalizedContent = normalizeWhitespace(content);
      const normalizedIndex = normalizedContent.indexOf(searchText);
      const originalIndex = findOriginalIndex(content, normalizedContent, normalizedIndex, searchText);
      const originalLength = findOriginalLength(content, originalIndex, searchText);
      content = content.slice(0, originalIndex) + edit.replace + content.slice(originalIndex + originalLength);
    }
    appliedEdits++;
  }

  return {
    success: failedEdits.length === 0,
    content,
    appliedEdits,
    failedEdits,
  };
}

function findOriginalIndex(original: string, normalized: string, normalizedIndex: number, normalizedSearch: string): number {
  let origPos = 0;
  let normPos = 0;

  const origNormalized = normalizeWhitespace(original);
  if (origNormalized === normalized) {
    const lines = original.split('\n');
    const normLines = normalized.split('\n');

    if (lines.length === normLines.length) {
      let origOffset = 0;
      let normOffset = 0;
      for (let i = 0; i < lines.length; i++) {
        const normLine = normLines[i]!;
        const origLine = lines[i]!;
        if (normOffset + normLine.length >= normalizedIndex && normOffset <= normalizedIndex) {
          const lineLocalOffset = normalizedIndex - normOffset;
          return origOffset + lineLocalOffset;
        }
        origOffset += origLine.length + 1;
        normOffset += normLine.length + 1;
      }
    }
  }

  return normalizedIndex;
}

function findOriginalLength(original: string, startIndex: number, normalizedSearch: string): number {
  const searchLines = normalizedSearch.split('\n');
  let pos = startIndex;

  for (let i = 0; i < searchLines.length; i++) {
    const searchLine = searchLines[i]!;
    if (i > 0) {
      if (pos < original.length && original[pos] === '\r') pos++;
      if (pos < original.length && original[pos] === '\n') pos++;
    }
    const origLineEnd = original.indexOf('\n', pos);

    if (i === searchLines.length - 1) {
      pos += searchLine.length;
    } else {
      pos = origLineEnd === -1 ? original.length : origLineEnd;
    }
  }

  return pos - startIndex;
}
