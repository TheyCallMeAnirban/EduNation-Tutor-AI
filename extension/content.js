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
        const vid = document.querySelector('video');
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
    
    // Quick health check
    fetch('http://127.0.0.1:8000/health')
        .then(r => overlayBtn.innerText = r.ok ? '✨ Explain this moment' : '⚠️ Offline')
        .catch(() => overlayBtn.innerText = '⚠️ Offline');
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
    const p = t.split(':');
    return p.length === 2 ? parseInt(p[0]) * 60 + parseInt(p[1]) : 0;
}

async function generateNote() {
    const btn = document.getElementById('edunation-btn-generate');
    btn.innerText = 'Processing...';
    btn.disabled = true;

    try {
        const res = await fetch('http://127.0.0.1:8000/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                video_id: state.videoId,
                timestamp: state.videoElement.currentTime,
                user_question: "Summarize this part of the lecture.",
                context: ""
            })
        });

        if (!res.ok) throw new Error();
        const data = await res.json();
        const note = JSON.parse(data.explanation);

        state.notes.push(note);
        state.title = document.querySelector('h1.ytd-video-primary-info-renderer, #title h1')?.innerText?.trim() || "Video Notes";
        
        chrome.storage.local.set({ [state.videoId]: {
            videoId: state.videoId,
            title: state.title,
            sections: state.notes,
            updatedAt: Date.now()
        }});
        
        refreshPanel();
    } catch {
        alert("Failed to connect to tutor backend.");
    } finally {
        btn.innerText = 'Analyze Concept';
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
