// Fingerprints are derived from the actual document so every UI change gets a new ID.
const builds = new Map();
export function buildUiDocument(source) {
  if (!builds.has(source)) builds.set(source, (async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    const buildId = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return {buildId, document: source.replaceAll('__BMC_UI_BUILD_ID__', buildId)};
  })());
  return builds.get(source);
}
