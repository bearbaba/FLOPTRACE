const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_PROFILES = 32;

export function isValidEd25519Did(did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:z') || did.length > 128) return false;
  const b58 = did.slice(9);
  if (!b58 || [...b58].some(ch => !ALPHABET.includes(ch))) return false;
  let n = 0n;
  for (const ch of b58) n = n * 58n + BigInt(ALPHABET.indexOf(ch));
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of b58) { if (ch !== '1') break; bytes.unshift(0); }
  return bytes.length === 34 && bytes[0] === 0xed && bytes[1] === 0x01;
}
export function normalizedProfiles(input) {
  if (!Array.isArray(input)) return [];
  const used = new Set(), result = [];
  for (const raw of input) {
    if (!raw || !isValidEd25519Did(raw.did) || used.has(raw.did)) continue;
    used.add(raw.did);
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
    result.push({ did: raw.did, name: name || 'My Agent' });
    if (result.length >= MAX_PROFILES) break;
  }
  return result;
}
export function addProfile(input, {did, name}) {
  if (!isValidEd25519Did(did)) throw new Error('Invalid Ed25519 did:key. Please paste a full public DID.');
  const profiles = normalizedProfiles(input);
  if (profiles.some(p => p.did === did)) throw new Error('This DID is already in your workspace.');
  if (profiles.length >= MAX_PROFILES) throw new Error('Local profile limit reached (32).');
  const label = typeof name === 'string' ? name.trim().slice(0,40) : '';
  return [...profiles, {did, name: label || 'My Agent'}];
}
export function removeProfile(input, did) {
  return normalizedProfiles(input).filter(p => p.did !== did);
}
