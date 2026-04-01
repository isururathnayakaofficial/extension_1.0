const BLOCKED_SITES = [
    "facebook.com",
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "tiktok.com"
];
const API_BASE_URL = "http://localhost:8081";
const CHECK_ALARM_NAME = "focus-check";
const BLOCKED_PAGE_URL = chrome.runtime.getURL("blocked.html");
const BLOCK_RULE_START_ID = 7000;
const FAST_REFRESH_MS = 3000;
const CHECK_DEBOUNCE_MS = 2000;
let isBlockingEnabled = false;
let fastRefreshTimer = null;
let isCheckRunning = false;
let lastCheckAtMs = 0;

const toRuleId = (_site, index) => BLOCK_RULE_START_ID + index;

const parseResponseSafe = async (res) => {
    const text = await res.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
};

function getFromStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => resolve(result));
    });
}

function setToStorage(values) {
    return new Promise((resolve) => {
        chrome.storage.local.set(values, () => resolve());
    });
}

// Resolve registerId similarly to TodoView: prefer cached id, then userData/registerEmail + /auth/getAll.
async function resolveRegisterId() {
    const { registerId, userData, registerEmail } = await getFromStorage(["registerId", "userData", "registerEmail"]);
    if (registerId) return registerId;

    const email = registerEmail || userData?.email;
    if (!email) return null;

    try {
        const res = await fetch(`${API_BASE_URL}/auth/getAll`);
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = await parseResponseSafe(res);
        const users = Array.isArray(data) ? data : data.users || [];
        const user = users.find((u) =>
            String(u.email || "").trim().toLowerCase() === String(email).trim().toLowerCase()
        );
        if (!user) return null;

        const resolvedId = user.registerId || user.registerID || user.id || user.userId || null;
        if (resolvedId) {
            await setToStorage({ registerId: resolvedId });
        }
        return resolvedId;
    } catch (err) {
        console.error("resolveRegisterId error", err);
        return null;
    }
}

function extractTaskList(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];

    const candidates = [
        data.todos,
        data.data,
        data.list,
        data.items,
        data.taskList,
        data.todoList,
        data.tasks
    ];

    const matched = candidates.find(Array.isArray);
    return matched || [];
}

// Fetch tasks for registerId
async function fetchTasks(registerId) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/todo/get/${registerId}`);
        if (!res.ok) throw new Error("Failed to fetch tasks");
        const data = await parseResponseSafe(res);
        return extractTaskList(data);
    } catch (err) {
        console.error(err);
        return [];
    }
}

function to24HourTime(timeValue) {
    const input = String(timeValue || "").trim();
    if (!input) return null;

    const amPmMatch = input.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (amPmMatch) {
        let hour = Number(amPmMatch[1]);
        const minutes = amPmMatch[2];
        const seconds = amPmMatch[3] || "00";
        const meridiem = amPmMatch[4].toUpperCase();

        if (meridiem === "PM" && hour < 12) hour += 12;
        if (meridiem === "AM" && hour === 12) hour = 0;

        return `${String(hour).padStart(2, "0")}:${minutes}:${seconds}`;
    }

    const simpleMatch = input.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (simpleMatch) {
        const hour = String(Number(simpleMatch[1])).padStart(2, "0");
        const minutes = simpleMatch[2];
        const seconds = simpleMatch[3] || "00";
        return `${hour}:${minutes}:${seconds}`;
    }

    return null;
}

function parseDateTime(dateValue, timeValue) {
    if (dateValue && !timeValue) {
        const direct = new Date(dateValue);
        if (!Number.isNaN(direct.getTime())) return direct;
    }

    if (!dateValue || !timeValue) return null;

    const dateStr = String(dateValue).trim();
    const day = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
    const time = to24HourTime(timeValue);
    if (!time) return null;

    const parsed = new Date(`${day}T${time}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isTaskClosed(task) {
    if (!task || typeof task !== "object") return false;

    const status = String(task.status || task.taskStatus || task.todoStatus || "")
        .trim()
        .toUpperCase();

    const doneStatuses = [
        "DONE",
        "COMPLETED",
        "CANCELLED",
        "CANCELED",
        "DELETED",
        "ARCHIVED",
        "FINISHED",
        "CLOSED"
    ];

    const isCompletedFlag = task.completed === true || task.isCompleted === true || task.done === true;
    const isDeletedFlag = task.deleted === true || task.isDeleted === true;
    const isFinishedByStatus = doneStatuses.includes(status);

    return isCompletedFlag || isDeletedFlag || isFinishedByStatus;
}

function isTaskActive(task) {
    if (!task || typeof task !== "object") return false;
    if (isTaskClosed(task)) return false;

    const now = new Date();

    const directStart = parseDateTime(task.startDateTime || task.start || task.fromDateTime, null);
    const directEnd = parseDateTime(task.endDateTime || task.end || task.toDateTime, null);

    const baseDate = task.date || task.taskDate || task.todoDate;
    const startTime = task.startTime || task.fromTime;
    const endTime = task.endTime || task.toTime || task.finishTime;

    const taskStart = directStart || parseDateTime(baseDate, startTime);
    let taskEnd = directEnd || parseDateTime(baseDate, endTime);

    if (!taskStart || !taskEnd) return false;

    if (taskEnd < taskStart) {
        taskEnd = new Date(taskEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    return now >= taskStart && now <= taskEnd;
}

async function updateBlockingRules(shouldBlock) {
    const ruleIds = BLOCKED_SITES.map((site, index) => toRuleId(site, index));
    const addRules = shouldBlock
        ? BLOCKED_SITES.map((site, index) => ({
            id: toRuleId(site, index),
            priority: 1,
            action: { type: "redirect", redirect: { url: `${BLOCKED_PAGE_URL}?site=${encodeURIComponent(site)}` } },
            condition: { urlFilter: `||${site}`, resourceTypes: ["main_frame"] }
        }))
        : [];

    return new Promise((resolve) => {
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: ruleIds,
            addRules
        }, () => {
            if (chrome.runtime.lastError) {
                console.error("updateDynamicRules failed", chrome.runtime.lastError.message);
            }
            resolve();
        });
    });
}

function isBlockedDomainUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return BLOCKED_SITES.some((site) => host === site || host.endsWith(`.${site}`));
    } catch {
        return false;
    }
}

async function enforceBlockingOnOpenTabs(shouldBlock) {
    if (!shouldBlock) return;

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id && isBlockedDomainUrl(tab.url)) {
            chrome.tabs.update(tab.id, { url: BLOCKED_PAGE_URL });
        }
    }
}

// Periodically check tasks and block sites
async function checkAndBlock(force = false) {
    if (isCheckRunning) return;
    if (!force && Date.now() - lastCheckAtMs < CHECK_DEBOUNCE_MS) return;

    isCheckRunning = true;
    const registerId = await resolveRegisterId();
    if (!registerId) {
        isBlockingEnabled = false;
        await updateBlockingRules(false);
        await setToStorage({ focusModeActive: false, lastCheckAt: new Date().toISOString() });
        lastCheckAtMs = Date.now();
        isCheckRunning = false;
        return;
    }

    try {
        const tasks = await fetchTasks(registerId);
        const activeTasks = tasks.filter(isTaskActive);
        const shouldBlock = activeTasks.length > 0;

        if (shouldBlock !== isBlockingEnabled || force) {
            await updateBlockingRules(shouldBlock);
            await enforceBlockingOnOpenTabs(shouldBlock);
        }
        isBlockingEnabled = shouldBlock;
        await setToStorage({
            focusModeActive: shouldBlock,
            lastCheckAt: new Date().toISOString(),
            lastTaskCount: tasks.length,
            activeTaskCount: activeTasks.length
        });
    } finally {
        lastCheckAtMs = Date.now();
        isCheckRunning = false;
    }
}

function scheduleChecks() {
    chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: 1 });
}

function startFastRefresh() {
    if (fastRefreshTimer) {
        clearInterval(fastRefreshTimer);
    }
    // Frequent checks allow near-immediate unblock after task completion/deletion.
    fastRefreshTimer = setInterval(() => {
        checkAndBlock();
    }, FAST_REFRESH_MS);
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECK_ALARM_NAME) {
        checkAndBlock();
    }
});

chrome.runtime.onInstalled.addListener(() => {
    scheduleChecks();
    startFastRefresh();
    checkAndBlock(true);
});

chrome.runtime.onStartup.addListener(() => {
    scheduleChecks();
    startFastRefresh();
    checkAndBlock(true);
});

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "REGISTER_CONTEXT_UPDATED") {
        checkAndBlock(true);
    }
    if (message?.type === "CHECK_BLOCKING_NOW") {
        checkAndBlock(true);
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!isBlockingEnabled) return;
    const targetUrl = changeInfo.url || tab?.url;
    if (isBlockedDomainUrl(targetUrl)) {
        chrome.tabs.update(tabId, { url: BLOCKED_PAGE_URL });
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.focusModeActive) {
        isBlockingEnabled = Boolean(changes.focusModeActive.newValue);
    }
    if (changes.registerId || changes.registerEmail || changes.userData) {
        checkAndBlock(true);
    }
});

// Also run once when service worker wakes up.
scheduleChecks();
startFastRefresh();
checkAndBlock(true);
