/**
 * A pragmatic HCL2 parser.
 *
 * It parses the structural shape of Terraform precisely — blocks, labels,
 * attributes, lists, objects, literals, heredocs — and captures everything
 * else (references, function calls, conditionals, interpolations) as raw
 * expression source. That is exactly the trade the importer needs: structure
 * is what draws the diagram, and raw text is enough to spot the
 * `type.name.attr` references that become edges.
 */

import type { JsonValue } from './types';

/* -------------------------------------------------------------------------- */
/* Tokenizer                                                                  */
/* -------------------------------------------------------------------------- */

type TokenType = 'ident' | 'string' | 'number' | 'punct' | 'heredoc' | 'eof';

interface Token {
  type: TokenType;
  /** Decoded value for strings, source text otherwise. */
  value: string;
  start: number;
  end: number;
  line: number;
  /** A quoted string containing `${…}`, which must stay an expression. */
  interpolated?: boolean;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_-]/;
const DIGIT = /[0-9]/;

export class HclSyntaxError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'HclSyntaxError';
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;

  const push = (type: TokenType, value: string, start: number, extra?: Partial<Token>) => {
    tokens.push({ type, value, start, end: index, line, ...extra });
  };

  while (index < source.length) {
    const char = source[index];

    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      index += 1;
      continue;
    }

    // Comments.
    if (char === '#' || (char === '/' && source[index + 1] === '/')) {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') line += 1;
        index += 1;
      }
      index += 2;
      continue;
    }

    // Heredocs: <<EOT / <<-EOT.
    if (char === '<' && source[index + 1] === '<') {
      const start = index;
      index += 2;
      if (source[index] === '-') index += 1;
      let delimiter = '';
      while (index < source.length && IDENT_PART.test(source[index])) {
        delimiter += source[index];
        index += 1;
      }
      while (index < source.length && source[index] !== '\n') index += 1;
      index += 1;
      line += 1;

      const lines: string[] = [];
      while (index < source.length) {
        let end = source.indexOf('\n', index);
        if (end === -1) end = source.length;
        const text = source.slice(index, end);
        index = end + 1;
        line += 1;
        if (text.trim() === delimiter) break;
        lines.push(text);
      }
      const indent = Math.min(
        ...lines.filter((text) => text.trim()).map((text) => text.match(/^\s*/)?.[0].length ?? 0),
        Infinity,
      );
      const dedented = Number.isFinite(indent) ? lines.map((text) => text.slice(indent)) : lines;
      push('heredoc', dedented.join('\n'), start);
      continue;
    }

    // Quoted strings, tracking `${…}` so interpolation stays an expression.
    if (char === '"') {
      const start = index;
      index += 1;
      let value = '';
      let interpolated = false;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') {
          const next = source[index + 1];
          const escapes: Record<string, string> = {
            n: '\n',
            r: '\r',
            t: '\t',
            '"': '"',
            '\\': '\\',
          };
          value += escapes[next] ?? next;
          index += 2;
          continue;
        }
        if (source[index] === '$' && source[index + 1] === '{') {
          interpolated = true;
          let depth = 0;
          do {
            if (source[index] === '{') depth += 1;
            if (source[index] === '}') depth -= 1;
            value += source[index];
            index += 1;
          } while (index < source.length && depth > 0);
          continue;
        }
        if (source[index] === '\n') line += 1;
        value += source[index];
        index += 1;
      }
      index += 1;
      push('string', value, start, { interpolated });
      continue;
    }

    if (DIGIT.test(char) || (char === '-' && DIGIT.test(source[index + 1] ?? ''))) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9.eE+-]/.test(source[index])) index += 1;
      push('number', source.slice(start, index), start);
      continue;
    }

    if (IDENT_START.test(char)) {
      const start = index;
      while (index < source.length && IDENT_PART.test(source[index])) index += 1;
      push('ident', source.slice(start, index), start);
      continue;
    }

    const start = index;
    index += 1;
    push('punct', char, start);
  }

  tokens.push({ type: 'eof', value: '', start: index, end: index, line });
  return tokens;
}

/* -------------------------------------------------------------------------- */
/* Syntax tree                                                                */
/* -------------------------------------------------------------------------- */

export type HclValueNode =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'expr'; source: string }
  | { kind: 'list'; items: HclValueNode[] }
  | { kind: 'object'; entries: Record<string, HclValueNode> };

export interface HclBody {
  attributes: Record<string, HclValueNode>;
  blocks: HclBlockNode[];
}

export interface HclBlockNode {
  type: string;
  labels: string[];
  body: HclBody;
  line: number;
}

/* -------------------------------------------------------------------------- */
/* Parser                                                                     */
/* -------------------------------------------------------------------------- */

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    return this.tokens[this.position++];
  }

  private isPunct(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.type === 'punct' && token.value === value;
  }

  private expect(value: string): Token {
    if (!this.isPunct(value)) {
      const token = this.peek();
      throw new HclSyntaxError(`Expected "${value}" but found "${token.value || 'end of file'}"`, token.line);
    }
    return this.next();
  }

  parseBody(terminator: string | null): HclBody {
    const body: HclBody = { attributes: {}, blocks: [] };

    while (this.peek().type !== 'eof') {
      if (terminator && this.isPunct(terminator)) break;

      const token = this.peek();
      if (token.type !== 'ident' && token.type !== 'string') {
        // Stray punctuation between entries; skip rather than abort a whole file.
        this.next();
        continue;
      }

      // `name = …` is an attribute; anything else starting with an identifier
      // is a block header.
      if (this.isPunct('=', 1)) {
        const name = this.next().value;
        this.next();
        body.attributes[name] = this.parseValue();
        continue;
      }

      const type = this.next().value;
      const labels: string[] = [];
      while (this.peek().type === 'string' || this.peek().type === 'ident') {
        labels.push(this.next().value);
      }
      if (!this.isPunct('{')) {
        // Not a block after all — skip to the next line to stay in sync.
        continue;
      }
      this.expect('{');
      const inner = this.parseBody('}');
      this.expect('}');
      body.blocks.push({ type, labels, body: inner, line: token.line });
    }

    return body;
  }

  private parseValue(): HclValueNode {
    const token = this.peek();

    if (this.isPunct('[')) return this.parseList();
    if (this.isPunct('{')) return this.parseObject();

    if (token.type === 'heredoc') {
      this.next();
      return { kind: 'literal', value: token.value };
    }

    // A simple scalar only stays a literal when nothing follows that would
    // make it part of a larger expression.
    if (token.type === 'string' && !token.interpolated && this.endsValue(1)) {
      this.next();
      return { kind: 'literal', value: token.value };
    }
    if (token.type === 'number' && this.endsValue(1)) {
      this.next();
      return { kind: 'literal', value: Number(token.value) };
    }
    if (token.type === 'ident' && this.endsValue(1)) {
      if (token.value === 'true' || token.value === 'false') {
        this.next();
        return { kind: 'literal', value: token.value === 'true' };
      }
      if (token.value === 'null') {
        this.next();
        return { kind: 'literal', value: null };
      }
    }

    return { kind: 'expr', source: this.captureExpression() };
  }

  /** True when the token at `offset` cannot continue the current value. */
  private endsValue(offset: number): boolean {
    const token = this.peek(offset);
    if (token.type === 'eof') return true;
    if (token.type === 'punct') return [',', '}', ']', ')'].includes(token.value);
    // A token on a later line starts the next entry.
    return token.line > this.peek(offset - 1).line;
  }

  /** Slices the raw source of an expression, respecting bracket nesting. */
  private captureExpression(): string {
    const start = this.peek().start;
    let end = start;
    let depth = 0;

    while (this.peek().type !== 'eof') {
      const token = this.peek();
      if (token.type === 'punct') {
        if ('([{'.includes(token.value)) depth += 1;
        if (')]}'.includes(token.value)) {
          if (depth === 0) break;
          depth -= 1;
        }
        if (token.value === ',' && depth === 0) break;
      }
      // At the top level a newline ends the expression.
      if (depth === 0 && end !== start && token.line > this.tokens[this.position - 1].line) break;
      end = this.next().end;
    }

    return this.source.slice(start, end).trim();
  }

  private parseList(): HclValueNode {
    this.expect('[');
    const items: HclValueNode[] = [];
    while (!this.isPunct(']') && this.peek().type !== 'eof') {
      items.push(this.parseValue());
      if (this.isPunct(',')) this.next();
    }
    this.expect(']');
    return { kind: 'list', items };
  }

  private parseObject(): HclValueNode {
    this.expect('{');
    const entries: Record<string, HclValueNode> = {};
    while (!this.isPunct('}') && this.peek().type !== 'eof') {
      const keyToken = this.peek();
      if (keyToken.type !== 'ident' && keyToken.type !== 'string' && keyToken.type !== 'number') {
        this.next();
        continue;
      }
      this.next();
      if (this.isPunct('=') || this.isPunct(':')) this.next();
      entries[keyToken.value] = this.parseValue();
      if (this.isPunct(',')) this.next();
    }
    this.expect('}');
    return { kind: 'object', entries };
  }
}

/** Parses a Terraform document into blocks and attributes. */
export function parseHcl(source: string): HclBody {
  return new Parser(tokenize(source), source).parseBody(null);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Collapses a parsed value to plain JSON, keeping expressions as strings. */
export function toJson(node: HclValueNode): JsonValue {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'expr':
      return node.source;
    case 'list':
      return node.items.map(toJson);
    case 'object': {
      const result: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(node.entries)) result[key] = toJson(value);
      return result;
    }
  }
}

/** Matches `azurerm_subnet.web.id`, `module.network.vnet_id`, `var.location`. */
const REFERENCE = /\b((?:data\.|module\.)?[A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)(?:\.([A-Za-z_][A-Za-z0-9_.-]*))?/g;

export interface ParsedReference {
  /** `azurerm_subnet`, `module`, `var`, … */
  type: string;
  /** The resource's local label. */
  name: string;
  attr?: string;
  source: string;
}

/** Extracts every `type.name.attr` reference from an expression. */
export function findReferences(node: HclValueNode): ParsedReference[] {
  const found: ParsedReference[] = [];

  const walk = (current: HclValueNode) => {
    switch (current.kind) {
      case 'expr': {
        REFERENCE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = REFERENCE.exec(current.source)) !== null) {
          found.push({ type: match[1], name: match[2], attr: match[3], source: match[0] });
        }
        break;
      }
      case 'list':
        current.items.forEach(walk);
        break;
      case 'object':
        Object.values(current.entries).forEach(walk);
        break;
      case 'literal':
        break;
    }
  };

  walk(node);
  return found;
}
