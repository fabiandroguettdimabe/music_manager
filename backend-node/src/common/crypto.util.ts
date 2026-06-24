import * as crypto from 'crypto';

// Cifrado en reposo de las credenciales de proveedor (ProviderAccount.authJson).
// AES-256-GCM; la clave viene de CREDENTIALS_ENC_KEY (32 bytes en base64).
const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENC_KEY || '';
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('CREDENTIALS_ENC_KEY debe ser 32 bytes codificados en base64');
  }
  return buf;
}

export function encryptJson(obj: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // [iv(12) | tag(16) | ciphertext] en base64
  return Buffer.concat([iv, tag, data]).toString('base64');
}

export function decryptJson<T = any>(blob: string): T {
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(out.toString('utf8')) as T;
}
