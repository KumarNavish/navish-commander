import crypto from 'node:crypto';

export const PROTOCOL = 'navish-github-control/v1';

export function generateX25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function publicKeyFromPrivate(privateKeyPem) {
  return crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({type:'spki',format:'pem'}).toString();
}

function deriveKey(privateKeyPem, publicKeyPem, salt, context) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const shared = crypto.diffieHellman({ privateKey, publicKey });
  return crypto.hkdfSync('sha256', shared, salt, Buffer.from(context), 32);
}

function aadFor(meta) {
  const fields=[meta.protocol,meta.commandId,meta.controllerId,meta.createdAt,meta.expiresAt];
  if(fields.some(x=>typeof x !== 'string' || x.includes('\0'))) throw new Error('invalid authenticated metadata');
  return Buffer.from(fields.join('\0'),'utf8');
}

export function encryptRequest({ devicePublicKeyPem, payload, meta }) {
  const ephemeral = generateX25519KeyPair();
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(ephemeral.privateKeyPem, devicePublicKeyPem, salt, `${PROTOCOL}:request`);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(meta));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    envelope: {
      ...meta,
      protocol: PROTOCOL,
      crypto: {
        kex: 'x25519', kdf: 'hkdf-sha256', aead: 'aes-256-gcm',
        ephemeralPublicKeyPem: ephemeral.publicKeyPem,
        salt: salt.toString('base64'), iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
      },
    },
    responsePrivateKeyPem: ephemeral.privateKeyPem,
  };
}

export function decryptRequest({ devicePrivateKeyPem, envelope }) {
  if (envelope?.protocol !== PROTOCOL) throw new Error('unsupported protocol');
  const c = envelope.crypto || {};
  const salt = Buffer.from(c.salt || '', 'base64');
  const iv = Buffer.from(c.iv || '', 'base64');
  const key = deriveKey(devicePrivateKeyPem, c.ephemeralPublicKeyPem, salt, `${PROTOCOL}:request`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aadFor(envelope));
  decipher.setAuthTag(Buffer.from(c.tag || '', 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(c.ciphertext || '', 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

export function encryptResult({ responsePublicKeyPem, payload, meta }) {
  const ephemeral = generateX25519KeyPair();
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(ephemeral.privateKeyPem, responsePublicKeyPem, salt, `${PROTOCOL}:result`);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(meta));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    ...meta,
    protocol: PROTOCOL,
    crypto: {
      kex: 'x25519', kdf: 'hkdf-sha256', aead: 'aes-256-gcm',
      ephemeralPublicKeyPem: ephemeral.publicKeyPem,
      salt: salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    },
  };
}

export function decryptResult({ responsePrivateKeyPem, envelope }) {
  if (envelope?.protocol !== PROTOCOL) throw new Error('unsupported protocol');
  const c = envelope.crypto || {};
  const salt = Buffer.from(c.salt || '', 'base64');
  const iv = Buffer.from(c.iv || '', 'base64');
  const key = deriveKey(responsePrivateKeyPem, c.ephemeralPublicKeyPem, salt, `${PROTOCOL}:result`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aadFor(envelope));
  decipher.setAuthTag(Buffer.from(c.tag || '', 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(c.ciphertext || '', 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}
