// content.js
(() => {
    // Wait until user data is stored by React app
    setInterval(() => {
        const userData = window.localStorage.getItem('userData') || window.localStorage.getItem('user');
        if (userData) {
            try {
                const parsed = JSON.parse(userData);
                const registerId = parsed?.registerId || parsed?.registerID || parsed?.id || parsed?.userId;
                const email = parsed?.email || null;

                if (registerId || email) {
                    chrome.storage.local.set(
                        {
                            ...(registerId ? { registerId } : {}),
                            ...(email ? { registerEmail: email } : {}),
                            userData: parsed
                        },
                        () => {
                            chrome.runtime.sendMessage({ type: 'REGISTER_CONTEXT_UPDATED' });
                        }
                    );
                }
            } catch (err) {
                console.error('Failed to parse userData from localStorage', err);
            }
        }
    }, 2000); // check every 2 seconds
})();