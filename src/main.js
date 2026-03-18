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

function createTray() {
    // Use a minimal 16x16 transparent icon as placeholder
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show XMOJ', click: () => { mainWindow && mainWindow.show(); } },
        { label: 'Settings', click: openSettingsWindow },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setToolTip('Electro-XMOJ');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => { mainWindow && mainWindow.show(); });
}

function buildMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Home',
                    accelerator: 'CmdOrCtrl+H',
                    click: () => { mainWindow && mainWindow.loadURL(XMOJ_URL); },
                },
                { type: 'separator' },
                {
                    label: 'Settings',
                    accelerator: 'CmdOrCtrl+,',
                    click: openSettingsWindow,
                },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Navigate',
            submenu: [
                {
                    label: 'Back',
                    accelerator: 'Alt+Left',
                    click: () => { mainWindow && mainWindow.webContents.goBack(); },
                },
                {
                    label: 'Forward',
                    accelerator: 'Alt+Right',
                    click: () => { mainWindow && mainWindow.webContents.goForward(); },
                },
                { type: 'separator' },
                {
                    label: 'Problem Set',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/problemset.php'); },
                },
                {
                    label: 'Status',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/status.php'); },
                },
                {
                    label: 'Contests',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/contest.php'); },
                },
                {
                    label: 'Discussion',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/discuss3/discuss.php'); },
                },
                {
                    label: 'Downloads',
                    click: () => { mainWindow && mainWindow.loadURL('https://www.xmoj.tech/downloads.php'); },
                },
            ],
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'XMOJ-Script GitHub',
                    click: () => { shell.openExternal('https://github.com/XMOJ-Script-dev/XMOJ-Script'); },
                },
                {
                    label: 'Electro-XMOJ GitHub',
                    click: () => { shell.openExternal('https://github.com/XMOJ-Script-dev/Electro-XMOJ'); },
                },
                {
                    label: 'Report Issue',
                    click: () => { shell.openExternal('https://github.com/XMOJ-Script-dev/Electro-XMOJ/issues'); },
                },
                { type: 'separator' },
                {
                    label: `About Electro-XMOJ`,
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About Electro-XMOJ',
                            message: 'Electro-XMOJ',
                            detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\n\nXMOJ desktop application powered by Electron.\nBased on XMOJ-Script by XMOJ-Script-dev.`,
                            buttons: ['OK'],
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
        title: 'Electro-XMOJ',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // Allow running content scripts that access cross-origin resources
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
        mainWindow.setTitle(title ? `${title} — Electro-XMOJ` : 'Electro-XMOJ');
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
        title: 'Electro-XMOJ Settings',
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
