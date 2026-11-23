CREATE TABLE sync_snapshots (
  account TEXT NOT NULL CHECK (length(account) = 64),
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 36 AND 53),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  envelope TEXT NOT NULL CHECK (length(envelope) BETWEEN 1 AND 524288),
  day TEXT NOT NULL DEFAULT (date('now')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (account, revision)
) WITHOUT ROWID;
-- statement
CREATE TABLE sync_receipts (
  account TEXT NOT NULL CHECK (length(account) = 64),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 36 AND 53),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 9007199254740991),
  PRIMARY KEY (account, operation_id)
) WITHOUT ROWID;
-- statement
CREATE TRIGGER sync_record_commit AFTER INSERT ON sync_snapshots
BEGIN
  INSERT INTO sync_receipts(account, operation_id, request_hash, revision)
  VALUES(NEW.account, NEW.operation_id, NEW.request_hash, NEW.revision);

  DELETE FROM sync_snapshots
  WHERE account = NEW.account AND revision <= NEW.revision - 20
    AND revision NOT IN (
      SELECT MAX(revision) FROM sync_snapshots
      WHERE account = NEW.account AND day >= date('now', '-29 days')
      GROUP BY day
    );
END;
