const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const stopFocusBtn = document.getElementById("stopFocusBtn");

function renderStatus(data) {
    const registerId = data.registerId || "-";
    const active = data.focusModeActive ? "ON" : "OFF";
    const tasks = Number.isFinite(data.lastTaskCount) ? data.lastTaskCount : 0;
    const activeTasks = Number.isFinite(data.activeTaskCount) ? data.activeTaskCount : 0;
    const manualOff = data.manualFocusOff === true;
    const lastCheckAt = data.lastCheckAt ? new Date(data.lastCheckAt).toLocaleTimeString() : "never";

    statusEl.innerText = `ID: ${registerId} | Focus: ${active}${manualOff ? " (manual stop)" : ""} | Active: ${activeTasks}/${tasks} | Last refresh: ${lastCheckAt}`;
    stopFocusBtn.innerText = manualOff ? "Turn blocker back on" : "Stop blocker";
}

function loadStatus() {
    chrome.storage.local.get(
        ["registerId", "focusModeActive", "lastCheckAt", "lastTaskCount", "activeTaskCount", "manualFocusOff"],
        renderStatus
    );
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
        loadStatus();
    }
});

refreshBtn.addEventListener("click", () => {
    refreshBtn.disabled = true;
    chrome.runtime.sendMessage({ type: "CHECK_BLOCKING_NOW" }, () => {
        refreshBtn.disabled = false;
        loadStatus();
    });
});

stopFocusBtn.addEventListener("click", () => {
    stopFocusBtn.disabled = true;
    chrome.storage.local.get(["manualFocusOff"], (data) => {
        const manualOff = data.manualFocusOff === true;
        chrome.runtime.sendMessage({ type: manualOff ? "RESUME_FOCUS_MODE" : "STOP_FOCUS_MODE" }, () => {
            stopFocusBtn.disabled = false;
            loadStatus();
        });
    });
});

loadStatus();
