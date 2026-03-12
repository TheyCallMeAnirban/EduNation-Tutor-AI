/**
 * EduNation AI Tutor
 */

let state = {
    isEnabled: false,
    videoId: null,
    timestamp: 0,
    videoElement: null,
    notes: [],
    title: "Video Notes"
};

let overlayBtn = null;
let panel = null;

// Initialization
chrome.storage.local.get(["aiTutorEnabled"], (res) => {
    state.isEnabled = !!res.aiTutorEnabled;
    startObserver();
});

chrome.runtime.onMessage.addListener((req) => {
    if (req.command === "toggleTutor") {
        state.isEnabled = req.enabled;
        if (!state.isEnabled) {
            hideAllUI();
        } else {
            recheckState();
        }
    }
});

function startObserver() {
    const observer = new MutationObserver(() => {
        // More specific selector for the main YouTube video player
        const vid = document.querySelector('video.video-stream.html5-main-video');
        if (vid && vid !== state.videoElement) {
            state.videoElement = vid;
            state.videoElement.addEventListener('pause', handlePause);
            state.videoElement.addEventListener('play', () => hideOverlay());
            
            recheckState();
            loadSavedNotes();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function recheckState() {
    if (state.isEnabled && state.videoElement?.paused) handlePause();
}

function loadSavedNotes() {
    state.videoId = new URLSearchParams(window.location.search).get('v');
    if (!state.videoId) return;

    chrome.storage.local.get([state.videoId], (res) => {
        const data = res[state.videoId];
        state.notes = data?.sections || [];
        state.title = data?.title || "Video Notes";
        if (state.notes.length > 0) refreshPanel(true);
    });
}

function handlePause() {
    if (!state.isEnabled) return;
    state.videoId = new URLSearchParams(window.location.search).get('v');
    if (!state.videoId) return;

    state.timestamp = state.videoElement.currentTime;
    showOverlay();
}

function showOverlay() {
    if (!overlayBtn) {
        overlayBtn = document.createElement('div');
        overlayBtn.className = 'edunation-button-overlay';
        overlayBtn.innerText = '✨ Explain this moment';
        
        const container = document.querySelector('.html5-video-player') || 
                          document.querySelector('#movie_player') || 
                          document.body;
        container.appendChild(overlayBtn);
        
        overlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideOverlay();
            openSidebar();
        });
    }

    overlayBtn.style.display = 'block';
    
    // Periodically check health if enabled
    if (!window.healthInterval) {
        window.healthInterval = setInterval(checkHealth, 5000);
    }
    checkHealth();
}

const BACKEND_URL = 'http://localhost:8000';

async function checkHealth() {
    if (!overlayBtn || !state.isEnabled) return;
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout
        
        const r = await fetch(`${BACKEND_URL}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (r.ok) {
            if (overlayBtn.innerText === '⚠️ Offline' || overlayBtn.innerText === '🔄 Connecting...') {
                overlayBtn.innerText = '✨ Explain this moment';
                overlayBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            }
        } else {
            throw new Error();
        }
    } catch (e) {
        overlayBtn.innerText = '⚠️ Offline';
        overlayBtn.style.background = 'rgba(255, 0, 0, 0.2)';
    }
}

function hideOverlay() {
    if (overlayBtn) overlayBtn.style.display = 'none';
}

function openSidebar(silent = false) {
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'edunation-panel';
        panel.innerHTML = `
            <div id="edunation-header">
                Study Timeline
                <span id="edunation-close">&times;</span>
            </div>
            <div id="edunation-body"></div>
            <div id="edunation-footer">
                <button id="edunation-btn-generate">Analyze Concept</button>
                <button id="edunation-btn-pdf">Export PDF</button>
            </div>
        `;
        document.body.appendChild(panel);
        
        document.getElementById('edunation-close').onclick = () => panel.style.display = 'none';
        document.getElementById('edunation-btn-generate').onclick = generateNote;
        document.getElementById('edunation-btn-pdf').onclick = exportPDF;
    }

    if (!silent) panel.style.display = 'flex';
    refreshPanel();
}

function refreshPanel() {
    const list = document.getElementById('edunation-body');
    if (!list) return;

    if (state.notes.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:#888; margin-top:20px;">No notes yet. Pause to start.</div>';
        return;
    }

    list.innerHTML = '';
    [...state.notes].sort((a,b) => parseTs(a.timestamp) - parseTs(b.timestamp)).forEach(n => {
        const el = document.createElement('div');
        el.className = 'note-card';
        el.innerHTML = `
            <div class="note-timestamp">${n.timestamp}</div>
            <div class="note-topic">${n.topic}</div>
            <div class="note-key-idea">${n.keyIdea}</div>
            <div class="note-explanation">${n.explanation}</div>
            <div class="note-example">Example: ${n.example}</div>
        `;
        el.onclick = () => {
            state.videoElement.currentTime = parseTs(n.timestamp);
            state.videoElement.play();
        };
        list.appendChild(el);
    });
    list.scrollTop = list.scrollHeight;
}

function parseTs(t) {
    if (typeof t === 'number') return t;
    if (!t || typeof t !== 'string') return 0;
    
    // Check for M:SS or H:M:SS
    const p = t.split(':');
    if (p.length === 3) {
        return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseInt(p[2]);
    } else if (p.length === 2) {
        return parseInt(p[0]) * 60 + parseInt(p[1]);
    }
    
    // Fallback to raw seconds
    const s = parseInt(t);
    return isNaN(s) ? 0 : s;
}

function formatTs(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function fetchWithRetry(url, options, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.detail || `Server error: ${res.status}`);
            }
            return res;
        } catch (err) {
            if (i === retries) {
                if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
                    throw new Error("Cannot reach backend server. Please ensure 'python main.py' is running in the backend folder.");
                }
                throw err;
            }
            console.log(`Retrying... (${i + 1}/${retries})`);
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

async function generateNote() {
    const btn = document.getElementById('edunation-btn-generate');
    const originalText = btn.innerText;
    btn.innerText = 'Processing...';
    btn.disabled = true;

    const currentTime = state.videoElement.currentTime;
    console.log(`[EduNation] Generating note for video ${state.videoId} at ${currentTime}s`);

    try {
        const res = await fetchWithRetry(`${BACKEND_URL}/explain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                video_id: state.videoId,
                timestamp: currentTime,
                user_question: "Summarize this part of the lecture.",
                context: ""
            })
        });

        const data = await res.json();
        let note;
        try {
            note = JSON.parse(data.explanation);
        } catch (e) {
            note = typeof data.explanation === 'object' ? data.explanation : null;
            if (!note) throw new Error("AI returned an invalid format. Please try again.");
        }

        // Ensure timestamp is formatted for display
        if (typeof note.timestamp === 'number' || /^\d+$/.test(note.timestamp)) {
            note.timestamp = formatTs(parseInt(note.timestamp));
        }

        state.notes.push(note);
        state.title = document.querySelector('h1.ytd-video-primary-info-renderer, #title h1')?.innerText?.trim() || "Video Notes";
        
        chrome.storage.local.set({ [state.videoId]: {
            videoId: state.videoId,
            title: state.title,
            sections: state.notes,
            updatedAt: Date.now()
        }});
        
        refreshPanel();
    } catch (err) {
        alert(err.message || "An unexpected error occurred.");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(20).setTextColor(21, 101, 192).text("EduNation Notes", 10, 20);
    doc.setFontSize(12).setTextColor(100).text(state.title, 10, 28);
    
    let y = 40;
    state.notes.forEach(n => {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFontSize(10).setTextColor(150).text(`[${n.timestamp}]`, 10, y);
        doc.setFontSize(14).setTextColor(0).setFont(undefined, 'bold').text(n.topic, 25, y);
        y += 7;
        doc.setFontSize(11).setFont(undefined, 'italic').setTextColor(80).text(n.keyIdea, 25, y, {maxWidth: 170});
        y += 10;
        doc.setFont(undefined, 'normal').setTextColor(40);
        const lines = doc.splitTextToSize(n.explanation, 170);
        doc.text(lines, 25, y);
        y += (lines.length * 6) + 12;
    });
    doc.save(`Notes-${state.videoId}.pdf`);
}

function hideAllUI() {
    hideOverlay();
    if (panel) panel.style.display = 'none';
}
