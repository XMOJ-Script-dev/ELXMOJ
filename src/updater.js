const https = require("node:https");

const STABLE_URL = "https://xmoj-bbs.me/XMOJ.user.js";
const PREVIEW_URL = "https://dev.xmoj-bbs.me/XMOJ.user.js";

function getChannelUrl(channel) {
  return channel === "preview" ? PREVIEW_URL : STABLE_URL;
}

function downloadText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000, headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} while downloading ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

    req.on("timeout", () => {
      req.destroy(new Error(`Timeout while downloading ${url}`));
    });
    req.on("error", reject);
  });
}

function extractMetaValue(scriptText, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^\\s*//\\s*@${escaped}\\s+(.+)$`, "m");
  const match = scriptText.match(regex);
  return match ? match[1].trim() : "";
}

function extractVersion(scriptText) {
  return extractMetaValue(scriptText, "version");
}

function extractName(scriptText) {
  return extractMetaValue(scriptText, "name") || "XMOJ";
}

function extractRequires(scriptText) {
  const lines = scriptText.split(/\r?\n/);
  const list = [];
  for (const line of lines) {
    const match = line.match(/^\s*\/\/\s*@require\s+(.+)$/);
    if (match) {
      list.push(match[1].trim());
    }
  }
  return list;
}

function isNewerVersion(currentVersion, remoteVersion) {
  const c = currentVersion.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const r = remoteVersion.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const maxLen = Math.max(c.length, r.length);
  for (let i = 0; i < maxLen; i += 1) {
    const cv = c[i] ?? 0;
    const rv = r[i] ?? 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

module.exports = {
  STABLE_URL,
  PREVIEW_URL,
  getChannelUrl,
  downloadText,
  extractVersion,
  extractName,
  extractRequires,
  isNewerVersion
};
