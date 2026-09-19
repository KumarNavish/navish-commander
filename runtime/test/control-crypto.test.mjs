import test from 'node:test'; import assert from 'node:assert/strict';
import {generateX25519KeyPair,encryptRequest,decryptRequest,encryptResult,decryptResult,PROTOCOL} from '../app/src/control-crypto.mjs';

test('request/result round trip',()=>{
 const device=generateX25519KeyPair();
 const meta={protocol:PROTOCOL,commandId:'c1',controllerId:'d1',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
 const q=encryptRequest({devicePublicKeyPem:device.publicKeyPem,payload:{targetDevice:'local',tool:'get_config',args:{}},meta});
 assert.deepEqual(decryptRequest({devicePrivateKeyPem:device.privateKeyPem,envelope:q.envelope}),{targetDevice:'local',tool:'get_config',args:{}});
 const result=encryptResult({responsePublicKeyPem:q.envelope.crypto.ephemeralPublicKeyPem,payload:{state:'completed',x:42},meta});
 assert.deepEqual(decryptResult({responsePrivateKeyPem:q.responsePrivateKeyPem,envelope:result}),{state:'completed',x:42});
});

test('tampering is rejected',()=>{
 const device=generateX25519KeyPair(); const meta={protocol:PROTOCOL,commandId:'c2',controllerId:'d1',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
 const q=encryptRequest({devicePublicKeyPem:device.publicKeyPem,payload:{x:1},meta}); q.envelope.commandId='evil';
 assert.throws(()=>decryptRequest({devicePrivateKeyPem:device.privateKeyPem,envelope:q.envelope}));
});

test('wrong device key is rejected',()=>{
 const d1=generateX25519KeyPair(),d2=generateX25519KeyPair(); const meta={protocol:PROTOCOL,commandId:'c3',controllerId:'d1',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
 const q=encryptRequest({devicePublicKeyPem:d1.publicKeyPem,payload:{x:1},meta});
 assert.throws(()=>decryptRequest({devicePrivateKeyPem:d2.privateKeyPem,envelope:q.envelope}));
});

test('all authenticated metadata tampering is rejected',()=>{
 const d=generateX25519KeyPair();const base={protocol:PROTOCOL,commandId:'meta',controllerId:'ctl',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};const q=encryptRequest({devicePublicKeyPem:d.publicKeyPem,payload:{x:1},meta:base});
 for(const [k,v] of [['controllerId','other'],['createdAt','2000-01-01T00:00:00.000Z'],['expiresAt','2099-01-01T00:00:00.000Z']]){const e=structuredClone(q.envelope);e[k]=v;assert.throws(()=>decryptRequest({devicePrivateKeyPem:d.privateKeyPem,envelope:e}),k)}
});

test('result cannot be opened with unrelated response key',()=>{
 const device=generateX25519KeyPair(), wrong=generateX25519KeyPair();const meta={protocol:PROTOCOL,commandId:'rwrong',controllerId:'ctl',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};const q=encryptRequest({devicePublicKeyPem:device.publicKeyPem,payload:{x:1},meta});const r=encryptResult({responsePublicKeyPem:q.envelope.crypto.ephemeralPublicKeyPem,payload:{ok:true},meta});assert.throws(()=>decryptResult({responsePrivateKeyPem:wrong.privateKeyPem,envelope:r}));
});
