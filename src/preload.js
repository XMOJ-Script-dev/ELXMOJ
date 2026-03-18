'use strict';

/**
 * Electro-XMOJ Preload Script
 *
 * This script runs in a privileged context and:
 *  1. Exposes an `electronAPI` object to the page via contextBridge.
 *  2. Injects a compatibility shim for the GM_* / GM.* Greasemonkey APIs.
 *  3. Fetches and injects the latest XMOJ.user.js enhancement script from GitHub.
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
    /** Trigger a manual check for application updates */
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
});

// ─── Inject XMOJ enhancement script after DOM is ready ───────────────────────
window.addEventListener('DOMContentLoaded', () => {
    injectGMShim();
    injectXMOJScript();
});

/**
 * Inject a Greasemonkey / Tampermonkey compatibility shim so that the
 * unmodified XMOJ.user.js can run inside Electron without a userscript manager.
 */
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
            description: 'XMOJ增强脚本 (Electro-XMOJ)',
            author: '@XMOJ-Script-dev, @langningchen and the community',
        },
        scriptHandler: 'Electro-XMOJ',
        version: '1.0.0',
    };

    // ── GM_setValue / GM_getValue ─────────────────────────────────────────
    // The XMOJ script already uses localStorage for most settings, but we
    // provide these shims in case they are called directly.
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
    // Replace with the native fetch API. Electron relaxes CORS for the
    // renderer process so cross-origin requests work without special grants.
    window.GM_xmlhttpRequest = (details) => {
        const controller = new AbortController();
        const { signal } = controller;

        const headers = {};
        if (details.headers) {
            Object.assign(headers, details.headers);
        }

        let bodyData = details.data || undefined;

        fetch(details.url, {
            method: (details.method || 'GET').toUpperCase(),
            headers,
            body: bodyData,
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
    // The XMOJ script uses GM.cookie.set() to reset PHPSESSID when missing.
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
                // Build a proper cookie details object for Electron
                const cookieDetails = {
                    url: 'https://www.xmoj.tech',
                    name: details.name || '',
                    value: details.value || '',
                    path: details.path || '/',
                    secure: false,
                    httpOnly: false,
                };
                return window.electronAPI.cookiesSet(cookieDetails);
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
    // In Electron the native application menu is built in main.js.
    // Commands registered here are stored and logged for diagnostics.
    window._gmMenuCommands = window._gmMenuCommands || [];
    window.GM_registerMenuCommand = (name, fn, _accessKey) => {
        window._gmMenuCommands.push({ name, fn });
        console.log('[Electro-XMOJ] Registered menu command:', name);
    };

    // ── unsafeWindow ──────────────────────────────────────────────────────
    window.unsafeWindow = window;

    console.log('[Electro-XMOJ] GM shim loaded');
})();
    `;
}

/**
 * Fetch and inject the XMOJ enhancement userscript.
 * We attempt to load the latest version from GitHub; if that fails we fall
 * back to the cached version stored in sessionStorage.
 */
async function injectXMOJScript() {
    const SCRIPT_URL =
        'https://raw.githubusercontent.com/XMOJ-Script-dev/XMOJ-Script/master/XMOJ.user.js';
    const CACHE_KEY = 'electro-xmoj-script-cache';

    let scriptText = null;

    // Try network first
    try {
        const response = await fetch(SCRIPT_URL);
        if (response.ok) {
            scriptText = await response.text();
            // Strip the userscript header (==UserScript== ... ==/UserScript==)
            scriptText = stripUserScriptHeader(scriptText);
            // Cache it for offline use
            try { sessionStorage.setItem(CACHE_KEY, scriptText); } catch (_) {}
        }
    } catch (e) {
        console.warn('[Electro-XMOJ] Failed to fetch XMOJ script from network:', e.message);
    }

    // Fall back to session cache
    if (!scriptText) {
        try { scriptText = sessionStorage.getItem(CACHE_KEY); } catch (_) {}
        if (scriptText) {
            console.log('[Electro-XMOJ] Using cached XMOJ script');
        }
    }

    if (!scriptText) {
        console.error('[Electro-XMOJ] Could not load XMOJ enhancement script');
        return;
    }

    const script = document.createElement('script');
    script.textContent = scriptText;
    (document.head || document.documentElement).appendChild(script);
}

/**
 * Remove the ==UserScript== metadata block from a Greasemonkey script so
 * it can be safely injected as a plain <script> tag.
 */
function stripUserScriptHeader(text) {
    const startMarker = '// ==UserScript==';
    const endMarker = '// ==/UserScript==';
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker);
    if (start !== -1 && end !== -1) {
        return text.slice(end + endMarker.length);
    }
    return text;
}
