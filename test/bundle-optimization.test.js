import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compactShader, compactShaderLiterals } from '../scripts/compact-shaders.mjs';
import { compactWasm } from '../scripts/compact-wasm.mjs';

test('browser entries share class identity and ObjectManager initially excludes heat implementation', async () => {
  const core = await import('../dist/orihon.core.esm.js');
  const standard = await import('../dist/orihon.standard.esm.js');
  const advanced = await import('../dist/orihon.esm.js');
  const geo = await import('../dist/orihon.geo.esm.js');
  assert.equal(core.Orihon, standard.Orihon);
  assert.equal(core.Orihon, advanced.Orihon);
  assert.equal(core.latLng, geo.latLng);
  const manifest = JSON.parse(await readFile(new URL('../dist/release-manifest.json', import.meta.url)));
  const initial = new Set(manifest.initialLoads['orihon.object-manager.esm.js'].files);
  for (const name of ['src/services/object-manager.ts', 'src/react/context.ts']) {
    assert.equal(manifest.moduleOutputs[name].length, 1, `${name} must have one implementation`);
  }
  for (const name of ['src/layers/heat.ts', 'src/services/heat-isolines-wasm.ts', 'src/services/heat-field-webgpu.ts']) {
    assert.ok(manifest.moduleOutputs[name].every(file => !initial.has(file)), `${name} must remain lazy for ObjectManager`);
  }
});

test('shader compaction keeps directives and tokens and ignores arbitrary templates', () => {
  const source = '#version 300 es\n // comment\n void main() {\n  float x = 1.0; /* note */ x = x + +x;\n }';
  const compact = compactShader(source);
  assert.ok(compact.startsWith('#version 300 es\n'));
  assert.match(compact, /x = x \+ \+x/);
  assert.equal(compact.includes('comment'), false);
  const template = 'const html = `  <p> unchanged </p>  `;';
  assert.equal(compactShaderLiterals(template, 'a.ts'), template);
});

test('WASM compaction preserves exports/imports and target features in every embedded kernel', async () => {
  for (const name of ['layers/mvt-tile-wasm', 'services/cluster-index-wasm', 'services/heat-field-wasm', 'services/heat-isolines-wasm']) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
    const encoded = source.match(/"(AGFzbQ[A-Za-z0-9+/=]+)"/)[1];
    const before = Buffer.from(encoded, 'base64'), after = compactWasm(before);
    const original = new WebAssembly.Module(before), compact = new WebAssembly.Module(after);
    assert.ok(after.length <= before.length);
    assert.deepEqual(WebAssembly.Module.exports(compact), WebAssembly.Module.exports(original));
    assert.deepEqual(WebAssembly.Module.imports(compact), WebAssembly.Module.imports(original));
    assert.deepEqual(WebAssembly.Module.customSections(compact, 'target_features'), WebAssembly.Module.customSections(original, 'target_features'));
    assert.equal(WebAssembly.Module.customSections(compact, 'name').length, 0);
    assert.equal(WebAssembly.Module.customSections(compact, 'producers').length, 0);
    assert.deepEqual(compactWasm(after), after);
  }
  assert.throws(() => compactWasm(Buffer.from('bad')), /header/);
});
