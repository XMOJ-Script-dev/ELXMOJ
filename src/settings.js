async function loadSettings() {
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
document.getElementById("btnClose").addEventListener("click", () => window.close());

loadSettings().catch((error) => {
  setStatus(`加载设置失败: ${String(error)}`);
});
