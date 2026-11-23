# 架构与开发

| 位置 | 作用 |
| --- | --- |
| `src/components/` | 记账、预算、资金来源、小荷包、统计、历史、备份与同步 UI |
| `src/lib/accounting.ts` | 账务规则、导入迁移和状态转换 |
| `src/lib/ledgerDb.ts`、`src/store/` | IndexedDB 权威存储、事务更新和 Zustand 投影 |
| `src/lib/d1Client.js`、`src/lib/d1Crypto.js` | 手动同步、待发请求、版本核对和本机加解密 |
| `public/` | PWA 图标、清单和 Service Worker；缓存不纳入 API 响应 |
| `functions/api/`、`prototype/d1/` | Pages 适配、同步协议实现、D1 迁移及本地验收 |
| `tools/` | 离线备份比较与正式 Pages 制品生成 |

本机数据在 IndexedDB 提交后才更新界面；跨标签通知不传账本。旧 localStorage 键和历史缓存命名是兼容标识，保留其值是为了迁移及清理旧缓存，与部署目标无关。旧备份只在本机处理，不访问已退役的云同步 API。

单元和 D1 集成测试使用合成样例。完整浏览器脚本运行真实应用构建及隔离的 Miniflare，覆盖本机迁移、跨标签、离线工作、手动同步、异常收据、错误口令、冲突和历史恢复。账务基线测试也记录已知现状，不把它们当作已修复问题。

同步端口与数据约束见 [D1 协议文档](superpowers/specs/d1-integration.md)。
