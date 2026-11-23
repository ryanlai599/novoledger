import { validateImport } from './accounting';
import { sameLedger } from './ledgerSchema';

type Review =
  | { kind: 'missing' | 'same' }
  | { kind: 'different'; local: string; remote: string };

export function createCloudReview(deps: {
  local: () => string;
  read: (code: string) => Promise<string | null>;
  restore: (json: string) => boolean;
}) {
  let checking = false;
  let latest: Review | undefined;
  return {
    async check(code: string): Promise<Review> {
      if (checking) throw new Error('云端检查进行中');
      checking = true;
      latest = undefined;
      try {
        const local = deps.local();
        const raw = await deps.read(code);
        if (deps.local() !== local) throw new Error('检查期间本地账本已变化，请重新检查云端账本');
        if (raw === null) return { kind: 'missing' };
        const remote = validateImport(JSON.parse(raw));
        if (sameLedger(JSON.parse(local), remote)) return { kind: 'same' };
        latest = { kind: 'different', local, remote: JSON.stringify(remote, null, 2) };
        return latest;
      } finally {
        checking = false;
      }
    },
    async restore(review: Review): Promise<boolean> {
      if (checking || review !== latest || review.kind !== 'different') throw new Error('请重新检查云端账本');
      if (deps.local() !== review.local) throw new Error('本地账本已变化，请重新检查云端账本');
      if (!deps.restore(review.remote)) throw new Error('恢复失败：账本无效、存储不可用或另一标签页已更新');
      latest = undefined;
      return true;
    }
  };
}
