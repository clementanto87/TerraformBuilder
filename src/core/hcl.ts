/**
 * A small HCL2 writer.
 *
 * It produces output that already matches `terraform fmt`: two-space indents
 * and `=` signs aligned within each run of consecutive attributes. That
 * matters more than it sounds — generated code that reformats on the first
 * `fmt` shows up as noise in every pull request.
 */

/** A raw HCL expression: emitted verbatim, never quoted. */
export interface Expr {
  __expr: string;
}

export const expr = (src: string): Expr => ({ __expr: src });

export const isExpr = (value: unknown): value is Expr =>
  typeof value === 'object' && value !== null && '__expr' in (value as object);

export type HclValue =
  | string
  | number
  | boolean
  | null
  | Expr
  | HclValue[]
  | { [key: string]: HclValue };

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const INDENT = '  ';

/** Escapes a string for an HCL double-quoted literal. */
export function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // `${` and `%{` would otherwise open a template interpolation. These use
    // function replacements because `$$` is a special sequence in a string
    // replacement and would collapse back to a single `$`.
    .replace(/\$\{/g, () => '$${')
    .replace(/%\{/g, () => '%%{');
  return `"${escaped}"`;
}

const key = (name: string): string => (IDENT.test(name) ? name : quote(name));

const isPlainObject = (value: unknown): value is Record<string, HclValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !isExpr(value);

/** True when a collection is short enough to keep on one line. */
function fitsInline(value: HclValue[]): boolean {
  if (value.length === 0) return true;
  if (value.some((item) => Array.isArray(item) || isPlainObject(item))) return false;
  const rendered = value.map((item) => writeValue(item, 0)).join(', ');
  return rendered.length <= 58;
}

/** Renders a value. Continuation lines are indented to `depth`. */
export function writeValue(value: HclValue, depth: number): string {
  if (value === null || value === undefined) return 'null';
  if (isExpr(value)) return value.__expr;
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (fitsInline(value)) {
      return `[${value.map((item) => writeValue(item, depth)).join(', ')}]`;
    }
    const items = value.map((item) => `${inner}${writeValue(item, depth + 1)},`);
    return `[\n${items.join('\n')}\n${pad}]`;
  }

  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const width = Math.max(...entries.map(([k]) => key(k).length));
  const lines = entries.map(
    ([k, v]) => `${inner}${key(k).padEnd(width)} = ${writeValue(v, depth + 1)}`,
  );
  return `{\n${lines.join('\n')}\n${pad}}`;
}

/* -------------------------------------------------------------------------- */
/* Block builder                                                              */
/* -------------------------------------------------------------------------- */

type Entry =
  | { kind: 'attr'; name: string; value: HclValue }
  | { kind: 'block'; block: Block }
  | { kind: 'comment'; text: string }
  | { kind: 'blank' };

export class Block {
  private entries: Entry[] = [];

  constructor(
    private readonly type: string,
    private readonly labels: string[] = [],
  ) {}

  /** Adds `name = value`. Skips `undefined` so callers can pass optionals. */
  attr(name: string, value: HclValue | undefined): this {
    if (value !== undefined) this.entries.push({ kind: 'attr', name, value });
    return this;
  }

  /** Adds every defined entry of a record. */
  attrs(values: Record<string, HclValue | undefined>): this {
    for (const [name, value] of Object.entries(values)) this.attr(name, value);
    return this;
  }

  block(child: Block | undefined): this {
    if (child && !child.isEmpty()) {
      this.blank();
      this.entries.push({ kind: 'block', block: child });
    }
    return this;
  }

  comment(text: string): this {
    this.entries.push({ kind: 'comment', text });
    return this;
  }

  /** Adds a separator, collapsing repeats and ignoring a leading blank. */
  blank(): this {
    const last = this.entries[this.entries.length - 1];
    if (this.entries.length > 0 && last?.kind !== 'blank') {
      this.entries.push({ kind: 'blank' });
    }
    return this;
  }

  isEmpty(): boolean {
    return this.entries.every((entry) => entry.kind === 'blank');
  }

  render(depth = 0): string {
    const pad = INDENT.repeat(depth);
    const inner = INDENT.repeat(depth + 1);
    const header = [this.type, ...this.labels.map(quote)].join(' ');

    // Trim trailing separators so a block never ends on a blank line.
    const entries = [...this.entries];
    while (entries.length > 0 && entries[entries.length - 1].kind === 'blank') entries.pop();
    if (entries.length === 0) return `${pad}${header} {}`;

    const lines: string[] = [];
    let run: { name: string; value: HclValue }[] = [];

    // `=` alignment applies per uninterrupted run of attributes.
    const flush = () => {
      if (run.length === 0) return;
      const width = Math.max(...run.map((entry) => key(entry.name).length));
      for (const entry of run) {
        lines.push(`${inner}${key(entry.name).padEnd(width)} = ${writeValue(entry.value, depth + 1)}`);
      }
      run = [];
    };

    for (const entry of entries) {
      switch (entry.kind) {
        case 'attr':
          run.push({ name: entry.name, value: entry.value });
          break;
        case 'block':
          flush();
          lines.push(entry.block.render(depth + 1));
          break;
        case 'comment':
          flush();
          lines.push(`${inner}# ${entry.text}`);
          break;
        case 'blank':
          flush();
          lines.push('');
          break;
      }
    }
    flush();

    return `${pad}${header} {\n${lines.join('\n')}\n${pad}}`;
  }
}

export const block = (type: string, ...labels: string[]): Block => new Block(type, labels);

/** Joins rendered blocks with exactly one blank line between them. */
export const joinBlocks = (blocks: string[]): string =>
  blocks.filter((text) => text.trim().length > 0).join('\n\n');
