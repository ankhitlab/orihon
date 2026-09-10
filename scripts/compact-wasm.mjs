/** Drop only debug names/compiler provenance; preserve code, exports and features. */
export function compactWasm(bytes) {
  const input = Buffer.from(bytes);
  if (!input.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error('Invalid WASM header');
  let offset = 8;
  function uint() {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (offset >= input.length) throw new Error('Truncated WASM length');
      const byte = input[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid WASM length');
  }
  const parts = [input.subarray(0, 8)];
  while (offset < input.length) {
    const start = offset, id = input[offset++], length = uint(), end = offset + length;
    if (end > input.length) throw new Error('Truncated WASM section');
    let omit = false;
    if (id === 0) {
      const nameLength = uint();
      if (offset + nameLength > end) throw new Error('Invalid WASM section name');
      const name = input.subarray(offset, offset + nameLength).toString('utf8');
      omit = name === 'name' || name === 'producers';
    }
    if (!omit) parts.push(input.subarray(start, end));
    offset = end;
  }
  return Buffer.concat(parts);
}
