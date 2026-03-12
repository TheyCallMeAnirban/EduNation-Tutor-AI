chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ aiTutorEnabled: false });
});

// Since we use chrome.storage.local in content.js directly now,
// the background script just handles installation setup.
