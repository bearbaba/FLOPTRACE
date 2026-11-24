import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createLocalIdentity} from '../js/identity-create.mjs';
import {isValidEd25519Did} from '../js/did-utils.mjs';

const PASS='test-device-passphrase-very-long';
async function browserCryptoUtil(){
  const source=await readFile(new URL('../js/crypto.js',import.meta.url),'utf8');
  const scope={window:{},crypto:webcrypto,TextEncoder,TextDecoder,btoa,atob};
  runInNewContext(source,scope);
  return scope.window.CryptoUtil;
}
test('creating Ed25519 DID produces decryptable backup and non-extractable signing key',async()=>{
  const cryptoUtil=await browserCryptoUtil();
  const {did,backup,signingKey}=await createLocalIdentity(PASS,{webCrypto:webcrypto,cryptoUtil});
  assert.equal(isValidEd25519Did(did),true);
  assert.equal(backup.did,did);
  assert.equal(backup.alg,'PBKDF2-SHA256-AES-GCM');
  assert.equal(signingKey.extractable,false);
  assert.ok(signingKey.usages.includes('sign'));
  assert.equal(JSON.stringify(backup).includes('seed_hex'),false);
  const opened=await cryptoUtil.decryptBackup(backup,PASS);
  assert.equal(opened.did,did);
  assert.match(opened.seed_hex,/^[0-9a-f]{64}$/);
  const seed=Buffer.from(opened.seed_hex,'hex');
  const prefix=Buffer.from('302e020100300506032b657004220420','hex');
  const reconstructed=await webcrypto.subtle.importKey('pkcs8',Buffer.concat([prefix,seed]),{name:'Ed25519'},true,['sign']);
  const jwk=await webcrypto.subtle.exportKey('jwk',reconstructed);
  const pub=Buffer.from(jwk.x,'base64url');
  assert.equal(did,cryptoUtil.didFromPub(pub));
  const challenge=Buffer.from('Test FLOPTRACE local identity proof');
  const signed=await webcrypto.subtle.sign('Ed25519',signingKey,challenge);
  const verifyKey=await webcrypto.subtle.importKey('raw',pub,{name:'Ed25519'},false,['verify']);
  assert.equal(await webcrypto.subtle.verify('Ed25519',verifyKey,signed,challenge),true);
  await assert.rejects(()=>cryptoUtil.decryptBackup(backup,'wrong-passphrase'),/decrypt|operation/i);
  seed.fill(0);
});
test('creation fails clearly when browser cannot create protected keys or the passphrase is too short',async()=>{
  const cryptoUtil=await browserCryptoUtil();
  await assert.rejects(()=>createLocalIdentity('short',{webCrypto:webcrypto,cryptoUtil}),/at least 12/);
  await assert.rejects(()=>createLocalIdentity(PASS,{webCrypto:{subtle:null},cryptoUtil}),/unavailable/);
});
test('identity creation stays on the same page with visible errors, public DID and backup retry',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../css/unified.css',import.meta.url),'utf8');
  for(const id of ['createAgent','importAgent','createFeedback','importFeedback',
    'identityStatus','createdDidResult','createdDidValue','copyCreatedDid','downloadCreatedBackup']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.ok(html.indexOf('id="identityStatus"')<html.indexOf('class="advanced-tools identity-advanced"'),
    'Global status should be visible outside collapsed Advanced panel');
  assert.doesNotMatch(html,/href="\/legacy\/index\.html"/);
  assert.match(js,/await createLocalIdentity\(pass/);
  assert.match(js,/identityFeedback\('createFeedback'/);
  assert.match(js,/identityFeedback\('importFeedback'/);
  assert.match(js,/download\(recentEncryptedBackup\.filename,recentEncryptedBackup\.backup\)/);
  assert.match(js,/document\.body\.append\(a\)/);
  assert.match(css,/\.identity-inline-feedback\.error/);
  assert.match(css,/\.identity-created/);
});
