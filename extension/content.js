/**
 * EduNation AI Tutor — v2.1
 * Sidebar content script for YouTube lecture analysis.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

let BACKEND_URL = 'http://localhost:8000';

chrome.storage.sync.get(['backendUrl'], (res) => {
    if (res.backendUrl) BACKEND_URL = res.backendUrl;
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.backendUrl) {
        BACKEND_URL = changes.backendUrl.newValue || 'http://localhost:8000';
    }
});

// ── State ─────────────────────────────────────────────────────────────────────

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
let healthFailCount = 0;
let healthIntervalId = null;

const noteChatHistory = {};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

chrome.storage.local.get(["aiTutorEnabled"], (res) => {
    state.isEnabled = !!res.aiTutorEnabled;
    startObserver();
});

chrome.runtime.onMessage.addListener((req) => {
    if (req.command === "toggleTutor") {
        state.isEnabled = req.enabled;
        if (!state.isEnabled) hideAllUI();
        else recheckState();
    }
    if (req.command === "triggerExplain") {
        if (state.isEnabled && state.videoElement) { hideOverlay(); openSidebar(); }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'e' && state.isEnabled && state.videoElement) {
        e.preventDefault();
        hideOverlay();
        openSidebar();
    }
});

function startObserver() {
    const observer = new MutationObserver(() => {
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
        if (state.notes.length > 0) { refreshPanel(true); updateBadge(); }
    });
}

function handlePause() {
    if (!state.isEnabled) return;
    state.videoId = new URLSearchParams(window.location.search).get('v');
    if (!state.videoId) return;
    state.timestamp = state.videoElement.currentTime;
    showOverlay();
}

// ── Toast System ──────────────────────────────────────────────────────────────

function showToast(message, type = 'error') {
    const existing = document.getElementById('edu-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'edu-toast';
    toast.className = `edu-toast edu-toast-${type}`;
    toast.innerText = message;

    (panel || document.body).appendChild(toast);
    setTimeout(() => toast.classList.add('edu-toast-visible'), 10);
    setTimeout(() => {
        toast.classList.remove('edu-toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function showOverlay() {
    if (!overlayBtn) {
        overlayBtn = document.createElement('div');
        overlayBtn.className = 'edunation-button-overlay';
        overlayBtn.innerText = '✨ Explain this moment';
        const container = document.querySelector('.html5-video-player') ||
                          document.querySelector('#movie_player') || document.body;
        container.appendChild(overlayBtn);
        overlayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideOverlay();
            openSidebar();
        });
    }
    healthFailCount = 0;
    overlayBtn.style.display = 'block';
    if (!healthIntervalId) healthIntervalId = setInterval(checkHealth, 5000);
    checkHealth();
}

async function checkHealth() {
    if (!overlayBtn || !state.isEnabled) return;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const r = await fetch(`${BACKEND_URL}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (r.ok) {
            healthFailCount = 0;
            overlayBtn.innerText = '✨ Explain this moment';
            overlayBtn.style.background = '';
            overlayBtn.style.opacity = '1';
        } else throw new Error();
    } catch {
        healthFailCount++;
        if (healthFailCount <= 3) {
            overlayBtn.innerText = '🔄 Connecting…';
            overlayBtn.style.opacity = '0.75';
        } else {
            overlayBtn.innerText = '⚠️ Backend Offline';
            overlayBtn.style.background = 'rgba(180,0,0,0.65)';
            overlayBtn.style.opacity = '1';
        }
    }
}

function hideOverlay() {
    if (overlayBtn) overlayBtn.style.display = 'none';
    if (healthIntervalId) { clearInterval(healthIntervalId); healthIntervalId = null; }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function openSidebar(silent = false) {
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'edunation-panel';
        panel.innerHTML = `
            <div id="edunation-header">
                <span>📚 Study Timeline</span>
                <span id="edunation-close">&times;</span>
            </div>
            <div id="edunation-body"></div>
            <div id="edunation-footer">
                <input id="edunation-question" type="text" placeholder="Ask a specific question… (or leave blank to summarize)" />
                <div id="edunation-footer-btns">
                    <button id="edunation-btn-generate">✨ Analyze Concept</button>
                    <button id="edunation-btn-quiz" title="Generate quiz from your notes">🧪 Test Me</button>
                    <div id="edunation-export-btns">
                        <button id="edunation-btn-pdf" title="Export PDF">📄 PDF</button>
                        <button id="edunation-btn-md" title="Export Markdown">📝 MD</button>
                        <button id="edunation-btn-json" title="Export JSON">💾 JSON</button>
                        <button id="edunation-btn-anki" title="Export Anki CSV">🃏 Anki</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        document.getElementById('edunation-close').onclick = () => { panel.style.display = 'none'; };
        document.getElementById('edunation-btn-generate').onclick = generateNote;
        document.getElementById('edunation-btn-quiz').onclick = startQuiz;
        document.getElementById('edunation-btn-pdf').onclick = exportPDF;
        document.getElementById('edunation-btn-md').onclick = exportMarkdown;
        document.getElementById('edunation-btn-json').onclick = exportJSON;
        document.getElementById('edunation-btn-anki').onclick = exportAnki;
    }
    if (!silent) panel.style.display = 'flex';
    refreshPanel();
}

// ── Panel Rendering ───────────────────────────────────────────────────────────

const TAGS = ['#important', '#confusing', '#review'];
const DIFFICULTY_COLORS = {
    'Beginner': '#2e7d32',
    'Intermediate': '#e65100',
    'Advanced': '#b71c1c'
};

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function refreshPanel() {
    const list = document.getElementById('edunation-body');
    if (!list) return;
    if (state.notes.length === 0) {
        list.innerHTML = '<div class="edunation-empty">No notes yet.<br>Pause the video and click <strong>Analyze Concept</strong> to start.</div>';
        return;
    }
    list.innerHTML = '';
    [...state.notes]
        .sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp))
        .forEach(n => list.appendChild(buildNoteCard(n)));
    list.scrollTop = list.scrollHeight;
}

function buildNoteCard(note) {
    const el = document.createElement('div');
    el.className = 'note-card';
    el.dataset.uuid = note.uuid || '';
    const diffColor = DIFFICULTY_COLORS[note.difficulty] || '#555';
    const tagsHtml = TAGS.map(tag => {
        const active = (note.tags || []).includes(tag);
        return `<span class="note-tag${active ? ' active' : ''}" data-tag="${tag}">${tag}</span>`;
    }).join('');

    el.innerHTML = `
        <div class="note-card-top">
            <div class="note-meta-row">
                <span class="note-timestamp">${escapeHtml(note.timestamp)}</span>
                ${note.difficulty ? `<span class="note-difficulty" style="background:${diffColor}">${escapeHtml(note.difficulty)}</span>` : ''}
                <button class="note-delete-btn" title="Delete note">✕</button>
            </div>
            <div class="note-topic" contenteditable="true" data-field="topic">${escapeHtml(note.topic)}</div>
            <div class="note-key-idea" contenteditable="true" data-field="keyIdea">${escapeHtml(note.keyIdea)}</div>
            <div class="note-explanation" contenteditable="true" data-field="explanation">${escapeHtml(note.explanation)}</div>
            <div class="note-example">💡 ${escapeHtml(note.example)}</div>
        </div>
        <div class="note-tags-row">${tagsHtml}</div>
        <div class="note-chat-section">
            <button class="note-chat-toggle">💬 Ask a follow-up</button>
            <div class="note-chat-area" style="display:none">
                <div class="chat-messages"></div>
                <div class="chat-input-row">
                    <input type="text" class="chat-input" placeholder="Ask anything about this concept…" />
                    <button class="chat-send-btn">Send</button>
                </div>
            </div>
        </div>
    `;

    el.querySelector('.note-card-top').addEventListener('click', (e) => {
        if (e.target.getAttribute('contenteditable') === 'true') return;
        if (state.videoElement) { state.videoElement.currentTime = parseTs(note.timestamp); state.videoElement.play(); }
    });

    el.querySelector('.note-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteNote(note.uuid); });

    el.querySelectorAll('[contenteditable="true"]').forEach(field => {
        field.addEventListener('blur', () => {
            const target = state.notes.find(n => n.uuid === note.uuid);
            if (target) { target[field.dataset.field] = field.innerText.trim(); saveNotes(); }
        });
        field.addEventListener('click', (e) => e.stopPropagation());
    });

    el.querySelectorAll('.note-tag').forEach(tagEl => {
        tagEl.addEventListener('click', (e) => { e.stopPropagation(); toggleTag(note.uuid, tagEl.dataset.tag, tagEl); });
    });

    const chatToggle = el.querySelector('.note-chat-toggle');
    const chatArea = el.querySelector('.note-chat-area');
    chatToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = chatArea.style.display !== 'none';
        chatArea.style.display = isOpen ? 'none' : 'flex';
        if (!isOpen) restoreChatHistory(note, el.querySelector('.chat-messages'));
    });

    const chatInput = el.querySelector('.chat-input');
    const chatSendFn = () => sendChatMessage(note, chatInput, el.querySelector('.chat-messages'));
    el.querySelector('.chat-send-btn').addEventListener('click', chatSendFn);
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') chatSendFn(); });

    return el;
}

// ── Chat (SSE Streaming) ──────────────────────────────────────────────────────

function restoreChatHistory(note, messagesEl) {
    const history = note.chatHistory || [];
    messagesEl.innerHTML = '';
    history.forEach(msg => {
        const bubble = document.createElement('div');
        bubble.className = msg.role === 'user' ? 'chat-bubble user-bubble' : 'chat-bubble ai-bubble';
        bubble.innerText = msg.content;
        messagesEl.appendChild(bubble);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendChatMessage(note, inputEl, messagesEl) {
    const msg = inputEl.value.trim();
    if (!msg) return;
    if (!noteChatHistory[note.uuid]) noteChatHistory[note.uuid] = note.chatHistory ? [...note.chatHistory] : [];
    inputEl.value = '';

    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user-bubble';
    userBubble.innerText = msg;
    messagesEl.appendChild(userBubble);

    const aiBubble = document.createElement('div');
    aiBubble.className = 'chat-bubble ai-bubble';
    aiBubble.innerText = '…';
    messagesEl.appendChild(aiBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
        const res = await fetch(`${BACKEND_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: state.videoId, note, user_message: msg, chat_history: noteChatHistory[note.uuid] })
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        aiBubble.innerText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '));
            for (const line of lines) {
                const payload = line.slice(6);
                if (payload === '[DONE]') break;
                try {
                    const parsed = JSON.parse(payload);
                    if (parsed.token) { fullResponse += parsed.token; aiBubble.innerText = fullResponse; messagesEl.scrollTop = messagesEl.scrollHeight; }
                } catch { /* skip */ }
            }
        }

        noteChatHistory[note.uuid].push({ role: 'user', content: msg });
        noteChatHistory[note.uuid].push({ role: 'assistant', content: fullResponse });

        const target = state.notes.find(n => n.uuid === note.uuid);
        if (target) { target.chatHistory = noteChatHistory[note.uuid].slice(-20); saveNotes(); }
    } catch (err) {
        aiBubble.innerText = `⚠️ ${err.message}`;
    }
}

// ── CRUD (UUID-based) ─────────────────────────────────────────────────────────

function deleteNote(uuid) {
    const idx = state.notes.findIndex(n => n.uuid === uuid);
    if (idx === -1) return;
    state.notes.splice(idx, 1);
    saveNotes(); refreshPanel(); updateBadge();
}

function toggleTag(uuid, tag, tagEl) {
    const target = state.notes.find(n => n.uuid === uuid);
    if (!target) return;
    if (!target.tags) target.tags = [];
    const pos = target.tags.indexOf(tag);
    if (pos === -1) { target.tags.push(tag); tagEl.classList.add('active'); }
    else { target.tags.splice(pos, 1); tagEl.classList.remove('active'); }
    saveNotes();
}

function saveNotes() {
    if (!state.videoId) return;
    chrome.storage.local.set({
        [state.videoId]: { videoId: state.videoId, title: state.title, sections: state.notes, updatedAt: Date.now() }
    });
}

function updateBadge() {
    chrome.runtime.sendMessage({ command: 'updateBadge', count: state.notes.length });
}

// ── Fetch with Retry ──────────────────────────────────────────────────────────

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
                if (err.name === 'TypeError' && err.message === 'Failed to fetch')
                    throw new Error("Cannot reach backend. Make sure 'python main.py' is running.");
                throw err;
            }
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

// ── Generate Note ─────────────────────────────────────────────────────────────

async function generateNote() {
    const btn = document.getElementById('edunation-btn-generate');
    const questionInput = document.getElementById('edunation-question');
    const originalText = btn.innerText;
    btn.innerText = '⏳ Processing…';
    btn.disabled = true;

    const userQuestion = questionInput?.value?.trim() || "Summarize this part of the lecture.";

    try {
        const res = await fetchWithRetry(`${BACKEND_URL}/explain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: state.videoId, timestamp: state.videoElement.currentTime, user_question: userQuestion, context: "", chat_history: [] })
        });

        const data = await res.json();
        let note;
        try { note = JSON.parse(data.explanation); }
        catch { note = typeof data.explanation === 'object' ? data.explanation : null; }
        if (!note) throw new Error("AI returned an invalid format. Please try again.");

        if (typeof note.timestamp === 'number' || /^\d+$/.test(note.timestamp))
            note.timestamp = formatTs(parseInt(note.timestamp));

        note.uuid = crypto.randomUUID();
        note.tags = note.tags || [];
        note.chatHistory = [];

        state.notes.push(note);
        state.title = document.querySelector('h1.ytd-video-primary-info-renderer, #title h1')?.innerText?.trim() || "Video Notes";

        saveNotes();
        if (questionInput) questionInput.value = '';
        refreshPanel();
        updateBadge();
        showToast('✅ Note created!', 'success');
    } catch (err) {
        showToast(err.message || "An unexpected error occurred.");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// ── Timestamp Helpers ─────────────────────────────────────────────────────────

function parseTs(t) {
    if (typeof t === 'number') return t;
    if (!t || typeof t !== 'string') return 0;
    const p = t.split(':');
    if (p.length === 3) return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseInt(p[2]);
    if (p.length === 2) return parseInt(p[0]) * 60 + parseInt(p[1]);
    const s = parseInt(t);
    return isNaN(s) ? 0 : s;
}

function formatTs(seconds) {
    return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

// ── Exports ───────────────────────────────────────────────────────────────────

function exportPDF() {
    if (!window.jspdf) { showToast('PDF library not available. Please reload the page.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(20).setTextColor(21, 101, 192).text("EduNation Notes", 10, 20);
    doc.setFontSize(12).setTextColor(100).text(state.title, 10, 28);
    let y = 40;
    state.notes.forEach(n => {
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(9).setTextColor(150).text(`[${n.timestamp}]${n.difficulty ? ' · ' + n.difficulty : ''}`, 10, y);
        doc.setFontSize(14).setTextColor(0).setFont(undefined, 'bold').text(n.topic || '', 10, y + 6);
        y += 14;
        doc.setFontSize(11).setFont(undefined, 'italic').setTextColor(80);
        const ideaLines = doc.splitTextToSize(n.keyIdea || '', 180);
        doc.text(ideaLines, 10, y); y += ideaLines.length * 6 + 4;
        doc.setFont(undefined, 'normal').setTextColor(40);
        const expLines = doc.splitTextToSize(n.explanation || '', 180);
        doc.text(expLines, 10, y); y += expLines.length * 6 + 4;
        doc.setTextColor(100);
        const exLines = doc.splitTextToSize(`Example: ${n.example || ''}`, 180);
        doc.text(exLines, 10, y); y += exLines.length * 6 + 12;
    });
    doc.save(`EduNation-Notes-${state.videoId}.pdf`);
    showToast('📄 PDF exported!', 'success');
}

function exportMarkdown() {
    let md = `# ${state.title}\n\n> Exported from EduNation AI Tutor\n\n---\n\n`;
    [...state.notes].sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp)).forEach(n => {
        md += `## ${n.topic}\n**Timestamp:** \`${n.timestamp}\``;
        if (n.difficulty) md += ` · **Difficulty:** ${n.difficulty}`;
        if (n.tags?.length) md += ` · **Tags:** ${n.tags.join(' ')}`;
        md += `\n\n> ${n.keyIdea}\n\n${n.explanation}\n\n**Example:** ${n.example}\n\n---\n\n`;
    });
    downloadFile(`EduNation-${state.videoId}.md`, md, 'text/markdown');
    showToast('📝 Markdown exported!', 'success');
}

function exportJSON() {
    chrome.storage.local.get(null, (data) => {
        const exportData = {};
        Object.keys(data).forEach(k => { if (k !== 'aiTutorEnabled') exportData[k] = data[k]; });
        downloadFile('EduNation-backup.json', JSON.stringify(exportData, null, 2), 'application/json');
        showToast('💾 JSON backup saved!', 'success');
    });
}

function exportAnki() {
    const rows = [['Front', 'Back']];
    state.notes.forEach(n => {
        const front = `${n.topic}\n\n${n.keyIdea}`;
        const back = `${n.explanation}\n\nExample: ${n.example}\n\nTimestamp: ${n.timestamp}`;
        rows.push([`"${front.replace(/"/g, '""')}"`, `"${back.replace(/"/g, '""')}"`]);
    });
    downloadFile(`EduNation-Anki-${state.videoId}.csv`, rows.map(r => r.join(',')).join('\n'), 'text/csv');
    showToast('🃏 Anki CSV exported!', 'success');
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

// ── Quiz ──────────────────────────────────────────────────────────────────────

async function startQuiz() {
    if (state.notes.length === 0) { showToast('Generate at least one note before taking a quiz!', 'info'); return; }
    const body = document.getElementById('edunation-body');
    const quizBtn = document.getElementById('edunation-btn-quiz');
    if (!body || !quizBtn) return;

    body.innerHTML = `
        <div class="quiz-loading">
            <div class="quiz-spinner"></div>
            <p>Generating your quiz…</p>
            <p style="font-size:11px;color:#aaa;margin-top:4px;">Analyzing your ${state.notes.length} note${state.notes.length !== 1 ? 's' : ''}</p>
        </div>`;
    quizBtn.disabled = true;

    try {
        const res = await fetchWithRetry(`${BACKEND_URL}/quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: state.videoId, notes: state.notes })
        });
        const data = await res.json();
        if (!data.questions?.length) throw new Error('No questions returned from server.');
        renderQuiz(data.questions);
    } catch (err) {
        body.innerHTML = `<div class="edunation-empty">⚠️ Quiz failed: ${err.message}<br><br><button onclick="this.closest('#edunation-body') && refreshPanel()" style="padding:6px 12px;background:#f59e0b;color:black;border:none;border-radius:6px;cursor:pointer;font-weight:700;">← Back to Notes</button></div>`;
    } finally {
        quizBtn.disabled = false;
    }
}

function renderQuiz(questions) {
    const body = document.getElementById('edunation-body');
    if (!body) return;
    let currentQ = 0, score = 0, answered = false;

    function showQuestion() {
        const q = questions[currentQ];
        answered = false;
        body.innerHTML = `
            <div class="quiz-panel">
                <div class="quiz-progress">
                    <span>Question ${currentQ + 1} of ${questions.length}</span>
                    <span class="quiz-score-pill">Score: ${score}/${currentQ}</span>
                </div>
                <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${(currentQ / questions.length) * 100}%"></div></div>
                <div class="quiz-question">${q.question}</div>
                <div class="quiz-options">${q.options.map((opt, i) => `<div class="quiz-option" data-index="${i}">${String.fromCharCode(65 + i)}. ${opt}</div>`).join('')}</div>
                <div class="quiz-explanation" id="quiz-explanation" style="display:none"><strong>💡 Explanation:</strong> ${q.explanation}</div>
                <button class="quiz-next-btn" id="quiz-next-btn" style="display:none">${currentQ === questions.length - 1 ? 'See Results →' : 'Next Question →'}</button>
            </div>`;

        body.querySelectorAll('.quiz-option').forEach(optEl => {
            optEl.addEventListener('click', () => {
                if (answered) return;
                answered = true;
                const chosen = parseInt(optEl.dataset.index);
                body.querySelectorAll('.quiz-option').forEach((el, i) => {
                    if (i === q.correct) el.classList.add('correct');
                    else if (i === chosen) el.classList.add('wrong');
                    el.style.pointerEvents = 'none';
                });
                if (chosen === q.correct) score++;
                document.getElementById('quiz-explanation').style.display = 'block';
                document.getElementById('quiz-next-btn').style.display = 'block';
            });
        });

        document.getElementById('quiz-next-btn').addEventListener('click', () => {
            currentQ++;
            currentQ < questions.length ? showQuestion() : showResult();
        });
    }

    function showResult() {
        const pct = Math.round((score / questions.length) * 100);
        const emoji = pct === 100 ? '🏆' : pct >= 80 ? '🎉' : pct >= 60 ? '📚' : '💪';
        const msg = pct === 100 ? 'Perfect score!' : pct >= 80 ? 'Great job!' : pct >= 60 ? 'Good effort!' : 'Keep studying!';
        body.innerHTML = `
            <div class="quiz-result">
                <div class="quiz-result-emoji">${emoji}</div>
                <div class="quiz-result-score">${score} / ${questions.length}</div>
                <div class="quiz-result-pct">${pct}% correct</div>
                <div class="quiz-result-msg">${msg}</div>
                <div class="quiz-result-bar"><div class="quiz-result-fill" style="width:${pct}%"></div></div>
                <button class="quiz-back-btn" id="quiz-back-btn">← Back to Notes</button>
            </div>`;
        document.getElementById('quiz-back-btn').addEventListener('click', refreshPanel);
    }

    showQuestion();
}

// ── Misc ──────────────────────────────────────────────────────────────────────

function hideAllUI() {
    hideOverlay();
    if (panel) panel.style.display = 'none';
}
