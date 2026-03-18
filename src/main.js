'use strict';

const {
    app,
    BrowserWindow,
    Menu,
    Tray,
    Notification,
    clipboard,
    ipcMain,
    shell,
    session,
    dialog,
    nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Use dynamic import for the ESM-only electron-store
let Store;
let store;

async function loadStore() {
    const { default: ElectronStore } = await import('electron-store');
    Store = ElectronStore;
    store = new Store({
        defaults: {
            windowBounds: { width: 1280, height: 800 },
            windowMaximized: false,
            // XMOJ Script feature toggles (mirrors localStorage UserScript-Setting-*)
            settings: {
                Discussion: true,
                MoreSTD: true,
                ApplyData: true,
                AutoCheat: true,
                Rating: true,
                AutoRefresh: true,
                AutoCountdown: true,
                DownloadPlayback: true,
                ImproveACRate: true,
                AutoO2: false,
                NewTopBar: true,
                NewBootstrap: true,
                ResetType: true,
                AddColorText: true,
                AddUnits: true,
                Theme: 'auto',
                AddAnimation: true,
                ReplaceYN: true,
                RemoveAlerts: true,
                Translate: true,
                ReplaceLinks: true,
                RemoveUseless: true,
                ReplaceXM: false,
                MonochromeUI: false,
                AutoLogin: true,
                SavePassword: true,
                CopySamples: true,
                RefreshSolution: true,
                CopyMD: true,
                ProblemSwitcher: true,
                OpenAllProblem: true,
                IOFile: true,
                CompileError: true,
                ExportACCode: true,
                LoginFailed: true,
                NewDownload: true,
                CompareSource: true,
                BBSPopup: true,
                MessagePopup: true,
                DebugMode: false,
                SuperDebug: false,
            },
        },
    });
}

let mainWindow = null;
let tray = null;
let settingsWindow = null;

const XMOJ_URL = 'https://www.xmoj.tech/';

// ─── Auto-updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater() {
    // Don't check for updates during development
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        console.log('[Updater] Checking for update…');
    });

    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '有新版本可用',
            message: `小明的OJ ${info.version} 已发布`,
            detail: `当前版本：${app.getVersion()}\n新版本：${info.version}\n\n是否立即下载？`,
            buttons: ['下载更新', '稍后提醒'],
            defaultId: 0,
            cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
    });

    autoUpdater.on('update-not-available', () => {
        console.log('[Updater] Already up to date.');
    });

    autoUpdater.on('download-progress', (progress) => {
        const percent = Math.round(progress.percent);
        mainWindow && mainWindow.setProgressBar(percent / 100);
        console.log(`[Updater] Download progress: ${percent}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
        mainWindow && mainWindow.setProgressBar(-1);
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '更新已下载',
            message: `小明的OJ ${info.version} 已下载完成`,
            detail: '点击"立即重启"以安装更新，或在下次启动时自动安装。',
            buttons: ['立即重启', '稍后安装'],
            defaultId: 0,
            cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    });

    autoUpdater.on('error', (err) => {
        console.error('[Updater] Error:', err);
        mainWindow && mainWindow.setProgressBar(-1);
    });

    // Check for updates 5 seconds after launch, then every 4 hours
    setTimeout(() => autoUpdater.checkForUpdates(), 5000);
    setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}

// IPC: manual update check triggered from menu/settings
ipcMain.handle('check-for-updates', () => {
    if (!app.isPackaged) {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '开发模式',
            message: '自动更新在开发模式下不可用。',
            buttons: ['OK'],
        });
        return;
    }
    autoUpdater.checkForUpdates();
});


function createTray() {
    // Use a minimal 16x16 transparent icon as placeholder
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: '显示 小明的OJ', click: () => { mainWindow && mainWindow.show(); } },
        { label: '设置', click: openSettingsWindow },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
    ]);
    tray.setToolTip('小明的OJ');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => { mainWindow && mainWindow.show(); });
}

function buildMenu() {
    const template = [
        {
            label: '文件',
            submenu: [
                {
                    label: '主页',
                    accelerator: 'CmdOrCtrl+H',
                    click: () => { mainWindow && mainWindow.loadURL(XMOJ_URL); },
                },
                { type: 'separator' },
                {
                    label: '设置',
                    accelerator: 'CmdOrCtrl+,',
                    click: openSettingsWindow,
                },
                { type: 'separator' },
                { label: '退出', role: 'quit' },
            ],
        },
        {
            label: '编辑',
            submenu: [
                { label: '撤销', role: 'undo' },
                { label: '重做', role: 'redo' },
                { type: 'separator' },
                { label: '剪切', role: 'cut' },
                { label: '复制', role: 'copy' },
                { label: '粘贴', role: 'paste' },
                { label: '全选', role: 'selectAll' },
            ],
        },
        {
            label: '视图',
            submenu: [
                { label: '刷新', role: 'reload' },
                { label: '强制刷新', role: 'forceReload' },
                { label: '开发者工具', role: 'toggleDevTools' },
                { type: 'separator' },
                { label: '重置缩放', role: 'resetZoom' },
                { label: '放大', role: 'zoomIn' },
                { label: '缩小', role: 'zoomOut' },
                { type: 'separator' },
                { label: '全屏', role: 'togglefullscreen' },
            ],
        },
        {
            label: '导航',
            submenu: [
                {
                    label: '后退',
                    accelerator: 'Alt+Left',
                    click: () => { mainWindow && mainWindow.webContents.goBack(); },
                },
                {
                    label: '前进',
                    accelerator: 'Alt+Right',
                    click: () => { mainWindow && mainWindow.webContents.goForward(); },
                },
                { type: 'separator' },
                {
                    label: '题库',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/problemset.php'); },
                },
                {
                    label: '提交记录',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/status.php'); },
                },
                {
                    label: '比赛',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/contest.php'); },
                },
                {
                    label: '讨论',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/discuss3/discuss.php'); },
                },
                {
                    label: '下载',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/downloads.php'); },
                },
            ],
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: 'XMOJ-Script 源码',
                    click: () => { shell.openExternal('https://github.com/XMOJ-Script-dev/XMOJ-Script'); },
                },
                {
                    label: 'ELXMOJ 源码',
                    click: () => { shell.openExternal('https://github.com/XMOJ-Script-dev/ELXMOJ'); },
                },
                {
                    label: '反馈问题',
                    click: () => { shell.openExternal('https://github.com/XMOJ-Script-dev/ELXMOJ/issues'); },
                },
                { type: 'separator' },
                {
                    label: '检查更新…',
                    click: () => {
                        if (!app.isPackaged) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'info',
                                title: '开发模式',
                                message: '自动更新在开发模式下不可用。',
                                buttons: ['确定'],
                            });
                        } else {
                            autoUpdater.checkForUpdates();
                        }
                    },
                },
                { type: 'separator' },
                {
                    label: '关于 小明的OJ',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '关于 小明的OJ',
                            message: '小明的OJ (ELXMOJ)',
                            detail: `版本：${app.getVersion()}\nElectron：${process.versions.electron}\nNode.js：${process.versions.node}\n\n小明的OJ 桌面客户端，由 Electron 驱动。\n基于 XMOJ-Script，由 XMOJ-Script-dev 团队开发。`,
                            buttons: ['确定'],
                        });
                    },
                },
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

async function createWindow() {
    const bounds = store.get('windowBounds');
    const maximized = store.get('windowMaximized');

    mainWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        minWidth: 800,
        minHeight: 600,
        title: '小明的OJ',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: false,
        },
        show: false,
    });

    if (maximized) {
        mainWindow.maximize();
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Persist window size
    mainWindow.on('resize', () => {
        if (!mainWindow.isMaximized()) {
            store.set('windowBounds', mainWindow.getBounds());
        }
    });
    mainWindow.on('maximize', () => store.set('windowMaximized', true));
    mainWindow.on('unmaximize', () => store.set('windowMaximized', false));

    // Update title with page title
    mainWindow.webContents.on('page-title-updated', (event, title) => {
        mainWindow.setTitle(title ? `${title} — 小明的OJ` : '小明的OJ');
    });

    // Open external links in the system browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const parsed = new URL(url);
            const isXmoj = (parsed.protocol === 'https:' || parsed.protocol === 'http:')
                && parsed.hostname === 'www.xmoj.tech';
            if (!isXmoj) {
                shell.openExternal(url);
                return { action: 'deny' };
            }
        } catch (_) {
            // Unparseable URL — deny and open externally
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    await mainWindow.loadURL(XMOJ_URL);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }
    settingsWindow = new BrowserWindow({
        width: 700,
        height: 620,
        title: '小明的OJ — 设置',
        parent: mainWindow || undefined,
        modal: false,
        resizable: true,
        minimizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'settings', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    settingsWindow.setMenu(null);
    settingsWindow.loadFile(path.join(__dirname, 'settings', 'index.html'));
    settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// Clipboard write
ipcMain.handle('clipboard-write-text', (_event, text) => {
    clipboard.writeText(text);
});

// Clipboard read
ipcMain.handle('clipboard-read-text', () => clipboard.readText());

// Native notification
ipcMain.handle('show-notification', (_event, { title, body, icon }) => {
    if (Notification.isSupported()) {
        const n = new Notification({ title, body, icon });
        n.show();
    }
});

// Session cookie get (used by XMOJ script to read PHPSESSID)
ipcMain.handle('cookies-get', async (_event, filter) => {
    const ses = session.defaultSession;
    return await ses.cookies.get(filter);
});

// Session cookie set (used by XMOJ script to set PHPSESSID)
ipcMain.handle('cookies-set', async (_event, details) => {
    const ses = session.defaultSession;
    await ses.cookies.set(details);
});

// Open external URL
ipcMain.handle('open-external', (_event, url) => {
    shell.openExternal(url);
});

// Get app version
ipcMain.handle('get-version', () => app.getVersion());

// ─── Settings IPC ────────────────────────────────────────────────────────────

ipcMain.handle('settings-get-all', () => store.get('settings'));

ipcMain.handle('settings-set', (_event, key, value) => {
    store.set(`settings.${key}`, value);
    // Sync to the main window's localStorage via executeJavaScript
    if (mainWindow && !mainWindow.isDestroyed()) {
        const safeKey = key.replace(/['"\\]/g, '');
        const safeValue = typeof value === 'string' ? value.replace(/['"\\]/g, '') : value;
        const jsValue = typeof safeValue === 'boolean' ? String(safeValue) : `"${safeValue}"`;
        mainWindow.webContents.executeJavaScript(
            `localStorage.setItem("UserScript-Setting-${safeKey}", ${jsValue});`
        ).catch(() => {});
    }
});

ipcMain.handle('settings-get', (_event, key) => store.get(`settings.${key}`));

// Navigate main window
ipcMain.handle('navigate', (_event, url) => {
    mainWindow && mainWindow.loadURL(url);
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    await loadStore();
    buildMenu();
    createTray();
    await createWindow();
    setupAutoUpdater();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else if (mainWindow) {
            mainWindow.show();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (tray) tray.destroy();
});
