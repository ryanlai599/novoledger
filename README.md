# NovoLedger

NovoLedger 是本地优先的个人财务工作台，支持收支、月度预算、资金来源、小荷包、统计报表和离线 PWA。首次使用从空白账本开始。云同步需要手动检查和提交；设备访问令牌与账本加密口令是两项独立凭证。

正式入口：[novoledger-prod.pages.dev](https://novoledger-prod.pages.dev/)。部署直链和 Preview 不是同步入口。

## 本地开发

使用 Node.js 22.18+（建议 Node.js 24）和 npm。Windows PowerShell 用 `npm.cmd`：

```sh
npm ci
npm run dev
npm test
npm run build
```

`npm run dev` 默认监听端口 5173；不要在公共网络暴露开发服务器。`npm run build` 生成默认不启用云同步的本地静态站。同步验证使用隔离的本地 D1 和合成账本，不需要 Cloudflare 账户。

```sh
npm run test:browser
npm run test:browser -- --app
```

浏览器测试需要 Chromium、Chrome 或 Edge。未自动找到时，可在当前终端将 `NOVO_TEST_CHROME` 指向本机浏览器可执行文件。测试会启动临时浏览器配置和本地数据库。

- [产品说明](docs/PRODUCT_MANUAL.md)
- [架构和开发说明](docs/ARCHITECTURE.md)
- [D1 与同步协议](docs/superpowers/specs/d1-integration.md)
- [正式站打包及核对说明](docs/DEPLOYMENT.md)
- [源码快照文件清单](docs/SNAPSHOT_MANIFEST.md)
