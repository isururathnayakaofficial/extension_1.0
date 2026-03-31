// Background service worker – fetches tasks and updates blocking rules

const REGISTERED_ID = '123';  // 👈 Hardcoded ID – change to your actual ID

const BLOCKED_PAGE = chrome.runtime.getURL('blocked.html');

// Predefined distracting domains
const SOCIAL_DOMAINS = [
    'facebook.com',
    'twitter.com',
    'instagram.com',
    'youtube.com',
    'tiktok.com',
    'reddit.com',
    'netflix.com',
    'twitch.tv'
];

// Map domain to rule ID (starting from 1000)
const DOMAIN_TO_RULE_ID = {};
SOCIAL_DOMAINS.forEach((domain, idx) => {
    DOMAIN_TO_RULE_ID[domain] = 1000 + idx;
});

// Helper: fetch tasks from backend
async function fetchTasks() {
    const url = `http://localhost:8081/api/todo/get/${REGISTERED_ID}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const tasks = await response.json();
        return tasks;
    } catch (err) {
        console.error('Failed to fetch tasks:', err);
        return [];
    }
}

// Helper: check if any task is active now
function isAnyTaskActive(tasks) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    for (const task of tasks) {
        // Skip completed/cancelled tasks
        const status = (task.status || '').toUpperCase();
        if (status === 'COMPLETED' || status === 'DONE' || status === 'CANCELLED') {
            continue;
        }

        // Compare date
        const taskDate = task.date;
        if (taskDate !== todayStr) continue;

        // Parse start and end times (assume "HH:MM" format)
        const [startHour, startMin] = task.startTime.split(':').map(Number);
        const [endHour, endMin] = task.endTime.split(':').map(Number);

        const start = new Date(now);
        start.setHours(startHour, startMin, 0, 0);
        const end = new Date(now);
        end.setHours(endHour, endMin, 0, 0);

        if (now >= start && now <= end) {
            return true; // at least one active task
        }
    }
    return false;
}

// Update declarativeNetRequest rules based on active status
async function updateBlockingRules(shouldBlock) {
    // Get current dynamic rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();

    // Determine which of our rule IDs are currently present
    const existingRuleIds = existingRules.map(rule => rule.id);
    const ourRuleIds = Object.values(DOMAIN_TO_RULE_ID);

    // Remove all our rules if they exist
    const idsToRemove = existingRuleIds.filter(id => ourRuleIds.includes(id));
    if (idsToRemove.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: idsToRemove
        });
    }

    if (shouldBlock) {
        // Create new rules: one per domain, redirect to blocked page
        const newRules = [];
        for (const [domain, ruleId] of Object.entries(DOMAIN_TO_RULE_ID)) {
            newRules.push({
                id: ruleId,
                priority: 1,
                action: {
                    type: 'redirect',
                    redirect: { url: BLOCKED_PAGE }
                },
                condition: {
                    urlFilter: `*://*.${domain}/*`,
                    resourceTypes: ['main_frame']
                }
            });
        }
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: newRules
        });
    }

    // Update badge text
    chrome.action.setBadgeText({ text: shouldBlock ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
}

// Main logic: fetch tasks, decide if blocking needed, update rules
async function refreshBlockingStatus() {
    const tasks = await fetchTasks();
    const active = isAnyTaskActive(tasks);
    await updateBlockingRules(active);
}

// Set up periodic check (every minute)
chrome.alarms.create('refreshBlocking', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'refreshBlocking') refreshBlockingStatus();
});

// Initial check on service worker start
refreshBlockingStatus();

// Optional: on startup, ensure rules are set
chrome.runtime.onStartup.addListener(() => {
    refreshBlockingStatus();
});