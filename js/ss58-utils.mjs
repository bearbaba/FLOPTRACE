const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const encoder = new TextEncoder();
const PREFIX = encoder.encode('SS58PRE');
function decodeBase58(text) {
  let x = 0n;
  for(const ch of text) {
    const index=BASE58.indexOf(ch);
    if(index<0)throw new Error('Address contains characters outside Base58');
    x=x*58n+BigInt(index);
  }
  const output=[];
  while(x>0n){output.unshift(Number(x%256n));x/=256n;}
  for(const ch of text){if(ch!=='1')break;output.unshift(0);}
  return Uint8Array.from(output);
}
export async function validateSs58(address, cryptoSubtle=globalThis.crypto?.subtle) {
  if(typeof address!=='string'||address.startsWith('did:')||address.length<35||address.length>64)
    return {valid:false,reason:'Use a public SS58 wallet address, not a DID, mnemonic or seed.'};
  if(!cryptoSubtle?.digest) return {valid:false,reason:'Secure checksum verification is unavailable in this browser.'};
  let decoded;
  try{decoded=decodeBase58(address);}
  catch{return {valid:false,reason:'Address contains invalid Base58 characters.'};}
  const first=decoded[0],len=first<64?1:first<128?2:0;
  if(!len||decoded.length!==32+len+2) return {valid:false,reason:'Unsupported address format. FLOP requires a public 32-byte SS58 account address.'};
  const payload=decoded.slice(0,-2);
  const message=new Uint8Array(PREFIX.length+payload.length);
  message.set(PREFIX);message.set(payload,PREFIX.length);
  const hash=new Uint8Array(await cryptoSubtle.digest('SHA-512',message));
  if(decoded[decoded.length-2]!==hash[0]||decoded[decoded.length-1]!==hash[1])
    return {valid:false,reason:'SS58 checksum mismatch. Check the address carefully.'};
  return {valid:true,reason:'SS58 checksum valid. Chain balance and account ownership have not been checked.'};
}
