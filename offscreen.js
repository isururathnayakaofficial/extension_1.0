(() => {
    const REFRESH_MS = 3000;

    function triggerRefresh() {
        chrome.runtime.sendMessage({ type: "CHECK_BLOCKING_NOW" }, () => {
            void chrome.runtime.lastError;
        });
    }

    triggerRefresh();
    setInterval(triggerRefresh, REFRESH_MS);
})();