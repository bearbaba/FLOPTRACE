import {isValidEd25519Did} from './did-utils.mjs';

// Build a DID and its encrypted, portable backup entirely in the user's browser.
// Never upload the seed. Return only an encrypted backup and a non-extractable
// in-memory signing key; the user is responsible for saving the download.
function fromBase64url(value) {
  const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(normalized+'='.repeat((4-normalized.length%4)%4));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export async function createLocalIdentity(passphrase,{webCrypto=globalThis.crypto,cryptoUtil=globalThis.window?.CryptoUtil}={}) {
  if(typeof passphrase!=='string'||passphrase.length<12)
    throw new Error('Use a backup passphrase of at least 12 characters.');
  if(!webCrypto?.subtle?.generateKey||!webCrypto?.subtle?.importKey||!cryptoUtil?.encryptBackup||!cryptoUtil?.didFromPub)
    throw new Error('Secure Ed25519 cryptography is unavailable in this browser. Use an updated browser over HTTPS.');
  let seed,pkcs8;
  try {
    const pair=await webCrypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
    const [pubJwk,privateJwk,rawPkcs8]=await Promise.all([
      webCrypto.subtle.exportKey('jwk',pair.publicKey),
      webCrypto.subtle.exportKey('jwk',pair.privateKey),
      webCrypto.subtle.exportKey('pkcs8',pair.privateKey)
    ]);
    pkcs8=new Uint8Array(rawPkcs8);
    const pub=fromBase64url(pubJwk.x);
    seed=fromBase64url(privateJwk.d);
    if(pub.length!==32||seed.length!==32)throw new Error('Browser returned an unsupported Ed25519 key.');
    const did=cryptoUtil.didFromPub(pub);
    if(!isValidEd25519Did(did))throw new Error('Generated DID failed local validation.');
    const seedHex=Array.from(seed,b=>b.toString(16).padStart(2,'0')).join('');
    const backup=await cryptoUtil.encryptBackup(seedHex,did,passphrase);
    if(backup?.did!==did||!backup.ct||!backup.iv||!backup.salt)
      throw new Error('Encrypted backup could not be verified.');
    // Import again as non-extractable. The extractable generation key is NOT
    // retained by FLOPTRACE; only a signing-only CryptoKey remains in this tab.
    const signingKey=await webCrypto.subtle.importKey('pkcs8',pkcs8,{name:'Ed25519'},false,['sign']);
    const challenge=new Uint8Array(32);
    webCrypto.getRandomValues(challenge);
    const signature=await webCrypto.subtle.sign('Ed25519',signingKey,challenge);
    const verified=await webCrypto.subtle.verify('Ed25519',pair.publicKey,signature,challenge);
    if(!verified||signingKey.extractable)throw new Error('Local Ed25519 self-check failed.');
    return {did,backup,signingKey};
  }catch(error){
    if(error?.name==='NotSupportedError')
      throw new Error('This browser cannot create Ed25519 signing keys. Update your browser and try again.');
    throw error;
  }finally{
    if(seed)seed.fill(0);
    if(pkcs8)pkcs8.fill(0);
  }
}
