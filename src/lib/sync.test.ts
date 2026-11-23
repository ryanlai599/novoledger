import { describe, expect, it } from 'vitest';
import { decryptLedger, encryptLedger, isValidSyncCode, legacyEnvelope } from './sync';
import { createEmptyLedger } from '../data/seed';
import { importLegacyCiphertext } from './d1Client';

describe('sync encryption', () => {
  it('加密解密往返一致', async () => {
    const json = JSON.stringify({ hello: '账本', amount: 1234.5 });
    const payload = await encryptLedger(json, 'test-code-123');
    expect(payload).not.toContain('账本');
    expect(await decryptLedger(payload, 'test-code-123')).toBe(json);
  });

  it('错误同步码无法解密', async () => {
    const payload = await encryptLedger('secret', 'correct-code-123');
    await expect(decryptLedger(payload, 'wrong-code-456')).rejects.toThrow();
  });

  it('同步码格式校验', () => {
    expect(isValidSyncCode('abc12345')).toBe(true);
    expect(isValidSyncCode('short')).toBe(false);
    expect(isValidSyncCode('有中文')).toBe(false);
  });

  it('AES-GCM 拒绝遭修改的密文', async () => {
    const envelope = JSON.parse(await encryptLedger('账本', 'example-test-code')) as { data: string };
    const bytes = Uint8Array.from(atob(envelope.data), char => char.charCodeAt(0));
    bytes[0] ^= 1;
    envelope.data = btoa(String.fromCharCode(...bytes));
    await expect(decryptLedger(JSON.stringify(envelope), 'example-test-code')).rejects.toThrow();
  });
  it('旧同步码兼容原始加密文件与旧响应包，不把普通 JSON 当作密文', async () => {
    const plain = JSON.stringify(createEmptyLedger('2026-11'));
    const old = await encryptLedger(plain, 'synthetic-sync-code');
    const wrapper = JSON.stringify({ exists: true, updatedAt: 17, data: old });
    expect(legacyEnvelope(plain)).toBeNull();
    expect(legacyEnvelope(wrapper)).toBe(old);
    expect(JSON.parse(await importLegacyCiphertext(wrapper, ' synthetic-sync-code '))).toEqual(JSON.parse(plain));
    await expect(importLegacyCiphertext(old, 'wrong-sync-code')).rejects.toThrow(/不匹配/);
    await expect(importLegacyCiphertext(plain, 'synthetic-sync-code')).rejects.toThrow(/普通 JSON/);
  });
});
