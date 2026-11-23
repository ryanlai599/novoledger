# Pages 正式制品

正式目标是独立 Direct Upload 项目 `novoledger-prod` 的 Production `main`，同步入口固定为 `https://novoledger-prod.pages.dev/api/sync-v2`。Release 仅在此精确 HTTPS 源开放 v2；其他 API 入口返回 `410` 和 `Cache-Control: no-store`。Preview 不部署正式制品，也不绑定 D1 或 KV。无 GitHub Actions 或自动发布脚本。

## 在本地生成制品

1. 先运行 `npm test`、`npm run build` 和本地应用浏览器测试。
2. 在 Cloudflare 控制面单独核对账号、项目、主域和 Production 的现有 `SYNC_DB`。只使用已批准的现有 D1 UUID；不要在机器上保存或提交访问令牌。
3. 将下方 `VERIFIED_D1_UUID` 替换为已核对的 UUID。命令只会生成临时制品，不登录或部署。Maintenance 模式关闭全部 API 工作流，不绑定数据库。

   ```sh
   npm run package:pages -- release VERIFIED_D1_UUID
   npm run package:pages -- maintenance
   ```

4. 审查临时目录中的 `dist/`、`target.json` 与 `wrangler.toml.example`。Production 只能绑定现有 `SYNC_DB`，Preview 不绑定；不要把生成的配置或制品提交到仓库。`NOVO_D1_WRITES` 停用只暂停快照提交，不等同于停用所有 v2 入口；完全停用需要阻断整个入口或移除绑定。

正式环境已初始化。不要为一次正常发版重建 D1、重复执行迁移、登记管理员或重发版本 1。首次建空测试库时，按文件序号使用两条 SQL 迁移；测试命令自动将它们应用到本地隔离库。实际部署、D1 写入和回滚方案需要另行批准并核对目标。
