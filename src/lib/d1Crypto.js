export const MAX_ENVELOPE_BYTES = 512 * 1024;
export const isToken = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const isOperationId = value => typeof value === 'string' && /^(?:[1-9]\d{0,15}:)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const isRevision = value => Number.isSafeInteger(value) && value >= 0;

const utf8 = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const base64 = bytes => {
  let str = '';
  for (let index = 0; index < bytes.length; index++) str += String.fromCharCode(bytes[index]);
  return btoa(str);
};
const unbase64 = str => Uint8Array.from(atob(str), byte => byte.charCodeAt(0));

export const newAccessToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value))));
export const tokenDigest = token => digest(`novoledger:device:v1:${token}`);
export const accountFor = async token => {
  if (!isToken(token)) throw new Error('访问令牌格式无效');
  return digest(`novoledger:access:v2:${token}`);
};

function aad({ account, revision, operationId }) {
  if (!isToken(account) || !isRevision(revision) || revision === 0 || !isOperationId(operationId)) {
    throw new Error('快照元数据无效');
  }
  return utf8.encode(JSON.stringify(['novoledger:snapshot:v2', account, revision, operationId]));
}

async function derive(secret, salt) {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('需独立加密口令（至少 16 个字符）');
  const material = await crypto.subtle.importKey('raw', utf8.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function validateEnvelope(envelope) {
  if (typeof envelope !== 'string' || envelope.length > MAX_ENVELOPE_BYTES) throw new Error('密文太大或格式无效');
  const item = JSON.parse(envelope);
  const canonicalBase64 = value => typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
  if (!item || item.v !== 2 || typeof item.salt !== 'string' || item.salt.length !== 24
      || typeof item.iv !== 'string' || item.iv.length !== 16
      || typeof item.data !== 'string' || item.data.length < 24
      || ![item.salt, item.iv, item.data].every(canonicalBase64)
      || JSON.stringify({ v: 2, salt: item.salt, iv: item.iv, data: item.data }) !== envelope) {
    throw new Error('密文结构无效');
  }
  const salt = unbase64(item.salt);
  const iv = unbase64(item.iv);
  const data = unbase64(item.data);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16
      || base64(salt) !== item.salt || base64(iv) !== item.iv || base64(data) !== item.data) {
    throw new Error('密文编码无效');
  }
  return { salt, iv, data };
}

export async function seal(json, secret, metadata) {
  const plain = utf8.encode(json);
  if (plain.length > (MAX_ENVELOPE_BYTES - 128) * 3 / 4) throw new Error('账本超过完整快照容量上限');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(metadata) },
    await derive(secret, salt), plain);
  return JSON.stringify({ v: 2, salt: base64(salt), iv: base64(iv), data: base64(new Uint8Array(ciphertext)) });
}

export async function open(envelope, secret, metadata) {
  const { salt, iv, data } = validateEnvelope(envelope);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(metadata) },
    await derive(secret, salt), data);
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}
