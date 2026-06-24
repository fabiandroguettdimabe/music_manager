// youtubei.js ships ESM-only with an `exports` map and no root type entry that
// classic Node module resolution can follow. We rely on it dynamically at
// runtime (Node 24 can require() this ESM package), so we treat it as `any`
// here and access the validated fields directly.
declare module 'youtubei.js';
