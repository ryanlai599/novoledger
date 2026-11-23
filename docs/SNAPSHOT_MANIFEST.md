# 源码快照清单

这份清单列出快照的全部 81 个文件。路径相对于项目根目录。通过 `npm ci` 安装的依赖、测试临时目录及构建制品不属于源码快照。

## 根目录（8）

```text
.gitignore
README.md
index.html
package.json
package-lock.json
tsconfig.json
vite.config.ts
vitest.config.ts
```

项目入口、依赖锁定、构建和测试配置。

## `src/`（43）

```text
App.tsx
main.tsx
index.css
types.ts
components/AppShell.tsx
components/BackupPage.tsx
components/CloudSyncPanel.tsx
components/Dashboard.tsx
components/ExpenseRecordsPage.tsx
components/HistoryPage.tsx
components/HistoryRestorePreview.tsx
components/IncomePage.tsx
components/MonthPlan.tsx
components/PocketsPage.tsx
components/StatsPanel.tsx
components/ui.tsx
data/seed.test.ts
data/seed.ts
lib/accounting.test.ts
lib/accounting.ts
lib/accountingBaseline.test.ts
lib/cloudReview.ts
lib/d1Client.d.ts
lib/d1Client.js
lib/d1Crypto.d.ts
lib/d1Crypto.js
lib/downloadJson.ts
lib/format.ts
lib/ledgerComparison.test.ts
lib/ledgerComparison.ts
lib/ledgerDb.test.ts
lib/ledgerDb.ts
lib/ledgerPersistence.ts
lib/ledgerSafety.test.ts
lib/ledgerSchema.ts
lib/report.test.ts
lib/report.ts
lib/statistics.test.ts
lib/statistics.ts
lib/sync.test.ts
lib/sync.ts
store/useStore.test.ts
store/useStore.ts
test/ledgerFixture.ts
```

应用界面、记账及报表、持久化与恢复、同步客户端、空白初始化和合成测试。

## `public/`（3）

```text
icon.svg
manifest.webmanifest
sw.js
```

PWA 静态资源和离线缓存。

## `functions/api/`（3）

```text
state.js
state.test.js
sync-v2.js
```

旧接口的 `410` 停用响应及测试，和正式 D1 同步适配。

## `prototype/d1/`（16）

```text
app-browser-tests.mjs
browser-entry.js
browser-test.mjs
compare-backups.test.ts
cutover-safety.test.ts
enroll-test-owner.mjs
fixture.js
functions/api/enrollment.js
functions/api/sync-v2.js
integration.test.ts
local.mjs
migrations/0001_snapshots.sql
migrations/0002_enrollment_and_receipt_window.sql
repository.js
server.test.ts
```

服务端同步协议、SQL 迁移、隔离 D1 运行器、合成数据和浏览器验收。其中登记辅助仅用于本地测试。

## `tools/`（2）

```text
compare-ledger-backups.mjs
prepare-production-pages.mjs
```

离线对账和正式 Pages 本地制品打包，不自动发布。

## `docs/`（6）

```text
ARCHITECTURE.md
DEPLOYMENT.md
PRODUCT_MANUAL.md
SNAPSHOT_MANIFEST.md
superpowers/development-log.md
superpowers/specs/d1-integration.md
```

产品、开发、同步协议和发布边界说明。

## 不纳入快照

- 原仓库的 `.git`、历史、旧部署脚本和真实 Wrangler 配置；原私有交接、运维和设计原稿也只留原目录。
- 旧可写云端接口及其用例、已绑定云环境的预生产脚本、旧构建和托管探测；应用行为由隔离的本地测试验证。
- 真实账本、备份、导出、日志、浏览器数据、本地配置、数据库、令牌和密钥。
- 依赖安装或构建产生的目录、GitHub 自动部署工作流及远程配置。
