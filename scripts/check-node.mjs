// Require a Node version that supports Vite 8 and the global WebCrypto/fetch APIs
// this app relies on: Node 20.19+ or any 22.12+.
export function checkNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
  if (!ok) {
    throw new Error(`This app requires Node 20.19+ or 22.12+; current Node is ${version}. Select a supported Node version for this terminal, then retry.`);
  }
}
checkNode();
