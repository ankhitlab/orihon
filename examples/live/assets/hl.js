/* Minimal JavaScript highlighter for the code panels.
   Deliberately dependency-free: the demo site should not need a build step or a
   third-party bundle to show its own source. */

const KEYWORD = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
  "default", "delete", "do", "else", "export", "extends", "finally", "for",
  "from", "function", "get", "if", "import", "in", "instanceof", "let", "new",
  "of", "return", "set", "static", "switch", "throw", "try", "typeof", "var",
  "void", "while", "yield"
]);

const LITERAL = new Set(["true", "false", "null", "undefined", "NaN", "Infinity", "this", "super"]);

const TOKEN = new RegExp(
  [
    "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)",
    "(`(?:\\\\[\\s\\S]|[^`\\\\])*`|\"(?:\\\\[\\s\\S]|[^\"\\\\\\n])*\"|'(?:\\\\[\\s\\S]|[^'\\\\\\n])*')",
    "(\\b0[xX][0-9a-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?\\b)",
    "([A-Za-z_$][\\w$]*)",
    "([{}()\\[\\];,.:?=+\\-*/%<>!&|^~]+)"
  ].join("|"),
  "g"
);

const escape = (value) =>
  value.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));

const span = (cls, text) => `<span class="${cls}">${escape(text)}</span>`;

/** Highlight a JavaScript source string into HTML for a `<pre>`. */
export function highlight(source) {
  let out = "";
  let last = 0;
  let match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(source))) {
    out += escape(source.slice(last, match.index));
    last = match.index + match[0].length;
    const [, comment, string, number, word, punctuation] = match;
    if (comment !== undefined) out += span("t-com", comment);
    else if (string !== undefined) out += span("t-str", string);
    else if (number !== undefined) out += span("t-num", number);
    else if (word !== undefined) {
      if (KEYWORD.has(word)) out += span("t-key", word);
      else if (LITERAL.has(word)) out += span("t-lit", word);
      else if (source[last] === "(") out += span("t-fn", word);
      else out += escape(word);
    } else out += span("t-pun", punctuation);
  }
  return out + escape(source.slice(last));
}

/** A `<div class="code">` with a title bar, copy button and highlighted body. */
export function codeBlock(source, { label = "", actions = null } = {}) {
  const box = document.createElement("div");
  box.className = "code";

  const bar = document.createElement("div");
  bar.className = "code-bar";
  const name = document.createElement("span");
  name.textContent = label;
  bar.append(name);
  if (actions) bar.append(actions);
  const grow = document.createElement("span");
  grow.className = "grow";
  bar.append(grow);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy";
  copy.textContent = "copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(box.dataset.source || "");
      copy.textContent = "copied";
      copy.dataset.done = "1";
      setTimeout(() => {
        copy.textContent = "copy";
        delete copy.dataset.done;
      }, 1400);
    } catch {
      copy.textContent = "press ⌘C";
    }
  });
  bar.append(copy);

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  pre.append(code);
  box.append(bar, pre);

  box.setSource = (value, nextLabel) => {
    box.dataset.source = value;
    code.innerHTML = highlight(value);
    if (nextLabel) name.textContent = nextLabel;
  };
  box.setSource(source, label);
  return box;
}
