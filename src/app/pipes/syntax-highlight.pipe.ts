import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

type TokenType =
  | 'comment' | 'string' | 'keyword' | 'builtin'
  | 'number'  | 'function' | 'property' | 'operator'
  | 'punct'   | 'ident'    | 'space'    | 'newline' | 'other';

interface Token { type: TokenType; value: string; }

const KEYWORDS = new Set([
  'const','let','var','function','async','await','if','else','for','while',
  'return','new','typeof','true','false','null','undefined','class','import',
  'export','default','try','catch','throw','this','of','in','instanceof',
  'break','continue','switch','case','do','delete','void','yield','static',
  'get','set','from','with','finally','extends','super','debugger',
]);

const BUILTINS = new Set([
  'window','console','Promise','Array','Object','JSON','Math','Date','Number',
  'String','Boolean','Error','TypeError','RangeError','setTimeout','setInterval',
  'clearTimeout','clearInterval','fetch','document','localStorage','sessionStorage',
  'navigator','URL','URLSearchParams','FormData','Blob','Map','Set','WeakMap',
  'WeakSet','Symbol','Proxy','Reflect','RegExp','Infinity','NaN','parseInt',
  'parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
]);

@Pipe({ name: 'syntaxHighlight', standalone: true, pure: true })
export class SyntaxHighlightPipe implements PipeTransform {
  constructor(private readonly san: DomSanitizer) {}

  transform(code: string): SafeHtml {
    const html = this.buildHtml(code);
    return this.san.bypassSecurityTrustHtml(html);
  }

  // ── Build HTML with line-wrapped tokens ──────────────────────────────────
  private buildHtml(code: string): string {
    const tokens = this.tokenize(code);
    const lines: Token[][] = [[]];

    for (const t of tokens) {
      if (t.type === 'newline') {
        lines.push([]);
      } else {
        lines[lines.length - 1].push(t);
      }
    }

    return lines
      .map(line => `<span class="sh-line">${line.map(t => this.render(t)).join('')}</span>`)
      .join('\n');
  }

  // ── Tokeniser ────────────────────────────────────────────────────────────
  private tokenize(code: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < code.length) {
      const ch  = code[i];
      const ch2 = code[i + 1];

      // Single-line comment
      if (ch === '/' && ch2 === '/') {
        const end = code.indexOf('\n', i);
        const val = end === -1 ? code.slice(i) : code.slice(i, end);
        tokens.push({ type: 'comment', value: val });
        i += val.length;
        continue;
      }

      // Multi-line comment
      if (ch === '/' && ch2 === '*') {
        const end = code.indexOf('*/', i + 2);
        const val = end === -1 ? code.slice(i) : code.slice(i, end + 2);
        // Split across lines
        tokens.push({ type: 'comment', value: val });
        i += val.length;
        continue;
      }

      // Template literal
      if (ch === '`') {
        let j = i + 1;
        while (j < code.length) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === '`')  { j++;    break;    }
          j++;
        }
        tokens.push({ type: 'string', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // String
      if (ch === '"' || ch === "'") {
        const q = ch;
        let j = i + 1;
        while (j < code.length) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === q)    { j++;    break;    }
          j++;
        }
        tokens.push({ type: 'string', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Newline
      if (ch === '\n') {
        tokens.push({ type: 'newline', value: '\n' });
        i++;
        continue;
      }

      // Number (not after identifier char)
      if (/\d/.test(ch) && (i === 0 || !/[a-zA-Z_$]/.test(code[i - 1]))) {
        let j = i;
        while (j < code.length && /[\d.eExXbBoO_a-fA-F]/.test(code[j])) j++;
        tokens.push({ type: 'number', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Identifier / keyword / builtin / function / property
      if (/[a-zA-Z_$]/.test(ch)) {
        let j = i;
        while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
        const word = code.slice(i, j);

        // Look forward past spaces to see if followed by '('
        let k = j;
        while (k < code.length && code[k] === ' ') k++;
        const isCall = code[k] === '(';

        // Check if preceded by '.'  (property access)
        const prevMeaning = [...tokens].reverse().find(t => t.type !== 'space');
        const isProperty  = prevMeaning?.value === '.';

        let type: TokenType;
        if (isProperty)         type = 'property';
        else if (KEYWORDS.has(word))  type = 'keyword';
        else if (BUILTINS.has(word))  type = 'builtin';
        else if (isCall)              type = 'function';
        else                          type = 'ident';

        tokens.push({ type, value: word });
        i = j;
        continue;
      }

      // Operators (multi-char first)
      const opM = code.slice(i).match(/^(?:=>|===|!==|==|!=|<=|>=|&&|\|\||>>>|>>|<<|\+\+|--|[+\-*/%&|^~?:])/);
      if (opM) {
        tokens.push({ type: 'operator', value: opM[0] });
        i += opM[0].length;
        continue;
      }

      // Punctuation
      if (/[{}[\]();,.]/.test(ch)) {
        tokens.push({ type: 'punct', value: ch });
        i++;
        continue;
      }

      // Whitespace
      if (ch === ' ' || ch === '\t') {
        let j = i;
        while (j < code.length && (code[j] === ' ' || code[j] === '\t')) j++;
        tokens.push({ type: 'space', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Fallback
      tokens.push({ type: 'other', value: ch });
      i++;
    }

    return tokens;
  }

  // ── Renderer ─────────────────────────────────────────────────────────────
  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private render(t: Token): string {
    const v = this.esc(t.value);
    switch (t.type) {
      case 'comment':  return `<span class="ch-c">${v}</span>`;
      case 'string':   return `<span class="ch-s">${v}</span>`;
      case 'keyword':  return `<span class="ch-k">${v}</span>`;
      case 'builtin':  return `<span class="ch-b">${v}</span>`;
      case 'number':   return `<span class="ch-n">${v}</span>`;
      case 'function': return `<span class="ch-f">${v}</span>`;
      case 'property': return `<span class="ch-p">${v}</span>`;
      case 'operator': return `<span class="ch-o">${v}</span>`;
      case 'punct':    return `<span class="ch-u">${v}</span>`;
      default:         return v;
    }
  }
}
