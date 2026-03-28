const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } = require("electron");

const {
  loadSettings,
  saveSettings,
  readManagedScript,
  writeManagedScript,
  ensureManagedScript
} = require("./storage");
const {
  getChannelUrl,
  downloadText,
  extractVersion,
  extractName,
  extractRequires,
  isNewerVersion
} = require("./updater");

const ALLOWED_GM_XHR_HOSTS = new Set([
  "www.xmoj.tech",
  "xmoj.tech",
  "116.62.212.172",
  "api.xmoj-bbs.me",
  "api.xmoj-bbs.tech",
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "raw.githubusercontent.com",
  "gitee.com",
  "challenges.cloudflare.com",
  "cppinsights.io",
  "127.0.0.1",
  "localhost"
]);

let mainWindow = null;
let settingsWindow = null;
let settingsCache = null;
let lastCheckResult = null;

const LOCAL_SCRIPT_PATH = path.join(__dirname, "..", "XMOJ-Script", "XMOJ.user.js");
const XMOJ_HOME = "https://www.xmoj.tech";
const USER_SCRIPT_DEBUG_MODE_KEY = "UserScript-Setting-DebugMode";
const GITHUB_RELEASES_API = "https://api.github.com/repos/XMOJ-Script-dev/ELXMOJ/releases/latest";
const GITHUB_RELEASES_PAGE = "https://github.com/XMOJ-Script-dev/ELXMOJ/releases/latest";
const PRELOAD_PATH = path.join(__dirname, "preload.js");
const APP_ICON_PATH = path.join(
  __dirname,
  "..",
  "build",
  "icons",
  process.platform === "win32" ? "app.ico" : "app.png"
);

function getPlatformAssetKeywords() {
  if (process.platform === "win32") return { platform: "-win-", ext: ".exe" };
  if (process.platform === "darwin") return { platform: "-mac-", ext: ".zip" };
  if (process.platform === "linux") return { platform: "-linux-", ext: ".AppImage" };
  return null;
}

async function getAppUpdateUrl() {
  try {
    const text = await downloadText(GITHUB_RELEASES_API, { "User-Agent": "ELXMOJ-App" });
    const release = JSON.parse(text);
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const keywords = getPlatformAssetKeywords();
    if (keywords) {
      const platformMatches = assets.filter(
        (a) => {
          const name = String(a.name);
          return name.includes(keywords.platform) && name.endsWith(keywords.ext);
        }
      );
      let asset = null;
      if (platformMatches.length > 0) {
        if (process.platform === "win32") {
          // Prefer installer builds over portable when multiple Windows assets exist
          asset =
            platformMatches.find((a) => /nsis/i.test(String(a.name))) ||
            platformMatches.find((a) => /setup/i.test(String(a.name))) ||
            platformMatches.find((a) => /installer/i.test(String(a.name))) ||
            platformMatches.find((a) => /portable/i.test(String(a.name))) ||
            platformMatches[0];
        } else {
          asset = platformMatches[0];
        }
      }
      if (asset?.browser_download_url) {
        return asset.browser_download_url;
      }
    }
  } catch (error) {
    console.warn("[ELXMOJ] Failed to fetch latest release info:", error?.message || error);
  }
  return GITHUB_RELEASES_PAGE;
}

function getDebugModeFromChannel(channel) {
  return String(channel || "stable") === "preview";
}

function getChannelFromDebugMode(debugMode) {
  return debugMode ? "preview" : "stable";
}

function canReadMainWindowScriptSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const url = String(mainWindow.webContents.getURL() || "");
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return ["www.xmoj.tech", "xmoj.tech", "116.62.212.172"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function readScriptDebugModeFromMainWindow() {
  if (!canReadMainWindowScriptSettings()) {
    return null;
  }

  const code = `(() => {
    try {
      const value = localStorage.getItem(${JSON.stringify(USER_SCRIPT_DEBUG_MODE_KEY)});
      if (value === "true") return true;
      if (value === "false") return false;
      return null;
    } catch {
      return null;
    }
  })()`;

  try {
    return await mainWindow.webContents.executeJavaScript(code, true);
  } catch {
    return null;
  }
}

async function writeScriptDebugModeToMainWindow(debugMode) {
  if (!canReadMainWindowScriptSettings()) {
    return false;
  }

  const normalized = Boolean(debugMode);
  const code = `(() => {
    try {
      localStorage.setItem(${JSON.stringify(USER_SCRIPT_DEBUG_MODE_KEY)}, ${JSON.stringify(String(normalized))});
      return true;
    } catch {
      return false;
    }
  })()`;

  try {
    return await mainWindow.webContents.executeJavaScript(code, true);
  } catch {
    return false;
  }
}

async function syncChannelFromScriptDebugMode() {
  const debugMode = await readScriptDebugModeFromMainWindow();
  if (typeof debugMode !== "boolean") {
    return { synced: false, debugMode: null, channel: null };
  }

  const targetChannel = getChannelFromDebugMode(debugMode);
  const current = await getSettings();
  if (current.channel !== targetChannel) {
    await setSettings({ ...current, channel: targetChannel });
    return { synced: true, debugMode, channel: targetChannel };
  }

  return { synced: false, debugMode, channel: targetChannel };
}

function createAppWebPreferences() {
  return {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  };
}

function getPopupWindowOptions() {
  return {
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: "ELXMOJ",
    icon: APP_ICON_PATH,
    webPreferences: createAppWebPreferences()
  };
}

function attachBrowserShortcutBehavior(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  const webContents = targetWindow.webContents;
  if (!webContents || webContents.__ELXMOJ_SHORTCUTS_ATTACHED__) {
    return;
  }

  webContents.__ELXMOJ_SHORTCUTS_ATTACHED__ = true;

  webContents.on("before-input-event", (event, input) => {
    if (!input || input.type !== "keyDown") {
      return;
    }

    const key = String(input.key || "");
    const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
    const hasMeta = Boolean(input.meta);
    const hasCtrlOrMeta = Boolean(input.control || input.meta);
    const hasShift = Boolean(input.shift);
    const hasAlt = Boolean(input.alt);

    const isHardReload =
      (normalizedKey === "F5" && hasShift) ||
      (hasCtrlOrMeta && hasShift && normalizedKey === "r");
    if (isHardReload) {
      event.preventDefault();
      webContents.reloadIgnoringCache();
      return;
    }

    const isReload = normalizedKey === "F5" || (hasCtrlOrMeta && normalizedKey === "r");
    if (isReload) {
      event.preventDefault();
      webContents.reload();
      return;
    }

    const isGoBack =
      (hasAlt && normalizedKey === "ArrowLeft") ||
      normalizedKey === "BrowserBack" ||
      (hasMeta && !hasShift && normalizedKey === "[");
    if (isGoBack) {
      event.preventDefault();
      if (webContents.canGoBack()) {
        webContents.goBack();
      }
      return;
    }

    const isGoForward =
      (hasAlt && normalizedKey === "ArrowRight") ||
      normalizedKey === "BrowserForward" ||
      (hasMeta && !hasShift && normalizedKey === "]");
    if (isGoForward) {
      event.preventDefault();
      if (webContents.canGoForward()) {
        webContents.goForward();
      }
      return;
    }

    const isOpenSettings = hasCtrlOrMeta && normalizedKey === ",";
    if (isOpenSettings) {
      event.preventDefault();
      openSettingsWindow();
    }
  });
}

function attachPopupInjectionBehavior(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  attachBrowserShortcutBehavior(targetWindow);

  targetWindow.webContents.setWindowOpenHandler(({ url }) => {
    const nextUrl = String(url || "");

    let parsedTargetUrl;
    try {
      parsedTargetUrl = new URL(nextUrl);
    } catch {
      return { action: "deny" };
    }

    if (parsedTargetUrl.protocol !== "http:" && parsedTargetUrl.protocol !== "https:") {
      return { action: "deny" };
    }

    let trustedOrigin = "";
    try {
      trustedOrigin = new URL(XMOJ_HOME).origin;
    } catch {
      trustedOrigin = "";
    }

    const targetOrigin = parsedTargetUrl.origin;

    if (!trustedOrigin || targetOrigin !== trustedOrigin) {
      shell.openExternal(nextUrl).catch(() => {
        // Ignore failures to open external URLs
      });
      return { action: "deny" };
    }

    return {
      action: "allow",
      overrideBrowserWindowOptions: getPopupWindowOptions()
    };
  });

  targetWindow.webContents.on("did-create-window", (childWindow) => {
    attachPopupInjectionBehavior(childWindow);
  });
}

async function getPhpSessionIdFromCookieStore() {
  try {
    const cookies = await session.defaultSession.cookies.get({
      url: XMOJ_HOME,
      name: "PHPSESSID"
    });
    return cookies[0]?.value || "";
  } catch {
    return "";
  }
}

function isXmojScriptApiRequest(url) {
  return /^https:\/\/api\.xmoj-bbs\.(me|tech)\//i.test(String(url || ""));
}

async function patchApiAuthPayloadIfNeeded({ url, method, headers, body }) {
  if (!isXmojScriptApiRequest(url) || String(method || "").toUpperCase() !== "POST") {
    return body;
  }

  if (typeof body !== "string" || !body.trim()) {
    return body;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }

  if (!parsed || typeof parsed !== "object") {
    return body;
  }

  const realSessionId = await getPhpSessionIdFromCookieStore();
  if (!realSessionId) {
    return body;
  }

  if (!parsed.Authentication || typeof parsed.Authentication !== "object") {
    parsed.Authentication = {};
  }

  parsed.Authentication.SessionID = realSessionId;

  const userHeader = headers?.["XMOJ-UserID"] ?? headers?.["xmoj-userid"];
  if (!parsed.Authentication.Username && userHeader) {
    parsed.Authentication.Username = String(userHeader);
  }

  return JSON.stringify(parsed);
}

function getScriptBootstrapOptions() {
  return {
    getInitialScriptContent: async () => downloadText(getChannelUrl("stable"))
  };
}

function createMainMenu() {
  const openConsole = (mode = "bottom") => {
    const target = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!target || target.isDestroyed()) return;
    target.webContents.openDevTools({ mode });
  };

  const template = [
    {
      label: "ELXMOJ",
      submenu: [
        {
          label: "打开主页",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadURL(XMOJ_HOME);
            }
          }
        },
        { type: "separator" },
        {
          label: "设置",
          accelerator: "CmdOrCtrl+,",
          click: () => openSettingsWindow()
        },
        {
          label: "执行自检",
          click: () => runSelfCheck(true)
        },
        {
          label: "检查脚本更新",
          click: () => checkForScriptUpdate({ showNoUpdateDialog: true })
        },
        { type: "separator" },
        {
          label: "查看控制台",
          accelerator: "F12",
          click: () => openConsole("bottom")
        },
        {
          label: "分离控制台窗口",
          accelerator: "Ctrl+Shift+I",
          click: () => openConsole("detach")
        },
        {
          label: "关闭控制台",
          click: () => {
            const target = BrowserWindow.getFocusedWindow() || mainWindow;
            if (target && !target.isDestroyed()) {
              target.webContents.closeDevTools();
            }
          }
        },
        { type: "separator" },
        { role: "forceReload", label: "强制刷新" },
        { role: "reload", label: "刷新" },
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "查看",
      submenu: [
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "resetZoom", label: "重置缩放" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
        {
          label: "查看控制台",
          accelerator: "F12",
          click: () => openConsole("bottom")
        },
        {
          label: "切换开发者工具",
          role: "toggleDevTools"
        }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭窗口" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "下载最新版本",
          click: () => {
            shell.openExternal(getAppUpdateUrl()).catch(() => {
              // Ignore failures to open update page
            });
          }
        },
        { type: "separator" },
        {
          label: "关于 ELXMOJ",
          click: async () => {
            await dialog.showMessageBox(mainWindow || undefined, {
              type: "info",
              title: "关于 ELXMOJ",
              message: "ELXMOJ",
              detail: "Electron 封装的 XMOJ 增强启动器。\n支持 userscript 自动注入、更新检查和自检。"
            });
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function getSettings() {
  if (!settingsCache) {
    settingsCache = await loadSettings(app);
  }
  return settingsCache;
}

async function setSettings(nextSettings) {
  settingsCache = nextSettings;
  await saveSettings(app, settingsCache);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: "ELXMOJ",
    icon: APP_ICON_PATH,
    webPreferences: createAppWebPreferences()
  });

  attachBrowserShortcutBehavior(mainWindow);
  attachPopupInjectionBehavior(mainWindow);
  mainWindow.loadURL(XMOJ_HOME);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: "ELXMOJ 设置",
    icon: APP_ICON_PATH,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    webPreferences: createAppWebPreferences()
  });

  attachBrowserShortcutBehavior(settingsWindow);
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function buildSelfCheckReport({
  hasManagedScript,
  localVersion,
  hasVersionMeta,
  urlReachable,
  injectionReady,
  channel
}) {
  const lines = [
    "ELXMOJ 自检结果",
    "",
    `脚本文件: ${hasManagedScript ? "OK" : "失败"}`,
    `脚本版本元数据(@version): ${hasVersionMeta ? `OK (${localVersion})` : "缺失"}`,
    `更新源可访问: ${urlReachable ? "OK" : "失败"}`,
    `注入状态: ${injectionReady ? "已就绪" : "未就绪"}`,
    `更新通道: ${channel === "preview" ? "预览版" : "正式版"}`,
    `App 更新下载: ${getAppUpdateUrl()}`
  ];
  return lines.join("\n");
}

async function checkUpdateEndpoint(channel) {
  try {
    const text = await downloadText(getChannelUrl(channel));
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function runSelfCheck(showDialog = false) {
  await syncChannelFromScriptDebugMode();
  const settings = await getSettings();
  await ensureManagedScript(app, LOCAL_SCRIPT_PATH, getScriptBootstrapOptions());
  const localScript = await readManagedScript(app, LOCAL_SCRIPT_PATH, getScriptBootstrapOptions());
  const localVersion = extractVersion(localScript);
  const endpoint = await checkUpdateEndpoint(settings.channel);

  const report = buildSelfCheckReport({
    hasManagedScript: Boolean(localScript && localScript.length > 0),
    localVersion,
    hasVersionMeta: Boolean(localVersion),
    urlReachable: endpoint.ok,
    injectionReady: true,
    channel: settings.channel
  });

  lastCheckResult = {
    timestamp: Date.now(),
    report,
    endpointError: endpoint.ok ? "" : endpoint.error
  };

  if (showDialog && mainWindow) {
    await dialog.showMessageBox(mainWindow, {
      type: endpoint.ok ? "info" : "warning",
      title: "ELXMOJ 自检",
      message: report,
      detail: endpoint.ok ? "" : `更新源访问失败:\n${endpoint.error}`
    });
  }

  return lastCheckResult;
}

async function checkForScriptUpdate({ showNoUpdateDialog = false } = {}) {
  await syncChannelFromScriptDebugMode();
  const settings = await getSettings();
  await ensureManagedScript(app, LOCAL_SCRIPT_PATH, getScriptBootstrapOptions());

  const localScript = await readManagedScript(app, LOCAL_SCRIPT_PATH, getScriptBootstrapOptions());
  const currentVersion = extractVersion(localScript) || "0.0.0";

  let remoteScript;
  try {
    remoteScript = await downloadText(getChannelUrl(settings.channel));
  } catch (error) {
    if (showNoUpdateDialog && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "更新检查失败",
        message: "无法连接脚本更新源。",
        detail: String(error?.message || error)
      });
    }
    return { updated: false, reason: "download_failed" };
  }

  const remoteVersion = extractVersion(remoteScript) || "0.0.0";
  const remoteName = extractName(remoteScript);
  const shouldUpdate = isNewerVersion(currentVersion, remoteVersion);

  if (!shouldUpdate) {
    if (showNoUpdateDialog && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "已是最新",
        message: `${remoteName} 当前已是最新版本 (${currentVersion})`
      });
    }
    return { updated: false, reason: "already_latest", currentVersion, remoteVersion };
  }

  if (settings.skipVersionPrompt === remoteVersion) {
    return { updated: false, reason: "user_skipped", currentVersion, remoteVersion };
  }

  if (!mainWindow) {
    return { updated: false, reason: "no_window" };
  }

  const prompt = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "发现新版本脚本",
    message: `${remoteName} 有新版本可用: ${currentVersion} -> ${remoteVersion}`,
    detail: `来源: ${getChannelUrl(settings.channel)}\n是否更新并立即生效？`,
    buttons: ["立即更新", "跳过本次版本", "暂不更新"],
    cancelId: 2,
    defaultId: 0,
    noLink: true
  });

  if (prompt.response === 1) {
    const next = { ...settings, skipVersionPrompt: remoteVersion };
    await setSettings(next);
    return { updated: false, reason: "skip_this_version", currentVersion, remoteVersion };
  }

  if (prompt.response !== 0) {
    return { updated: false, reason: "cancelled", currentVersion, remoteVersion };
  }

  await writeManagedScript(app, remoteScript);
  const next = { ...settings, skipVersionPrompt: "" };
  await setSettings(next);

  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.webContents.reload();
  }

  return { updated: true, currentVersion, remoteVersion };
}

function isTrustedIpcSender(event) {
  try {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed()) {
      return false;
    }

    const ownerWindow = BrowserWindow.fromWebContents(sender);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      return false;
    }

    const url = event?.senderFrame?.url || sender.getURL() || "";
    if (!url) {
      return false;
    }

    if (url.startsWith("file://") || url.startsWith("app://")) {
      return true;
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const allowedHosts = new Set(["www.xmoj.tech", "xmoj.tech", "116.62.212.172"]);
    return allowedHosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

function registerIpcHandlers() {
  ipcMain.handle("elxmoj:get-settings", async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return getSettings();
  });

  ipcMain.handle("elxmoj:update-settings", async (event, patch) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    const current = await getSettings();
    const next = { ...current, ...patch };
    await setSettings(next);

    if (Object.prototype.hasOwnProperty.call(patch || {}, "channel")) {
      await writeScriptDebugModeToMainWindow(getDebugModeFromChannel(next.channel));
    }

    return next;
  });

  ipcMain.handle("elxmoj:get-script-debug-mode", async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return readScriptDebugModeFromMainWindow();
  });

  ipcMain.handle("elxmoj:set-script-debug-mode", async (event, enabled) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }

    const debugMode = Boolean(enabled);
    const channel = getChannelFromDebugMode(debugMode);
    const current = await getSettings();
    if (current.channel !== channel) {
      await setSettings({ ...current, channel });
    }

    const updated = await writeScriptDebugModeToMainWindow(debugMode);
    return { ok: updated, debugMode, channel };
  });

  ipcMain.handle("elxmoj:sync-channel-from-script-debug", async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return syncChannelFromScriptDebugMode();
  });

  ipcMain.handle("elxmoj:update-channel-by-script-debug", async (event, enabled) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    const debugMode = Boolean(enabled);
    const channel = getChannelFromDebugMode(debugMode);
    const current = await getSettings();
    if (current.channel !== channel) {
      await setSettings({ ...current, channel });
      return { updated: true, channel, debugMode };
    }
    return { updated: false, channel, debugMode };
  });

  ipcMain.handle("elxmoj:get-script-payload", async () => {
    const scriptText = await readManagedScript(app, LOCAL_SCRIPT_PATH, getScriptBootstrapOptions());
    return {
      name: extractName(scriptText),
      version: extractVersion(scriptText),
      requires: extractRequires(scriptText),
      scriptText
    };
  });

  ipcMain.handle("elxmoj:check-update", async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return checkForScriptUpdate({ showNoUpdateDialog: true });
  });
  ipcMain.handle("elxmoj:run-self-check", async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return runSelfCheck(true);
  });
  ipcMain.handle("elxmoj:get-last-self-check", async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return lastCheckResult;
  });

  ipcMain.handle("elxmoj:get-app-update-url", async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    return await getAppUpdateUrl();
  });

  ipcMain.handle("elxmoj:open-app-update-page", async (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }
    const url = await getAppUpdateUrl();
    await shell.openExternal(url);
    return { ok: true, url };
  });

  ipcMain.handle("elxmoj:get-phpsessid", async () => {
    const value = await getPhpSessionIdFromCookieStore();
    return value || "";
  });

  ipcMain.handle("elxmoj:gm-xhr", async (event, request) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error("Unauthorized IPC sender");
    }

    const req = request || {};
    const url = String(req.url || "");
    if (!url) {
      return {
        ok: false,
        error: "GM_xmlhttpRequest requires a non-empty url"
      };
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        ok: false,
        error: "GM_xmlhttpRequest requires a valid URL"
      };
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol) || !ALLOWED_GM_XHR_HOSTS.has(parsedUrl.hostname)) {
      return {
        ok: false,
        error: "GM_xmlhttpRequest URL is not allowed"
      };
    }

    const method = String(req.method || "GET").toUpperCase();
    const headers = req.headers && typeof req.headers === "object" ? req.headers : {};
    const timeout = Number.isFinite(req.timeout) ? Number(req.timeout) : 20000;
    const body = await patchApiAuthPayloadIfNeeded({
      url,
      method,
      headers,
      body: req.data
    });

    return new Promise((resolve) => {

      const client = net.request({
        method,
        url,
        session: session.defaultSession
      });

      for (const [k, v] of Object.entries(headers)) {
        if (v !== undefined && v !== null) {
          client.setHeader(k, String(v));
        }
      }

      const timer = setTimeout(() => {
        try {
          client.abort();
        } catch {
          // ignore abort errors
        }
        resolve({
          ok: false,
          error: `Timeout after ${timeout}ms`
        });
      }, timeout);

      client.on("response", (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({
            ok: true,
            status: res.statusCode,
            statusText: res.statusMessage,
            responseText: Buffer.concat(chunks).toString("utf8"),
            finalUrl: url,
            headers: res.headers || {}
          });
        });
      });

      client.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          error: String(error?.message || error)
        });
      });

      if (body !== undefined && body !== null) {
        if (typeof body === "string" || Buffer.isBuffer(body)) {
          client.write(body);
        } else {
          client.write(String(body));
        }
      }

      client.end();
    });
  });

  ipcMain.handle("elxmoj:gm-cookie-list", async (_event, details) => {
    const input = details && typeof details === "object" ? details : {};
    const query = {
      url: typeof input.url === "string" ? input.url : XMOJ_HOME,
      name: typeof input.name === "string" ? input.name : undefined,
      domain: typeof input.domain === "string" ? input.domain : undefined,
      path: typeof input.path === "string" ? input.path : undefined,
      secure: typeof input.secure === "boolean" ? input.secure : undefined,
      session: typeof input.session === "boolean" ? input.session : undefined,
      httpOnly: typeof input.httpOnly === "boolean" ? input.httpOnly : undefined
    };

    try {
      const cookies = await session.defaultSession.cookies.get(query);
      return cookies;
    } catch {
      return [];
    }
  });

  ipcMain.handle("elxmoj:gm-cookie-set", async (_event, details) => {
    const input = details && typeof details === "object" ? details : {};
    const cookie = {
      url: typeof input.url === "string" ? input.url : XMOJ_HOME,
      name: String(input.name || ""),
      value: String(input.value || ""),
      domain: typeof input.domain === "string" ? input.domain : undefined,
      path: typeof input.path === "string" ? input.path : "/",
      secure: typeof input.secure === "boolean" ? input.secure : undefined,
      httpOnly: typeof input.httpOnly === "boolean" ? input.httpOnly : undefined,
      sameSite: typeof input.sameSite === "string" ? input.sameSite : undefined,
      expirationDate: typeof input.expirationDate === "number" ? input.expirationDate : undefined
    };

    if (!cookie.name) {
      return { success: false, error: "GM_cookie.set requires cookie name" };
    }

    try {
      await session.defaultSession.cookies.set(cookie);
      return { success: true };
    } catch (error) {
      const message = String(error?.message || error);
      const isHttpOnlyConflict = message.includes("EXCLUDE_OVERWRITE_HTTP_ONLY");

      return {
        success: false,
        ignored: isHttpOnlyConflict,
        error: message,
        code: isHttpOnlyConflict ? "EXCLUDE_OVERWRITE_HTTP_ONLY" : "SET_FAILED"
      };
    }
  });

  ipcMain.handle("elxmoj:gm-cookie-delete", async (_event, details) => {
    const input = details && typeof details === "object" ? details : {};
    const targetUrl = typeof input.url === "string" ? input.url : XMOJ_HOME;
    const targetName = String(input.name || "");

    if (!targetName) {
      return { success: false, error: "GM_cookie.delete requires cookie name" };
    }

    try {
      await session.defaultSession.cookies.remove(targetUrl, targetName);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: String(error?.message || error),
        code: "DELETE_FAILED"
      };
    }
  });
}

async function bootstrap() {
  createMainMenu();
  registerIpcHandlers();
  createMainWindow();

  const settings = await getSettings();
  await syncChannelFromScriptDebugMode();
  await ensureManagedScript(app, LOCAL_SCRIPT_PATH, getScriptBootstrapOptions());
  await runSelfCheck(process.argv.includes("--self-check"));

  if (settings.checkUpdateOnStartup) {
    await checkForScriptUpdate({ showNoUpdateDialog: false });
  }
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
