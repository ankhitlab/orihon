import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { compactWasm } from './compact-wasm.mjs';

// Keep token boundaries and preprocessor line endings. No identifier/number or
// operator rewriting: shader interfaces and floating-point expressions are API.
export function compactShader(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\r\n]*/g, '')
    .split(/\r?\n/).map(line => line.trim().replace(/[\t ]+/g, ' '))
    .filter(Boolean).join('\n');
}

export function compactShaderLiterals(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  function visit(node) {
    if (ts.isStringLiteral(node) && ts.isVariableDeclaration(node.parent)
      && /WASM_BASE64$/.test(node.parent.name.getText(tree)) && node.text.startsWith('AGFzbQ')) {
      edits.push([node.getStart(tree), node.end, JSON.stringify(compactWasm(Buffer.from(node.text, 'base64')).toString('base64'))]);
    }
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const shader = ts.isCallExpression(parent) && parent.expression.getText(tree) === 'compileShader'
        && parent.arguments[2] === node;
      const named = ts.isVariableDeclaration(parent) && /(?:WGSL|SHADER)$/.test(parent.name.getText(tree));
      if (shader || named) edits.push([node.getStart(tree), node.end, JSON.stringify(compactShader(node.text))]);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const [start, end, replacement] of edits.reverse()) source = source.slice(0, start) + replacement + source.slice(end);
  return source;
}

export const compactShadersPlugin = {
  name: 'compact-shader-literals',
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
      contents: compactShaderLiterals(await readFile(path, 'utf8'), path), loader: 'ts'
    }));
  }
};
