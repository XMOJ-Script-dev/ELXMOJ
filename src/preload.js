const { contextBridge, ipcRenderer } = require("electron");
const { createHash } = require("node:crypto");
const vm = require("node:vm");

const REQUIRE_FALLBACKS = {
  "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js": [
    "https://cdn.jsdelivr.net/npm/crypto-js@4.1.1/crypto-js.min.js",
    "https://unpkg.com/crypto-js@4.1.1/crypto-js.js"
  ],
  "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.2/purify.min.js": [
    "https://cdn.jsdelivr.net/npm/dompurify@3.0.2/dist/purify.min.js",
    "https://unpkg.com/dompurify@3.0.2/dist/purify.min.js"
  ],
  "https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js": [
    "https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js",
    "https://unpkg.com/marked@4.3.0/marked.min.js"
  ],
  "https://gitee.com/mirrors_google/diff-match-patch/raw/master/javascript/diff_match_patch_uncompressed.js": [
    "https://cdnjs.cloudflare.com/ajax/libs/diff_match_patch/20121119/diff_match_patch_uncompressed.js",
    "https://cdn.jsdelivr.net/gh/google/diff-match-patch@master/javascript/diff_match_patch_uncompressed.js",
    "https://raw.githubusercontent.com/google/diff-match-patch/master/javascript/diff_match_patch_uncompressed.js"
  ]
};

const ELXMOJ_INJECTION_LOCK_KEY = "__ELXMOJ_INJECTION_LOCK__";
const ELXMOJ_RELOAD_GUARD_INSTALLED_KEY = "__ELXMOJ_RELOAD_GUARD_INSTALLED__";
const ELXMOJ_RELOAD_LOG_KEY = "__ELXMOJ_RELOAD_LOG__";
const ELXMOJ_BLOCK_NEXT_RELOAD_UNTIL_KEY = "__ELXMOJ_BLOCK_NEXT_RELOAD_UNTIL__";
const ELXMOJ_COOKIE_SHIM_INSTALLED_KEY = "__ELXMOJ_COOKIE_SHIM_INSTALLED__";
const ELXMOJ_SHADOW_PHPSESSID_KEY = "__ELXMOJ_SHADOW_PHPSESSID__";
const ELXMOJ_SAVED_CREDENTIAL_KEY = "__ELXMOJ_SAVED_CREDENTIAL__";
const ELXMOJ_TURNSTILE_BRIDGE_INSTALLED_KEY = "__ELXMOJ_TURNSTILE_BRIDGE_INSTALLED__";

function shouldInjectUserscriptInThisFrame() {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
}

function acquireInjectionLock() {
  if (window[ELXMOJ_INJECTION_LOCK_KEY]) {
    return false;
  }
  window[ELXMOJ_INJECTION_LOCK_KEY] = true;
  return true;
}

function installReloadLoopGuard() {
  if (window[ELXMOJ_RELOAD_GUARD_INSTALLED_KEY]) {
    return;
  }
  window[ELXMOJ_RELOAD_GUARD_INSTALLED_KEY] = true;

  const MAX_RELOADS_IN_WINDOW = 3;
  const WINDOW_MS = 15000;

  const locationObject = window.location;
  const locationProto = Object.getPrototypeOf(locationObject);
  const originalReload = typeof locationObject.reload === "function"
    ? locationObject.reload.bind(locationObject)
    : null;

  if (!originalReload) {
    return;
  }

  const isReloadAllowed = () => {
    try {
      const now = Date.now();
      const blockedUntil = Number.parseInt(sessionStorage.getItem(ELXMOJ_BLOCK_NEXT_RELOAD_UNTIL_KEY) || "0", 10);
      if (Number.isFinite(blockedUntil) && blockedUntil > now) {
        return false;
      }

      const raw = sessionStorage.getItem(ELXMOJ_RELOAD_LOG_KEY);
      const parsed = JSON.parse(raw || "[]");
      const history = Array.isArray(parsed) ? parsed : [];
      const recent = history.filter((ts) => Number.isFinite(ts) && now - ts <= WINDOW_MS);

      if (recent.length >= MAX_RELOADS_IN_WINDOW) {
        return false;
      }

      recent.push(now);
      sessionStorage.setItem(ELXMOJ_RELOAD_LOG_KEY, JSON.stringify(recent));
      sessionStorage.removeItem(ELXMOJ_BLOCK_NEXT_RELOAD_UNTIL_KEY);
      return true;
    } catch {
      return true;
    }
  };

  const patchedReload = function patchedReload(...args) {
    if (!isReloadAllowed()) {
      console.warn("ELXMOJ blocked excessive page reload to prevent refresh loop.");
      return;
    }

    return originalReload(...args);
  };

  try {
    locationObject.reload = patchedReload;
  } catch {
    // ignore when Location.reload is not writable on instance
  }

  try {
    if (locationProto && typeof locationProto.reload === "function") {
      locationProto.reload = patchedReload;
    }
  } catch {
    // ignore when Location.prototype.reload is not writable
  }
}

function blockNextReload(milliseconds = 8000) {
  try {
    const until = Date.now() + Math.max(1000, Number(milliseconds) || 0);
    sessionStorage.setItem(ELXMOJ_BLOCK_NEXT_RELOAD_UNTIL_KEY, String(until));
  } catch {
    // ignore storage failures
  }
}

function setShadowPhpSessionId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return;
  }

  try {
    sessionStorage.setItem(ELXMOJ_SHADOW_PHPSESSID_KEY, normalized);
  } catch {
    // ignore storage failures
  }
}

function getShadowPhpSessionId() {
  try {
    return String(sessionStorage.getItem(ELXMOJ_SHADOW_PHPSESSID_KEY) || "").trim();
  } catch {
    return "";
  }
}

function installCookieVisibilityShim(initialPhpSessionId) {
  if (window[ELXMOJ_COOKIE_SHIM_INSTALLED_KEY]) {
    return;
  }

  if (initialPhpSessionId) {
    setShadowPhpSessionId(initialPhpSessionId);
  }

  const docProto = Object.getPrototypeOf(document);
  const descriptor = Object.getOwnPropertyDescriptor(docProto, "cookie");
  if (!descriptor || typeof descriptor.get !== "function" || typeof descriptor.set !== "function") {
    return;
  }

  const nativeGet = descriptor.get.bind(document);
  const nativeSet = descriptor.set.bind(document);

  try {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      enumerable: true,
      get() {
        const raw = nativeGet() || "";
        if (/\bPHPSESSID=/i.test(raw)) {
          return raw;
        }

        const shadow = getShadowPhpSessionId();
        if (!shadow) {
          return raw;
        }

        return raw ? `${raw}; PHPSESSID=${shadow}` : `PHPSESSID=${shadow}`;
      },
      set(value) {
        nativeSet(value);
      }
    });
    window[ELXMOJ_COOKIE_SHIM_INSTALLED_KEY] = true;
  } catch {
    // ignore non-configurable cookie descriptor
  }
}

function createStoragePrefix() {
  return "ELXMOJ_GM_";
}

function setupHexMd5Polyfill() {
  if (typeof window.hex_md5 === "function") return;

  window.hex_md5 = (input) => {
    if (window.CryptoJS && typeof window.CryptoJS.MD5 === "function") {
      return window.CryptoJS.MD5(String(input ?? "")).toString();
    }

    return createHash("md5").update(String(input ?? ""), "utf8").digest("hex");
  };
}

function setupCryptoJsFallback() {
  if (window.CryptoJS && typeof window.CryptoJS.MD5 === "function") {
    return;
  }

  window.CryptoJS = {
    MD5: (input) => {
      const hex = createHash("md5").update(String(input ?? ""), "utf8").digest("hex");
      return {
        toString: () => hex
      };
    }
  };
}

function setupMarkedFallback() {
  if (window.marked && typeof window.marked.parse === "function") {
    return;
  }

  const escapeHtml = (input) =>
    String(input ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const parse = (markdown) => {
    const text = String(markdown ?? "");
    return text
      .split(/\r?\n\r?\n/)
      .map((block) => `<p>${escapeHtml(block).replace(/\r?\n/g, "<br>")}</p>`)
      .join("\n");
  };

  window.marked = {
    parse,
    lexer: (markdown) => [{ type: "paragraph", text: String(markdown ?? "") }]
  };
}

function setupDomPurifyFallback() {
  if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
    return;
  }

  window.DOMPurify = {
    sanitize: (input, options = {}) => {
      const raw = String(input ?? "");

      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${raw}</div>`, "text/html");
        const wrapper = doc.body.firstElementChild;
        if (!wrapper) {
          return "";
        }

        const allowedTagsInput = Array.isArray(options.ALLOWED_TAGS) ? options.ALLOWED_TAGS : [];
        const allowedAttrsInput = Array.isArray(options.ALLOWED_ATTR) ? options.ALLOWED_ATTR : [];
        const allowedTags = new Set(allowedTagsInput.map((value) => String(value).toLowerCase()));
        const allowedAttrs = new Set(allowedAttrsInput.map((value) => String(value).toLowerCase()));

        const sanitizeElement = (element) => {
          for (const child of Array.from(element.children)) {
            const tagName = child.tagName.toLowerCase();
            const tagAllowed = allowedTags.size === 0 || allowedTags.has(tagName);

            if (!tagAllowed) {
              child.replaceWith(doc.createTextNode(child.textContent || ""));
              continue;
            }

            for (const attr of Array.from(child.attributes)) {
              const attrName = attr.name.toLowerCase();
              const value = String(attr.value || "");
              const isEventAttr = attrName.startsWith("on");
              const isJavascriptUrl =
                /^(href|src|xlink:href)$/i.test(attrName) && /^\s*javascript:/i.test(value);
              const attrAllowed = allowedAttrs.size === 0 || allowedAttrs.has(attrName);

              if (isEventAttr || isJavascriptUrl || !attrAllowed) {
                child.removeAttribute(attr.name);
              }
            }

            sanitizeElement(child);
          }
        };

        sanitizeElement(wrapper);
        return wrapper.innerHTML;
      } catch {
        return raw.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
      }
    }
  };
}

function setupTurnstileCallbackBridge() {
  if (window[ELXMOJ_TURNSTILE_BRIDGE_INSTALLED_KEY]) {
    return;
  }

  window[ELXMOJ_TURNSTILE_BRIDGE_INSTALLED_KEY] = true;

  const callbackStore = new Map();
  let callbackCounter = 0;

  const toPlainObject = (value) => {
    if (!value || typeof value !== "object") {
      return {};
    }

    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "function") {
        continue;
      }
      result[key] = item;
    }
    return result;
  };

  const bridgedTurnstile = {
    render: (target, options = {}) => {
      const safeOptions = toPlainObject(options);
      const callbackId = `elxmoj_turnstile_cb_${Date.now()}_${++callbackCounter}`;
      if (typeof options?.callback === "function") {
        callbackStore.set(callbackId, options.callback);
      }

      window.postMessage(
        {
          __ELXMOJ_TURNSTILE_RENDER__: true,
          target,
          options: safeOptions,
          callbackId
        },
        "*"
      );

      return callbackId;
    },
    reset: (widgetId) => {
      window.postMessage(
        {
          __ELXMOJ_TURNSTILE_RESET__: true,
          widgetId
        },
        "*"
      );
    },
    remove: (widgetId) => {
      window.postMessage(
        {
          __ELXMOJ_TURNSTILE_REMOVE__: true,
          widgetId
        },
        "*"
      );
    }
  };

  if (!window.turnstile || typeof window.turnstile !== "object") {
    window.turnstile = {};
  }

  if (typeof window.turnstile.render !== "function") {
    window.turnstile.render = bridgedTurnstile.render;
  }
  if (typeof window.turnstile.reset !== "function") {
    window.turnstile.reset = bridgedTurnstile.reset;
  }
  if (typeof window.turnstile.remove !== "function") {
    window.turnstile.remove = bridgedTurnstile.remove;
  }

  window.addEventListener("message", (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (payload.__ELXMOJ_TURNSTILE_CALLBACK__ === true) {
      try {
        if (typeof window.CaptchaLoadedCallback === "function") {
          window.CaptchaLoadedCallback(...(payload.args || []));
        }
      } catch (error) {
        console.error("ELXMOJ turnstile callback bridge error:", error);
      }
      return;
    }

    if (payload.__ELXMOJ_TURNSTILE_TOKEN__ === true) {
      const callbackId = String(payload.callbackId || "");
      if (!callbackId) {
        return;
      }

      const callback = callbackStore.get(callbackId);
      if (typeof callback === "function") {
        try {
          callback(String(payload.token || ""));
        } catch (error) {
          console.error("ELXMOJ turnstile token callback error:", error);
        }
      }
      return;
    }

    if (payload.__ELXMOJ_TURNSTILE_ERROR__ === true) {
      console.warn("ELXMOJ turnstile page render failed:", payload.message || "unknown error");
    }
  });

  try {
    const script = document.createElement("script");
    script.textContent = `
      (function () {
        if (window.__ELXMOJ_TURNSTILE_PAGE_BRIDGE__ === true) {
          return;
        }
        window.__ELXMOJ_TURNSTILE_PAGE_BRIDGE__ = true;

        var originalCaptchaLoadedCallback =
          typeof window.CaptchaLoadedCallback === "function" ? window.CaptchaLoadedCallback : null;
        window.CaptchaLoadedCallback = function () {
          if (typeof originalCaptchaLoadedCallback === "function") {
            try {
              originalCaptchaLoadedCallback.apply(window, arguments);
            } catch (error) {
              console.error("ELXMOJ page original CaptchaLoadedCallback error:", error);
            }
          }
          window.postMessage({
            __ELXMOJ_TURNSTILE_CALLBACK__: true,
            args: Array.prototype.slice.call(arguments)
          }, "*");
        };

        var renderWithBridge = function (target, options, callbackId) {
          if (!window.turnstile || typeof window.turnstile.render !== "function") {
            return false;
          }

          var finalOptions = options && typeof options === "object" ? Object.assign({}, options) : {};
          finalOptions.callback = function (token) {
            window.postMessage(
              {
                __ELXMOJ_TURNSTILE_TOKEN__: true,
                callbackId: callbackId,
                token: String(token || "")
              },
              "*"
            );
          };

          try {
            window.turnstile.render(target, finalOptions);
            return true;
          } catch (error) {
            window.postMessage(
              {
                __ELXMOJ_TURNSTILE_ERROR__: true,
                message: String((error && error.message) || error || "turnstile.render failed")
              },
              "*"
            );
            return true;
          }
        };

        window.addEventListener("message", function (event) {
          var payload = event && event.data;
          if (!payload || typeof payload !== "object") {
            return;
          }

          if (payload.__ELXMOJ_TURNSTILE_RENDER__ === true) {
            if (!renderWithBridge(payload.target, payload.options, payload.callbackId)) {
              window.setTimeout(function () {
                renderWithBridge(payload.target, payload.options, payload.callbackId);
              }, 150);
            }
            return;
          }

          if (payload.__ELXMOJ_TURNSTILE_RESET__ === true) {
            if (window.turnstile && typeof window.turnstile.reset === "function") {
              try {
                window.turnstile.reset(payload.widgetId);
              } catch {
                // ignore turnstile reset failures
              }
            }
            return;
          }

          if (payload.__ELXMOJ_TURNSTILE_REMOVE__ === true) {
            if (window.turnstile && typeof window.turnstile.remove === "function") {
              try {
                window.turnstile.remove(payload.widgetId);
              } catch {
                // ignore turnstile remove failures
              }
            }
          }
        });
      })();
    `;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  } catch {
    // ignore bridge injection failures
  }
}

function setupCredentialManagementFallback() {
  const hasNativeCredentialApi =
    typeof navigator !== "undefined" &&
    navigator.credentials &&
    typeof navigator.credentials.store === "function" &&
    typeof navigator.credentials.get === "function";

  if (hasNativeCredentialApi && typeof window.PasswordCredential === "function") {
    return;
  }

  class LocalPasswordCredential {
    constructor(init = {}) {
      this.id = String(init.id || "");
      this.password = String(init.password || "");
      this.type = "password";
    }
  }

  if (typeof window.PasswordCredential !== "function") {
    window.PasswordCredential = LocalPasswordCredential;
  }

  const readSaved = () => {
    try {
      const raw = localStorage.getItem(ELXMOJ_SAVED_CREDENTIAL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.id || !parsed.password) return null;
      return {
        id: String(parsed.id),
        password: String(parsed.password)
      };
    } catch {
      return null;
    }
  };

  const writeSaved = (credential) => {
    try {
      localStorage.setItem(
        ELXMOJ_SAVED_CREDENTIAL_KEY,
        JSON.stringify({
          id: String(credential?.id || ""),
          password: String(credential?.password || "")
        })
      );
    } catch {
      // ignore storage failures
    }
  };

  const clearSaved = () => {
    try {
      localStorage.removeItem(ELXMOJ_SAVED_CREDENTIAL_KEY);
    } catch {
      // ignore storage failures
    }
  };

  const fallbackCredentials = {
    async store(credential) {
      if (!credential || !credential.id || !credential.password) {
        return null;
      }
      writeSaved(credential);
      return credential;
    },
    async get(options = {}) {
      const wantsPassword = Boolean(options && options.password);
      if (!wantsPassword) {
        return null;
      }

      const saved = readSaved();
      if (!saved) {
        return null;
      }

      return new window.PasswordCredential(saved);
    },
    async preventSilentAccess() {
      clearSaved();
    }
  };

  try {
    if (!navigator.credentials) {
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        enumerable: true,
        value: fallbackCredentials
      });
      return;
    }
  } catch {
    // ignore and fall through to method patching
  }

  try {
    if (typeof navigator.credentials.store !== "function") {
      navigator.credentials.store = fallbackCredentials.store;
    }
    if (typeof navigator.credentials.get !== "function") {
      navigator.credentials.get = fallbackCredentials.get;
    }
    if (typeof navigator.credentials.preventSilentAccess !== "function") {
      navigator.credentials.preventSilentAccess = fallbackCredentials.preventSilentAccess;
    }
  } catch {
    // ignore non-writable navigator.credentials object
  }
}

function setupGmPolyfills(payload = null) {
  const prefix = createStoragePrefix();

  window.unsafeWindow = window;

  window.GM_getValue = (key, defaultValue = null) => {
    const raw = localStorage.getItem(`${prefix}${key}`);
    if (raw === null || raw === undefined) return defaultValue;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  window.GM_setValue = (key, value) => {
    localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));
  };

  window.GM_setClipboard = async (text) => {
    await navigator.clipboard.writeText(String(text ?? ""));
  };

  window.GM_registerMenuCommand = () => {
    // Electron 版本先使用应用菜单提供命令，不在页面内重复注册。
  };

  window.GM_xmlhttpRequest = (details = {}) => {
    let aborted = false;

    ipcRenderer
      .invoke("elxmoj:gm-xhr", {
        url: details.url,
        method: details.method || "GET",
        headers: details.headers || {},
        data: details.data,
        timeout: details.timeout
      })
      .then((result) => {
        if (aborted) return;

        if (!result?.ok) {
          if (typeof details.onerror === "function") {
            details.onerror({
              error: String(result?.error || "Unknown request error"),
              readyState: 4
            });
          }
          return;
        }

        if (typeof details.onload === "function") {
          details.onload({
            status: result.status,
            statusText: result.statusText,
            responseText: result.responseText,
            finalUrl: result.finalUrl || details.url,
            responseHeaders: result.headers || {},
            readyState: 4
          });
        }
      })
      .catch((error) => {
        if (aborted) return;
        if (typeof details.onerror === "function") {
          details.onerror({ error: String(error?.message || error), readyState: 4 });
        }
      });

    return {
      abort: () => {
        aborted = true;
      }
    };
  };

  window.GM_cookie = {
    list: async (details = {}, callback) => {
      try {
        const cookies = await ipcRenderer.invoke("elxmoj:gm-cookie-list", details || {});
        if (typeof callback === "function") {
          callback(cookies, null);
        }
        return cookies;
      } catch (error) {
        const errMessage = String(error?.message || error);
        if (typeof callback === "function") {
          callback([], errMessage);
        }
        return [];
      }
    },
    set: async (details = {}, callback) => {
      try {
        const result = await ipcRenderer.invoke("elxmoj:gm-cookie-set", details || {});
        if (!result?.success) {
          const isHttpOnlyConflict = result?.code === "EXCLUDE_OVERWRITE_HTTP_ONLY" || result?.ignored === true;
          const errMessage = String(result?.error || "GM_cookie.set failed");
          if (isHttpOnlyConflict) {
            const isPhpSessid = String(details?.name || "").toUpperCase() === "PHPSESSID";
            if (isPhpSessid) {
              setShadowPhpSessionId(details?.value);
              blockNextReload();
              if (typeof callback === "function") {
                callback(result, null);
              }
              throw new Error("PHPSESSID_HTTPONLY_CONFLICT");
              //这个conflict非常奇妙，会直接阻断刷新风暴TAT
            }
            if (typeof callback === "function") {
              callback(result, null);
            }
            return result;
          }
          if (typeof callback === "function") {
            callback(result, errMessage);
          }
          throw new Error(errMessage);
        }
        if (typeof callback === "function") {
          callback(result, null);
        }
        return result;
      } catch (error) {
        const errMessage = String(error?.message || error);
        if (typeof callback === "function") {
          callback({ success: false, error: errMessage }, errMessage);
        }
        throw new Error(errMessage);
      }
    },
    delete: async (details = {}, callback) => {
      try {
        const result = await ipcRenderer.invoke("elxmoj:gm-cookie-delete", details || {});
        if (!result?.success) {
          const errMessage = String(result?.error || "GM_cookie.delete failed");
          if (typeof callback === "function") {
            callback(result, errMessage);
          }
          throw new Error(errMessage);
        }
        if (typeof callback === "function") {
          callback(result, null);
        }
        return result;
      } catch (error) {
        const errMessage = String(error?.message || error);
        if (typeof callback === "function") {
          callback({ success: false, error: errMessage }, errMessage);
        }
        throw new Error(errMessage);
      }
    }
  };

  const gmApi = {
    getValue: window.GM_getValue,
    setValue: window.GM_setValue,
    setClipboard: window.GM_setClipboard,
    registerMenuCommand: window.GM_registerMenuCommand,
    xmlHttpRequest: window.GM_xmlhttpRequest,
    xmlhttpRequest: window.GM_xmlhttpRequest,
    cookie: window.GM_cookie,
    info: {
      script: {
        name: payload?.name || "XMOJ",
        version: payload?.version || "0.0.0"
      },
      scriptHandler: "ELXMOJ",
      version: "1.0.0"
    }
  };

  window.GM = gmApi;
  window.GM_info = gmApi.info;
}

async function loadRequireScripts(urls) {
  for (const url of urls) {
    await loadRequireScriptWithFallback(url);
  }
}

function getRequireCandidates(url) {
  const fallbacks = REQUIRE_FALLBACKS[url] || [];
  return [url, ...fallbacks];
}

function loadScriptTag(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = false;
    script.onload = () => resolve(url);
    script.onerror = () => reject(new Error(`Failed to load @require: ${url}`));
    document.head.appendChild(script);
  });
}

function executeRequireScriptInCurrentContext(source, url) {
  const code = String(source ?? "");
  if (!code.trim()) {
    throw new Error(`Empty script body for @require: ${url}`);
  }

  // Run @require in the same isolated world so globals like CodeMirror are visible to userscript.
  const script = new vm.Script(`${code}\n//# sourceURL=${url}`, {
    filename: url,
    displayErrors: true
  });
  script.runInThisContext();
}

function executeUserscriptInCurrentContext(source) {
  const code = String(source ?? "");
  if (!code.trim()) {
    throw new Error("Userscript payload is empty");
  }

  // Run userscript in preload (isolated world) so GM_* polyfills are available.
  const script = new vm.Script(`${code}\n//# sourceURL=elxmoj-userscript.js`, {
    filename: "elxmoj-userscript.js",
    displayErrors: true
  });
  script.runInThisContext();
}

async function loadScriptInCurrentContext(url) {
  const result = await ipcRenderer.invoke("elxmoj:gm-xhr", {
    url,
    method: "GET",
    timeout: 20000
  });

  if (!result?.ok) {
    throw new Error(`Failed to download @require script: ${String(result?.error || "unknown error")}`);
  }

  executeRequireScriptInCurrentContext(result.responseText, url);
}

async function loadRequireScriptWithFallback(url) {
  const candidates = getRequireCandidates(url);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      await loadScriptInCurrentContext(candidate);
      return;
    } catch (error) {
      lastError = error;

      // Final backup path: still try regular script tag in case a library must execute in page world.
      try {
        await loadScriptTag(candidate);
        return;
      } catch {
        // ignore and continue to next candidate
      }
    }
  }

  throw new Error(
    `Failed to load @require after trying ${candidates.length} source(s): ${url}. Last error: ${String(lastError?.message || lastError)}`
  );
}

async function injectUserscriptWhenReady() {
  if (!shouldInjectUserscriptInThisFrame()) {
    return;
  }

  if (!location.hostname.endsWith("xmoj.tech") && location.hostname !== "116.62.212.172") {
    return;
  }

  if (!acquireInjectionLock()) {
    return;
  }

  try {
    const settings = await ipcRenderer.invoke("elxmoj:get-settings");
    if (settings && settings.autoInjectUserscript === false) {
      window.__ELXMOJ_INJECTION_STATUS__ = {
        ok: false,
        reason: "auto_inject_disabled"
      };
      return;
    }

    const payload = await ipcRenderer.invoke("elxmoj:get-script-payload");
    const phpSessionId = await ipcRenderer.invoke("elxmoj:get-phpsessid");
    setShadowPhpSessionId(phpSessionId);

    if (!payload || !payload.scriptText) {
      window.__ELXMOJ_INJECTION_STATUS__ = {
        ok: false,
        reason: "script_payload_empty"
      };
      return;
    }

    setupGmPolyfills(payload);
    setupCredentialManagementFallback();
    installReloadLoopGuard();
    installCookieVisibilityShim(String(phpSessionId || ""));
    await loadRequireScripts(payload.requires || []);
    setupCryptoJsFallback();
    setupMarkedFallback();
    setupDomPurifyFallback();
    setupTurnstileCallbackBridge();
    setupHexMd5Polyfill();

    executeUserscriptInCurrentContext(payload.scriptText);

    window.__ELXMOJ_INJECTION_STATUS__ = {
      ok: true,
      version: payload.version,
      loadedAt: Date.now(),
      requireCount: (payload.requires || []).length
    };
  } catch (error) {
    console.error("ELXMOJ injection failed:", error);
    window.__ELXMOJ_INJECTION_STATUS__ = {
      ok: false,
      reason: String(error?.message || error)
    };
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    injectUserscriptWhenReady();
  });
} else {
  injectUserscriptWhenReady();
}

function isTrustedPreloadContext() {
  try {
    // Only expose the ELXMOJ bridge to local app pages (e.g., settings UI),
    // and not to remote web content loaded over http/https.
    return window.location && window.location.protocol === "file:";
  } catch {
    return false;
  }
}

if (isTrustedPreloadContext()) {
  contextBridge.exposeInMainWorld("ELXMOJ", {
    getSettings: () => ipcRenderer.invoke("elxmoj:get-settings"),
    updateSettings: (patch) => ipcRenderer.invoke("elxmoj:update-settings", patch),
    getScriptDebugMode: () => ipcRenderer.invoke("elxmoj:get-script-debug-mode"),
    setScriptDebugMode: (enabled) => ipcRenderer.invoke("elxmoj:set-script-debug-mode", enabled),
    syncChannelFromScriptDebug: () => ipcRenderer.invoke("elxmoj:sync-channel-from-script-debug"),
    checkUpdate: () => ipcRenderer.invoke("elxmoj:check-update"),
    runSelfCheck: () => ipcRenderer.invoke("elxmoj:run-self-check"),
    getLastSelfCheck: () => ipcRenderer.invoke("elxmoj:get-last-self-check"),
    getAppUpdateUrl: () => ipcRenderer.invoke("elxmoj:get-app-update-url"),
    openAppUpdatePage: () => ipcRenderer.invoke("elxmoj:open-app-update-page")
  });
}
