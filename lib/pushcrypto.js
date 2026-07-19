import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/* Subscriptions live on a public-access Blob store behind unguessable
   URLs; sealing them means a leaked URL still exposes nothing. */

function keyFromEnv() {
  const hex = (process.env.BLOB_ENC_KEY || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('BLOB_ENC_KEY must be 32 bytes of hex');
  return Buffer.from(hex, 'hex');
}

export function sealJSON(obj, key = keyFromEnv()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') });
}

export function openJSON(str, key = keyFromEnv()) {
  const { iv, tag, ct } = JSON.parse(str);
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  const pt = Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]);
  return JSON.parse(pt.toString('utf8'));
}
