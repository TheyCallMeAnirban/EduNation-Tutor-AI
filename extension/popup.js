const toggle       = document.getElementById("toggle-tutor");
const statusText   = document.getElementById("status-text");
const dueBanner    = document.getElementById("due-banner");
const dueCountText = document.getElementById("due-count-text");
const statNotes    = document.getElementById("stat-notes");
const statVideos   = document.getElementById("stat-videos");
const statDue      = document.getElementById("stat-due");
const urlInput     = document.getElementById("backend-url-input");
const saveUrlBtn   = document.getElementById("save-url-btn");
const urlSavedMsg  = document.getElementById("url-saved-msg");

// ── Load toggle state ─────────────────────────────────────────────────────────

chrome.storage.local.get(["aiTutorEnabled"], (result) => {
    if (toggle) {
        toggle.checked = !!result.aiTutorEnabled;
        updateStatusText(toggle.checked);
    }
});

// ── Load backend URL ──────────────────────────────────────────────────────────

chrome.storage.sync.get(['backendUrl'], (res) => {
    if (urlInput) urlInput.value = res.backendUrl || 'http://localhost:8000';
});

// ── Compute stats from storage ────────────────────────────────────────────────

chrome.storage.local.get(null, (data) => {
    const now = Date.now();
    let noteCount = 0;
    let videoCount = 0;
    let dueCount = 0;

    Object.keys(data).forEach(k => {
        if (k === 'aiTutorEnabled') return;
        const col = data[k];
        if (!col || !col.sections) return;
        videoCount++;
        col.sections.forEach(note => {
            noteCount++;
            if (!note.sm2 || now >= note.sm2.nextReview) dueCount++;
        });
    });

    if (statNotes)  statNotes.textContent  = noteCount;
    if (statVideos) statVideos.textContent = videoCount;
    if (statDue)    statDue.textContent    = dueCount;

    if (dueCount > 0 && dueBanner) {
        dueBanner.style.display = 'block';
        if (dueCountText) dueCountText.textContent = `${dueCount} card${dueCount !== 1 ? 's' : ''} due for review`;
    }
});

// ── Toggle handler ────────────────────────────────────────────────────────────

if (toggle) {
    toggle.addEventListener("change", (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.local.set({ aiTutorEnabled: isEnabled });
        updateStatusText(isEnabled);

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { command: "toggleTutor", enabled: isEnabled }).catch(() => {});
            }
        });
    });
}

function updateStatusText(enabled) {
    if (statusText) {
        statusText.innerText = enabled
            ? "✅ Active — pause a video to analyze."
            : "Turn on to start tracking lectures.";
    }
}

// ── Notebook button ───────────────────────────────────────────────────────────

const notebookBtn = document.getElementById("notebook-btn");
if (notebookBtn) {
    notebookBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
    });
}

if (dueBanner) {
    dueBanner.addEventListener("click", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("history.html") + "#review" });
    });
}

// ── Backend URL save ──────────────────────────────────────────────────────────

if (saveUrlBtn) {
    saveUrlBtn.addEventListener("click", () => {
        const url = (urlInput?.value || '').trim() || 'http://localhost:8000';
        chrome.storage.sync.set({ backendUrl: url }, () => {
            // Notify active tab so content script picks up change immediately
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { command: "updateBackendUrl", url }).catch(() => {});
                }
            });
            if (urlSavedMsg) {
                urlSavedMsg.style.display = 'block';
                setTimeout(() => { urlSavedMsg.style.display = 'none'; }, 2500);
            }
        });
    });
}
