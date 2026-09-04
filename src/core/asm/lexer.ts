/** Splits a source line into a label (if any), a mnemonic/directive, and raw operands. */
export interface LineParts {
  readonly label: string | null;
  readonly op: string | null;
  readonly operands: readonly string[];
}

function stripComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') inStr = !inStr;
    if (!inStr && (c === '#' || (c === '/' && line[i + 1] === '/'))) return line.slice(0, i);
  }
  return line;
}

/** Split operands on commas that are not inside quotes or parentheses. */
function splitOperands(text: string): string[] {
  const out: string[] = [];
  let depth = 0, inStr = false, cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== '\\') inStr = !inStr;
    if (!inStr) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    }
    cur += c;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

export function lexLine(raw: string): LineParts {
  let text = stripComment(raw).trim();
  let label: string | null = null;
  const lm = /^([A-Za-z_.$][\w.$]*)\s*:\s*/.exec(text);
  if (lm) {
    label = lm[1];
    text = text.slice(lm[0].length).trim();
  }
  if (text.length === 0) return { label, op: null, operands: [] };
  const sm = /^(\S+)\s*(.*)$/s.exec(text);
  if (!sm) return { label, op: null, operands: [] };
  return { label, op: sm[1].toLowerCase(), operands: splitOperands(sm[2]) };
}

/** Parse a string literal like "hello\n" into bytes. */
export function parseStringLiteral(lit: string): Uint8Array | null {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(lit.trim());
  if (!m) return null;
  const body = m[1];
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { bytes.push(c.charCodeAt(0) & 0xff); continue; }
    const n = body[++i];
    const map: Record<string, number> = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, '"': 34, a: 7, b: 8, f: 12, v: 11 };
    bytes.push(n in map ? map[n] : n.charCodeAt(0));
  }
  return Uint8Array.from(bytes);
}
