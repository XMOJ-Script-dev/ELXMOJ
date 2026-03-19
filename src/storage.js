const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_SETTINGS = {
  channel: "stable",
  checkUpdateOnStartup: true,
  autoInjectUserscript: true,
  skipVersionPrompt: ""
};

const APP_SCRIPT_NAME = "XMOJ.user.js";
const SETTINGS_FILE_NAME = "settings.json";

function getPaths(app) {
  const userDataDir = app.getPath("userData");
  return {
    userDataDir,
    settingsFile: path.join(userDataDir, SETTINGS_FILE_NAME),
    managedScriptFile: path.join(userDataDir, APP_SCRIPT_NAME)
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadSettings(app) {
  const paths = getPaths(app);
  await ensureDir(paths.userDataDir);
  const saved = await readJsonOrDefault(paths.settingsFile, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

async function saveSettings(app, settings) {
  const paths = getPaths(app);
  await ensureDir(paths.userDataDir);
  await writeJson(paths.settingsFile, settings);
}

async function ensureManagedScript(app, localScriptPath, options = {}) {
  const paths = getPaths(app);
  await ensureDir(paths.userDataDir);

  try {
    await fs.access(paths.managedScriptFile);
    return paths.managedScriptFile;
  } catch {
    let initialContent = "";

    if (typeof options.getInitialScriptContent === "function") {
      try {
        initialContent = String((await options.getInitialScriptContent()) || "");
      } catch {
        initialContent = "";
      }
    }

    if (!initialContent) {
      initialContent = await fs.readFile(localScriptPath, "utf8");
    }

    await fs.writeFile(paths.managedScriptFile, initialContent, "utf8");
    return paths.managedScriptFile;
  }
}

async function readManagedScript(app, localScriptPath, options = {}) {
  const managedPath = await ensureManagedScript(app, localScriptPath, options);
  return fs.readFile(managedPath, "utf8");
}

async function writeManagedScript(app, content) {
  const paths = getPaths(app);
  await ensureDir(paths.userDataDir);
  await fs.writeFile(paths.managedScriptFile, content, "utf8");
}

module.exports = {
  DEFAULT_SETTINGS,
  getPaths,
  loadSettings,
  saveSettings,
  readManagedScript,
  writeManagedScript,
  ensureManagedScript
};
