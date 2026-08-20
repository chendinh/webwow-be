// Stub for ESM-only uuid package
// uuid uses ES module syntax which Jest/CommonJS cannot parse.
// This stub provides a simple v4 implementation for tests.
module.exports = {
  v4: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }),
  v1: () => 'stub-v1-uuid',
  v3: () => 'stub-v3-uuid',
  v5: () => 'stub-v5-uuid',
  NIL: '00000000-0000-0000-0000-000000000000',
  MAX: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  version: () => 4,
  validate: () => true,
  stringify: () => 'stub-stringified-uuid',
  parse: () => new Uint8Array(16),
};
