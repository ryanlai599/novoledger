import { expect, it } from 'vitest';
import { onRequest } from './state.js';

it.each(['GET', 'PUT', 'POST', 'HEAD', 'OPTIONS'])('旧接口拒绝 %s，不读取或写入任何绑定', async method => {
  const response = await onRequest({
    request: new Request('https://ledger.invalid/api/state', { method }),
    get env() { throw new Error('已退役接口不得访问任何绑定'); }
  });
  expect(response.status).toBe(410);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('');
});
