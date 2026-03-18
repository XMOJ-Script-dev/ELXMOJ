'use strict';

/**
 * ELXMOJ Preload Script
 *
 * Runs in an isolated privileged context and:
 *  1. Exposes `electronAPI` to the renderer via contextBridge.
 *  2. Syncs electron-store settings → page localStorage BEFORE the script runs,
 *     so the XMOJ script always starts with the user's saved preferences.
 *  3. Injects a Greasemonkey API (GM_*) compatibility shim.
 *  4. Loads the XMOJ enhancement script from the local disk cache (fast launch),
 *     then checks for a newer version in the background and prompts the user.
 */

const { contextBridge, ipcRenderer } = require('electron');

// ─── Expose Electron APIs to the renderer ────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
    /** Write text to the system clipboard */
    clipboardWriteText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
    /** Read text from the system clipboard */
    clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
    /** Show a native OS notification */
    showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
    /** Get session cookies matching a filter object */
    cookiesGet: (filter) => ipcRenderer.invoke('cookies-get', filter),
    /** Set a session cookie */
    cookiesSet: (details) => ipcRenderer.invoke('cookies-set', details),
    /** Open a URL in the default system browser */
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    /** Get the Electron app version string */
    getVersion: () => ipcRenderer.invoke('get-version'),
    /** Get all persisted settings */
    settingsGetAll: () => ipcRenderer.invoke('settings-get-all'),
    /** Persist a single setting */
    settingsSet: (key, value) => ipcRenderer.invoke('settings-set', key, value),
    /** Get a single persisted setting */
    settingsGet: (key) => ipcRenderer.invoke('settings-get', key),
    /** Navigate the main window to a URL */
    navigate: (url) => ipcRenderer.invoke('navigate', url),
    /** Trigger a manual check for application (Electron) updates */
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    /** Read the cached XMOJ script from disk */
    scriptCacheRead: (channel) => ipcRenderer.invoke('script-cache-read', channel),
    /** Write a new XMOJ script version to the disk cache */
    scriptCacheWrite: (channel, script, version) =>
        ipcRenderer.invoke('script-cache-write', channel, script, version),
    /** Show the native "new script version available" dialog */
    showScriptUpdateDialog: (opts) => ipcRenderer.invoke('show-script-update-dialog', opts),
});

// sessionStorage key used to ensure the background update check runs at most
// once per browser session (survives page navigations but not app restarts).
const UPDATE_CHECK_SESSION_KEY = 'elxmoj-script-update-checked';

// ─── Main injection entry point ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Write all persisted settings into localStorage BEFORE the script runs.
    await syncSettingsToLocalStorage();
    // 2. Inject the Greasemonkey API shim into the page context.
    injectGMShim();
    // 3. Load the XMOJ script from disk cache (or network if no cache yet).
    await injectXMOJScript();
});

// ─── Settings sync ────────────────────────────────────────────────────────────
/**
 * Read every setting from electron-store and write it into the page's
 * localStorage as `UserScript-Setting-<key>` so the XMOJ script picks them
 * up on first access instead of falling back to hardcoded defaults.
 */
async function syncSettingsToLocalStorage() {
    try {
        const settings = await ipcRenderer.invoke('settings-get-all');
        if (!settings || typeof settings !== 'object') return;
        for (const [key, value] of Object.entries(settings)) {
            // XMOJ script reads these as raw strings.
            localStorage.setItem('UserScript-Setting-' + key, String(value));
        }
    } catch (e) {
        console.warn('[ELXMOJ] Failed to sync settings to localStorage:', e.message);
    }
}

// ─── GM shim ──────────────────────────────────────────────────────────────────
function injectGMShim() {
    const script = document.createElement('script');
    script.textContent = buildGMShim();
    (document.head || document.documentElement).appendChild(script);
}

function buildGMShim() {
    return `
(function () {
    'use strict';

    // ── GM_info ───────────────────────────────────────────────────────────
    window.GM_info = {
        script: {
            name: 'XMOJ',
            version: '3.3.0',
            description: 'XMOJ增强脚本 (ELXMOJ)',
            author: '@XMOJ-Script-dev, @langningchen and the community',
        },
        scriptHandler: 'ELXMOJ',
        version: '1.0.0',
    };

    // ── GM_setValue / GM_getValue ─────────────────────────────────────────
    window.GM_setValue = (key, value) => {
        try { localStorage.setItem('GM_' + key, JSON.stringify(value)); } catch (e) { console.warn('GM_setValue error', e); }
    };
    window.GM_getValue = (key, defaultValue) => {
        try {
            const raw = localStorage.getItem('GM_' + key);
            return raw !== null ? JSON.parse(raw) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    };
    window.GM_deleteValue = (key) => {
        try { localStorage.removeItem('GM_' + key); } catch (e) {}
    };

    // ── GM_setClipboard ───────────────────────────────────────────────────
    window.GM_setClipboard = (text, _type) => {
        if (window.electronAPI) {
            window.electronAPI.clipboardWriteText(String(text));
        } else {
            navigator.clipboard.writeText(String(text)).catch(() => {});
        }
    };

    // ── GM_xmlhttpRequest ─────────────────────────────────────────────────
    window.GM_xmlhttpRequest = (details) => {
        const controller = new AbortController();
        const { signal } = controller;

        const headers = {};
        if (details.headers) {
            Object.assign(headers, details.headers);
        }

        fetch(details.url, {
            method: (details.method || 'GET').toUpperCase(),
            headers,
            body: details.data || undefined,
            signal,
            credentials: 'include',
        })
            .then(async (response) => {
                const responseText = await response.text();
                const result = {
                    status: response.status,
                    statusText: response.statusText,
                    responseText,
                    responseHeaders: [...response.headers.entries()]
                        .map(([k, v]) => k + ': ' + v)
                        .join('\\r\\n'),
                    finalUrl: response.url,
                    readyState: 4,
                };
                if (details.onload) details.onload(result);
            })
            .catch((err) => {
                if (details.onerror) details.onerror({ error: err });
            });

        return { abort: () => controller.abort() };
    };

    // ── GM.cookie ─────────────────────────────────────────────────────────
    const gmCookie = {
        get: (filter, callback) => {
            if (window.electronAPI) {
                window.electronAPI.cookiesGet(filter).then((cookies) => {
                    if (callback) callback(cookies);
                });
            } else {
                if (callback) callback([]);
            }
        },
        set: (details) => {
            if (window.electronAPI) {
                return window.electronAPI.cookiesSet({
                    url: 'https://www.xmoj.tech',
                    name: details.name || '',
                    value: details.value || '',
                    path: details.path || '/',
                    secure: false,
                    httpOnly: false,
                });
            }
            return Promise.resolve();
        },
        delete: (_details) => Promise.resolve(),
        list: (filter, callback) => {
            if (window.electronAPI) {
                window.electronAPI.cookiesGet(filter || {}).then((cookies) => {
                    if (callback) callback(cookies);
                });
            }
        },
    };
    window.GM = window.GM || {};
    window.GM.cookie = gmCookie;

    // ── GM_registerMenuCommand ────────────────────────────────────────────
    window._gmMenuCommands = window._gmMenuCommands || [];
    window.GM_registerMenuCommand = (name, fn, _accessKey) => {
        window._gmMenuCommands.push({ name, fn });
        console.log('[ELXMOJ] Registered menu command:', name);
    };

    // ── unsafeWindow ──────────────────────────────────────────────────────
    window.unsafeWindow = window;

    console.log('[ELXMOJ] GM shim loaded');
})();
    `;
}

// ─── Script channel helpers ───────────────────────────────────────────────────
/**
 * Determine the download channel ('prod' or 'dev') from the DebugMode setting.
 * syncSettingsToLocalStorage() has already run at this point, so localStorage
 * holds the electron-store value.
 */
function getScriptChannel() {
    return localStorage.getItem('UserScript-Setting-DebugMode') === 'true' ? 'dev' : 'prod';
}

function getScriptUrl(channel) {
    return channel === 'dev'
        ? 'https://dev.xmoj-bbs.me/XMOJ.user.js'
        : 'https://xmoj-bbs.me/XMOJ.user.js';
}

// ─── Version helpers ──────────────────────────────────────────────────────────
/** Extract the @version value from a userscript header. */
function parseScriptVersion(text) {
    const m = text.match(/\/\/\s*@version\s+(\S+)/);
    return m ? m[1].trim() : null;
}

/**
 * Return true if semver string `b` is strictly newer than `a`.
 * If `a` is absent (no cached version), any `b` is considered newer.
 */
function isNewer(a, b) {
    if (!a) return !!b;
    if (!b) return false;
    const nums = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const [ap, bp] = [nums(a), nums(b)];
    const len = Math.max(ap.length, bp.length);
    for (let i = 0; i < len; i++) {
        if ((bp[i] || 0) > (ap[i] || 0)) return true;
        if ((bp[i] || 0) < (ap[i] || 0)) return false;
    }
    return false;
}

// ─── Script injection ─────────────────────────────────────────────────────────
/** Append a <script> tag with the given source text to the document. */
function injectScriptText(scriptText) {
    const el = document.createElement('script');
    el.textContent = scriptText;
    (document.head || document.documentElement).appendChild(el);
}

/**
 * Remove the ==UserScript== / ==/UserScript== metadata block so the
 * remaining code can be injected as a plain <script> tag.
 */
function stripUserScriptHeader(text) {
    const end = text.indexOf('// ==/UserScript==');
    if (end !== -1) return text.slice(end + '// ==/UserScript=='.length);
    return text;
}

/**
 * Main script loading function (cache-first strategy):
 *
 *  • If a disk-cached copy exists → inject it immediately (no network wait),
 *    then background-check for a newer version once per session.
 *  • If no cache exists → fetch from xmoj-bbs.me, save to disk, then inject.
 */
async function injectXMOJScript() {
    const channel = getScriptChannel();
    const scriptUrl = getScriptUrl(channel);

    // ── Try disk cache first ─────────────────────────────────────────────────
    const cached = await ipcRenderer.invoke('script-cache-read', channel);

    if (cached && cached.script) {
        injectScriptText(cached.script);
        console.log(
            `[ELXMOJ] Injected from cache (channel=${channel}, version=${cached.version || 'unknown'})`
        );

        // Background update check — at most once per app session.
        if (!sessionStorage.getItem(UPDATE_CHECK_SESSION_KEY)) {
            sessionStorage.setItem(UPDATE_CHECK_SESSION_KEY, '1');
            // Defer so the current page render is not blocked.
            setTimeout(() => backgroundUpdateCheck(channel, scriptUrl, cached.version), 0);
        }
        return;
    }

    // ── No cache: fetch now, save, inject ────────────────────────────────────
    console.log(`[ELXMOJ] No local cache — fetching from ${scriptUrl} …`);
    try {
        const response = await fetch(scriptUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.text();
        const version = parseScriptVersion(raw);
        const scriptText = stripUserScriptHeader(raw);
        await ipcRenderer.invoke('script-cache-write', channel, scriptText, version);
        injectScriptText(scriptText);
        sessionStorage.setItem(UPDATE_CHECK_SESSION_KEY, '1');
        console.log(`[ELXMOJ] Fetched and cached (version=${version || 'unknown'})`);
    } catch (e) {
        console.error('[ELXMOJ] Failed to fetch XMOJ script:', e.message);
    }
}

/**
 * Fetch the latest script from xmoj-bbs.me and compare its version against
 * the currently running cached copy. If a newer version is available, show a
 * native dialog. If the user accepts, persist the new script and reload.
 */
async function backgroundUpdateCheck(channel, scriptUrl, cachedVersion) {
    try {
        const response = await fetch(scriptUrl, { cache: 'no-store' });
        if (!response.ok) return;
        const raw = await response.text();
        const newVersion = parseScriptVersion(raw);

        if (!isNewer(cachedVersion, newVersion)) {
            console.log(
                `[ELXMOJ] Script up to date (version=${cachedVersion || newVersion || 'unknown'})`
            );
            return;
        }

        console.log(`[ELXMOJ] New version available: ${cachedVersion} → ${newVersion}`);

        const accepted = await ipcRenderer.invoke('show-script-update-dialog', {
            channel,
            oldVersion: cachedVersion,
            newVersion,
        });

        if (accepted) {
            const scriptText = stripUserScriptHeader(raw);
            await ipcRenderer.invoke('script-cache-write', channel, scriptText, newVersion);
            console.log(`[ELXMOJ] Script updated to ${newVersion}. Reloading…`);
            await ipcRenderer.invoke('script-reload');
        }
    } catch (e) {
        console.warn('[ELXMOJ] Background update check failed:', e.message);
    }
}
