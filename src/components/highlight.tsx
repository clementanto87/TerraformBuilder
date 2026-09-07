/**
 * A tiny HCL highlighter for the code panel.
 *
 * Writing this by hand rather than pulling in Prism or Shiki keeps the bundle
 * small and lets the token classes map onto the theme's CSS custom properties,
 * so the code panel follows light and dark mode like everything else.
 */

import { Fragment, type ReactNode } from 'react';

const BLOCK_KEYWORDS = new Set([
  'resource',
  'module',
  'data',
  'variable',
  'output',
  'provider',
  'terraform',
  'locals',
  'backend',
  'required_providers',
]);

const LITERALS = new Set(['true', 'false', 'null']);

// Ordered: the first alternative to match at a position wins.
const TOKEN = new RegExp(
  [
    '(?<comment>#[^\\n]*|//[^\\n]*)',
    '(?<string>"(?:[^"\\\\\\n]|\\\\.)*")',
    '(?<number>\\b\\d+(?:\\.\\d+)?\\b)',
    '(?<word>[A-Za-z_][A-Za-z0-9_-]*)',
    '(?<punct>[=\\[\\]{}(),.:?])',
  ].join('|'),
  'g',
);

type TokenClass =
  | 'tok-comment'
  | 'tok-string'
  | 'tok-number'
  | 'tok-keyword'
  | 'tok-bool'
  | 'tok-attr'
  | 'tok-ident'
  | 'tok-punct';

/** Classifies a bare word from the characters around it. */
function classifyWord(word: string, before: string, after: string): TokenClass {
  if (LITERALS.has(word)) return 'tok-bool';
  // A keyword only counts at the start of a line.
  if (BLOCK_KEYWORDS.has(word) && /(^|\n)\s*$/.test(before)) return 'tok-keyword';
  // `key =` is an attribute name; `foo.bar` is a reference.
  if (/^\s*=[^=]/.test(after)) return 'tok-attr';
  return 'tok-ident';
}

export function highlightHcl(source: string): ReactNode[] {
  const output: ReactNode[] = [];
  let last = 0;
  let key = 0;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN.exec(source)) !== null) {
    const groups = match.groups ?? {};
    const start = match.index;

    if (start > last) output.push(<Fragment key={key++}>{source.slice(last, start)}</Fragment>);
    last = start + match[0].length;

    let className: TokenClass;
    if (groups.comment) className = 'tok-comment';
    else if (groups.string) className = 'tok-string';
    else if (groups.number) className = 'tok-number';
    else if (groups.punct) className = 'tok-punct';
    else className = classifyWord(match[0], source.slice(Math.max(0, start - 40), start), source.slice(last, last + 12));

    output.push(
      <span key={key++} className={className}>
        {match[0]}
      </span>,
    );
  }

  if (last < source.length) output.push(<Fragment key={key++}>{source.slice(last)}</Fragment>);
  return output;
}
