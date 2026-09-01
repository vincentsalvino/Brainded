/**
 * Tiny, pure lexical masking pass -- not a full lexer/parser. Blanks `//` and
 * `/* *\/` comment regions (replacing their characters with spaces, preserving every
 * newline so line numbers stay accurate) while passing every string literal
 * (double/single/backtick, with `\`-escapes respected) through completely
 * untouched, so a `//` or `/*` that happens to appear INSIDE a string is never
 * mistaken for a real comment start, and specifier text inside real import strings
 * is never lost. See PHASE_3_SPEC.md's Extraction Strategy / Comment-String False
 * Positives.
 *
 * Deliberately does not also mask string contents: doing so would make it
 * impossible to read import specifiers, which are themselves string literals. The
 * one known, disclosed gap this leaves (a string literal whose CONTENTS happen to
 * spell out valid import syntax verbatim) is documented in PHASE_3_SPEC.md, not
 * solved here -- solving it needs real tokenization, which is out of scope.
 */
export function maskComments(content: string): string {
  let result = "";
  let i = 0;
  const n = content.length;

  while (i < n) {
    const c = content[i];
    const next = content[i + 1];

    if (c === "/" && next === "/") {
      while (i < n && content[i] !== "\n") {
        result += " ";
        i++;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      result += "  ";
      i += 2;
      while (i < n && !(content[i] === "*" && content[i + 1] === "/")) {
        result += content[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        result += "  ";
        i += 2;
      }
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      result += c;
      i++;
      while (i < n && content[i] !== quote) {
        if (content[i] === "\\" && i + 1 < n) {
          result += (content[i] as string) + (content[i + 1] as string);
          i += 2;
          continue;
        }
        result += content[i];
        i++;
      }
      if (i < n) {
        result += content[i];
        i++;
      }
      continue;
    }

    result += c;
    i++;
  }

  return result;
}
