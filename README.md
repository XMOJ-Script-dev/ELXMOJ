# ELXMOJ (Electron)

在 Electron 中访问 `https://www.xmoj.tech`，自动加载 `XMOJ.user.js`，并提供启动自检、脚本更新与设置持久化。

## 功能

- 启动后打开 `www.xmoj.tech`
- 自动注入仓库内 `XMOJ.user.js`（首次运行复制到用户数据目录）
- 每次启动可检查脚本更新
- 正式版更新源：`https://xmoj-bbs.me/XMOJ.user.js`
- 预览版更新源：`https://dev.xmoj-bbs.me/XMOJ.user.js`
- App 下载更新源：GitHub Releases `https://github.com/XMOJ-Script-dev/ELXMOJ/releases/download/v{version}/ELXMOJ-{version}.{ext}`
	- ext 按平台自动适配：Windows `.exe` / macOS `.dmg` / Linux `.AppImage`
- 发现新版本时弹窗提示用户是否更新
- 设置持久化（通道、启动检查、自动注入）
- 提供启动自检和手动自检

## 运行

```bash
npm install
npm start
```

## 自检模式

```bash
npm run self-check
```

## 代码检查

```bash
npm run check
```

包含：

- `eslint` 静态检查（`src`）
- Node 语法检查（`node --check`）

## 全平台打包

```bash
npm run pack:win
npm run pack:mac
npm run pack:linux
```

打包产物默认输出到 `dist/`。

## GitHub Actions

- 代码检查工作流：`.github/workflows/code-check.yml`
	- 在 `push` / `pull_request` 触发
	- 执行 `npm ci` + `npm run check`
- 发布构建工作流：`.github/workflows/release-build.yml`
	- 在手动触发或 `v*` tag 触发
	- Windows/macOS/Linux 矩阵并行打包
	- `v*` tag 时自动创建 GitHub Release 并上传产物

应用菜单 `ELXMOJ` 中也可以执行：

- 设置
- 执行自检
- 检查脚本更新

## 持久化位置

应用会把运行数据写到 Electron 的 `userData` 目录，包括：

- `settings.json`
- `XMOJ.user.js`（托管脚本文件）
