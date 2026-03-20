async function loadSettings() {
  await window.ELXMOJ.syncChannelFromScriptDebug();
  const settings = await window.ELXMOJ.getSettings();
  document.getElementById("channel").value = settings.channel || "stable";
  document.getElementById("checkUpdateOnStartup").checked = Boolean(settings.checkUpdateOnStartup);
  document.getElementById("autoInjectUserscript").checked = Boolean(settings.autoInjectUserscript);

  const last = await window.ELXMOJ.getLastSelfCheck();
  if (last?.report) {
    setStatus(`${last.report}\n\n时间: ${new Date(last.timestamp).toLocaleString()}`);
  }
}

function collectSettings() {
  return {
    channel: document.getElementById("channel").value,
    checkUpdateOnStartup: document.getElementById("checkUpdateOnStartup").checked,
    autoInjectUserscript: document.getElementById("autoInjectUserscript").checked
  };
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function saveSettings() {
  try {
    const patch = collectSettings();
    const next = await window.ELXMOJ.updateSettings(patch);
    setStatus(`已保存\n通道: ${next.channel}\n启动更新检查: ${next.checkUpdateOnStartup}\n自动注入: ${next.autoInjectUserscript}`);
  } catch (error) {
    setStatus(`保存设置失败: ${String(error)}`);
  }
}

async function checkUpdateNow() {
  setStatus("正在检查更新...");
  try {
    const result = await window.ELXMOJ.checkUpdate();
    setStatus(`更新检查结果:\n${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    setStatus(`检查更新失败: ${String(error)}`);
  }
}

async function openAppUpdatePage() {
  setStatus("正在打开 App 更新下载页...");
  try {
    const info = await window.ELXMOJ.openAppUpdatePage();
    setStatus(`已打开 App 更新下载页:\n${info.url}`);
  } catch (error) {
    setStatus(`打开 App 更新下载页失败: ${String(error)}`);
  }
}

async function showAppUpdateUrl() {
  try {
    const info = await window.ELXMOJ.getAppUpdateInfo();
    const url = info?.downloadUrl || (await window.ELXMOJ.getAppUpdateUrl());

    const versionInfo = document.getElementById("appVersionInfo");
    if (versionInfo) {
      if (info?.ok) {
        versionInfo.textContent = `App 版本: 当前 ${info.currentVersion}，最新 ${info.latestVersion}，${info.hasUpdate ? "可更新" : "已是最新"}`;
      } else {
        versionInfo.textContent = `App 版本: 当前 ${info?.currentVersion || "未知"}，最新版本获取失败`;
      }
    }

    const hint = document.getElementById("appUpdateUrl");
    if (hint) {
      hint.textContent = `下载地址: ${url}`;
    }

    const advice = document.getElementById("appUpdateAdvice");
    if (advice) {
      advice.textContent = info?.ok
        ? ""
        : `无法自动获取最新版本时，请提供 latest.json 或 latest.yml（含 version 字段）到更新源目录，或维护 GitHub Release 最新 tag。${info?.message ? ` 详情: ${info.message}` : ""}`;
    }
  } catch {
    // Ignore optional hint failures
  }
}

async function runSelfCheckNow() {
  setStatus("正在执行自检...");
  try {
    const result = await window.ELXMOJ.runSelfCheck();
    setStatus(result.report || "自检完成");
  } catch (error) {
    setStatus(`自检失败: ${String(error)}`);
  }
}

document.getElementById("btnSave").addEventListener("click", saveSettings);
document.getElementById("btnCheckUpdate").addEventListener("click", checkUpdateNow);
document.getElementById("btnSelfCheck").addEventListener("click", runSelfCheckNow);
document.getElementById("btnAppUpdate").addEventListener("click", openAppUpdatePage);
document.getElementById("btnClose").addEventListener("click", () => window.close());

loadSettings().catch((error) => {
  setStatus(`加载设置失败: ${String(error)}`);
});

showAppUpdateUrl();
