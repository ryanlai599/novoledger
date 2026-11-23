CREATE TABLE sync_devices (
  id TEXT PRIMARY KEY NOT NULL,
  account TEXT NOT NULL CHECK (length(account) = 64),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  role TEXT NOT NULL CHECK (role IN ('owner', 'device')),
  revoked_at INTEGER
);
-- statement
CREATE INDEX sync_devices_account ON sync_devices(account);
-- statement
CREATE TABLE sync_device_limits (
  device_id TEXT PRIMARY KEY NOT NULL,
  minute INTEGER NOT NULL,
  uses INTEGER NOT NULL
) WITHOUT ROWID;
-- statement
CREATE INDEX sync_receipts_by_revision ON sync_receipts(account, revision);
-- statement
DROP TRIGGER sync_record_commit;
-- statement
CREATE TRIGGER sync_record_commit AFTER INSERT ON sync_snapshots
BEGIN
  INSERT INTO sync_receipts(account, operation_id, request_hash, revision)
  VALUES(NEW.account, NEW.operation_id, NEW.request_hash, NEW.revision);
  DELETE FROM sync_receipts WHERE account = NEW.account AND revision <= NEW.revision - 256;
  DELETE FROM sync_snapshots
  WHERE account = NEW.account AND revision <= NEW.revision - 20
    AND revision NOT IN (
      SELECT MAX(revision) FROM sync_snapshots
      WHERE account = NEW.account AND day >= date('now', '-29 days')
      GROUP BY day
    );
END;
