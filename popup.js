const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");

function renderStatus(data) {
    const registerId = data.registerId || "-";
    const active = data.focusModeActive ? "ON" : "OFF";
    const tasks = Number.isFinite(data.lastTaskCount) ? data.lastTaskCount : 0;
    statusEl.innerText = `ID: ${registerId} | Focus: ${active} | Tasks: ${tasks}`;
}

function loadStatus() {
    chrome.storage.local.get(["registerId", "focusModeActive", "lastCheckAt", "lastTaskCount"], renderStatus);
}

refreshBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "CHECK_BLOCKING_NOW" });
    setTimeout(loadStatus, 500);
});

loadStatus();
