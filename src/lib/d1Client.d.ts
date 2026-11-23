import type { LedgerRepository, Workspace } from './ledgerDb';

export interface CloudVersion { revision: number; operationId: string; createdAt: number }
export interface HistoryPreview {
  revision: number;
  currentJson: string;
  targetJson: string;
  apply(): Promise<Workspace | undefined>;
}
export function importLegacyCiphertext(envelope: string, oldSecret: string): Promise<string>;
export function createSyncClient(options: { token: string; account: string; secret: string; repository: LedgerRepository }): {
  reviewCloud(): Promise<number>;
  submit(): Promise<{ kind: 'nothing' } | { kind: 'conflict'; revision: number; expired: boolean } | { kind: 'committed'; revision: number; replay: boolean }>;
  history(): Promise<CloudVersion[]>;
  resolveConflict(choice: 'local' | 'cloud', generation: number, operationId: string): Promise<Workspace | undefined>;
  previewHistory(revision: number, operationId: string): Promise<HistoryPreview>;
};
