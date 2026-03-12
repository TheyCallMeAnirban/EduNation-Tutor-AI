const toggle = document.getElementById("toggle-tutor");
const statusText = document.getElementById("status-text");

// Load state
chrome.storage.local.get(["aiTutorEnabled"], (result) => {
    if (toggle) {
        toggle.checked = !!result.aiTutorEnabled;
        updateStatusText(toggle.checked);
    }
});

if (toggle) {
    toggle.addEventListener("change", (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.local.set({ aiTutorEnabled: isEnabled });
        updateStatusText(isEnabled);
        
        // Notify content scripts
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { command: "toggleTutor", enabled: isEnabled }).catch(err => {
                    console.log("Error sending message to tab:", err);
                });
            }
        });
    });
}

function updateStatusText(enabled) {
    if (statusText) {
        statusText.innerText = enabled ? "Active on YouTube videos." : "Turn on to start tracking lectures.";
    }
}

// Open History Dashboard
const notebookBtn = document.getElementById("notebook-btn");
if (notebookBtn) {
    notebookBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
    });
}
