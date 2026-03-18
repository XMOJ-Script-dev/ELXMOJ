# 小明的OJ (ELXMOJ)

> **ELXMOJ** 是 [小明的OJ (xmoj.tech)](https://www.xmoj.tech/) 的官方 Electron 桌面客户端。
> 它将 [XMOJ-Script](https://github.com/XMOJ-Script-dev/XMOJ-Script) 的所有增强功能通过原生 SDK 实现，无需浏览器扩展或油猴脚本管理器。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 🖥️ **原生桌面应用** | 无需浏览器插件，直接安装运行 |
| 🔄 **自动注入最新增强脚本** | 每次启动时从 GitHub 获取最新 XMOJ.user.js |
| 📋 **原生剪贴板** | 复制样例、代码、题目内容使用系统剪贴板 |
| 🔔 **原生系统通知** | 讨论区和私信提醒通过操作系统通知中心推送 |
| 🍪 **Cookie 管理** | 通过 Electron Session API 管理会话 Cookie |
| ⚙️ **设置面板** | 原生设置窗口，可开关全部 XMOJ-Script 功能 |
| 🧭 **中文导航菜单** | 题库、提交记录、比赛、讨论等快速入口 |
| 💾 **持久化设置** | 偏好设置跨会话保存并自动同步 |
| 🌗 **主题支持** | 亮色 / 暗色 / 跟随系统 |
| 🆙 **自动更新** | 发布新版本后自动检测并提示下载 |

---

## 下载安装

前往 [Releases 页面](https://github.com/XMOJ-Script-dev/ELXMOJ/releases/latest) 下载对应平台的安装包：

| 平台 | 文件格式 |
|------|----------|
| Windows | `.exe` 安装程序 (NSIS) |
| macOS | `.dmg` 磁盘镜像 |
| Linux | `.AppImage` 便携包 |

---

## 开发环境

### 环境要求

- [Node.js](https://nodejs.org/) 18 或更高版本
- [npm](https://www.npmjs.com/)（随 Node.js 一起安装）

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/XMOJ-Script-dev/ELXMOJ.git
cd ELXMOJ

# 安装依赖
npm install

# 启动应用
npm start
```

### 构建发行版

```bash
# 构建当前平台
npm run dist

# 仅构建 Windows
npm run dist:win

# 仅构建 macOS
npm run dist:mac

# 仅构建 Linux
npm run dist:linux
```

### 语法检查

```bash
npm test
```

---

## 项目结构

| 文件 / 目录 | 说明 |
|-------------|------|
| `src/main.js` | Electron 主进程：窗口、托盘、菜单、IPC 处理器、自动更新 |
| `src/preload.js` | 渲染进程预加载：注入 GM_* 兼容层，加载 @require 依赖库，注入 XMOJ.user.js |
| `src/settings/index.html` | 原生设置面板（40+ 功能开关） |
| `src/settings/preload.js` | 设置窗口到主进程的 IPC 桥接 |
| `.github/workflows/ci.yml` | PR 代码检查工作流 |
| `.github/workflows/release.yml` | 合并到 master 后自动构建并发布 Release |

### 工作原理

应用启动后打开 `https://www.xmoj.tech/`，`preload.js` 依次执行：

1. **同步持久化设置** → 将 electron-store 中保存的设置写入页面 `localStorage`
2. **注入 GM_* 兼容层** → 为 `GM_xmlhttpRequest`、`GM_setClipboard`、`GM.cookie` 等 API 提供原生实现
3. **加载 @require 依赖** → 按顺序加载 CryptoJS、CodeMirror、DOMPurify、FileSaver、marked、diff-match-patch
4. **注入 XMOJ.user.js** → 从 GitHub 获取最新脚本并注入，离线时回退到 sessionStorage 缓存

---

## CI / 自动发布

- **每个 PR** 触发 `.github/workflows/ci.yml`：语法检查、package.json 校验、设置页面校验
- **合并到 `master`** 触发 `.github/workflows/release.yml`：在 Windows / macOS / Linux 上构建并自动发布 GitHub Release

---

## 许可证

[GPL-3.0-or-later](LICENSE) © XMOJ-Script-dev

