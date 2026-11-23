const SYNC_VERSION = 1;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptLedger(json: string, code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json));
  return JSON.stringify({
    v: SYNC_VERSION,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext))
  });
}

export async function decryptLedger(payload: string, code: string): Promise<string> {
  const envelope = JSON.parse(payload) as { v: number; salt: string; iv: string; data: string };
  if (envelope.v !== SYNC_VERSION) throw new Error('加密版本不支持');
  const key = await deriveKey(code, base64ToBytes(envelope.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    key,
    base64ToBytes(envelope.data)
  );
  return new TextDecoder().decode(plain);
}

export function legacyEnvelope(file: string): string | null {
  const isEnvelope = (value: unknown) => {
    const item = value as { v?: unknown; salt?: unknown; iv?: unknown; data?: unknown } | null;
    return item?.v === 1 && typeof item.salt === 'string' && typeof item.iv === 'string' && typeof item.data === 'string';
  };
  try {
    const record = JSON.parse(file);
    if (isEnvelope(record)) return file;
    if (typeof record?.updatedAt === 'number' && typeof record.data === 'string' && isEnvelope(JSON.parse(record.data))) {
      return record.data;
    }
  } catch { /* not an old encrypted file */ }
  return null;
}

export function isValidSyncCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{8,32}$/.test(code.trim());
}
