// background.js — EduNation AI v2.0 + Spaced Repetition

// ── Due card count on startup ─────────────────────────────────────────────────
function updateDueBadge() {
    chrome.storage.local.get(null, (data) => {
        const now = Date.now();
        let dueCount = 0;

        Object.keys(data).forEach(k => {
            if (k === 'aiTutorEnabled') return;
            const col = data[k];
            if (!col || !col.sections) return;
            col.sections.forEach(note => {
                // Never reviewed OR nextReview has passed
                if (!note.sm2 || now >= note.sm2.nextReview) dueCount++;
            });
        });

        chrome.action.setBadgeText({ text: dueCount > 0 ? String(dueCount) : '' });
        chrome.action.setBadgeBackgroundColor({ color: dueCount > 0 ? '#e65100' : '#1565C0' });
    });
}

// Run on startup and after storage changes
chrome.runtime.onStartup.addListener(updateDueBadge);
chrome.runtime.onInstalled.addListener(updateDueBadge);

// ── Messages from content script / history page ────────────────────────────
chrome.runtime.onMessage.addListener((req) => {
    if (req.command === 'updateBadge') {
        // Content script sends note count; history sends due count
        // Re-calculate from storage for accuracy
        updateDueBadge();
    }
});

// ── Keyboard shortcut → active tab ────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
    if (command === 'trigger-explain') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { command: 'triggerExplain' }).catch(() => {});
            }
        });
    }
});
