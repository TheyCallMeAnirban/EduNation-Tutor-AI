// history.js — EduNation AI v2.0 + Spaced Repetition
document.addEventListener("DOMContentLoaded", () => {
    let allNotes = [];      // flat: { note, title, videoId, storageKey }
    let filteredNotes = [];
    let fcIndex = 0;
    let fcFlipped = false;
    let currentMode = 'notes';

    const notesContainer  = document.getElementById("notes-container");
    const loading         = document.getElementById("loading");
    const emptyState      = document.getElementById("empty-state");
    const searchInput     = document.getElementById("search-input");
    const noteCountEl     = document.getElementById("note-count");
    const dueBadge        = document.getElementById("due-badge");
    const flashcardView   = document.getElementById("flashcard-view");
    const reviewView      = document.getElementById("review-view");
    const reviewBody      = document.getElementById("review-body");

    // Mode buttons
    document.getElementById("btn-notes-view").addEventListener("click",  () => switchMode('notes'));
    document.getElementById("btn-flash-view").addEventListener("click",  () => switchMode('flashcard'));
    document.getElementById("btn-review-view").addEventListener("click", () => switchMode('review'));
    document.getElementById("due-badge").addEventListener("click",       () => switchMode('review'));

    // Search
    searchInput.addEventListener("input", () => applyFilter(searchInput.value.trim().toLowerCase()));

    // Exports
    document.getElementById("btn-export-md").addEventListener("click",   exportMarkdown);
    document.getElementById("btn-export-json").addEventListener("click", exportJSON);
    document.getElementById("btn-export-anki").addEventListener("click", exportAnki);
    document.getElementById("btn-import-json").addEventListener("click", () => document.getElementById("json-file-input").click());
    document.getElementById("json-file-input").addEventListener("change", importJSON);

    // Flashcard nav
    document.getElementById("fc-prev").addEventListener("click",          () => navigateFC(-1));
    document.getElementById("fc-next").addEventListener("click",          () => navigateFC(1));
    document.getElementById("flashcard-wrapper").addEventListener("click", flipCard);
    document.addEventListener("keydown", (e) => {
        if (currentMode === 'flashcard') {
            if (e.key === "ArrowRight") navigateFC(1);
            if (e.key === "ArrowLeft")  navigateFC(-1);
            if (e.key === " ")          { e.preventDefault(); flipCard(); }
        }
    });

    loadLocalNotes();

    // ── SM-2 Algorithm ────────────────────────────────────────────────────────

    /**
     * Update a note's SM-2 metadata in-place.
     * @param {Object} note  - note object (modified in-place)
     * @param {number} q     - quality: 1=Hard, 3=Good, 5=Easy
     */
    function sm2Update(note, q) {
        if (!note.sm2) {
            note.sm2 = { repetitions: 0, easiness: 2.5, interval: 1, nextReview: Date.now() };
        }
        const s = note.sm2;

        // Always update easiness (including on Hard)
        s.easiness = Math.max(1.3, s.easiness + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));

        if (q >= 3) {
            if (s.repetitions === 0)      s.interval = 1;
            else if (s.repetitions === 1) s.interval = 6;
            else                          s.interval = Math.round(s.interval * s.easiness);
            s.repetitions += 1;
        } else {
            // Failed — reset repetitions and interval but keep easiness penalty
            s.repetitions = 0;
            s.interval = 1;
        }

        const msPerDay = 86400000;
        s.nextReview = Date.now() + s.interval * msPerDay;
    }

    function isDue(note) {
        if (!note.sm2) return true;   // never reviewed = always due
        return Date.now() >= note.sm2.nextReview;
    }

    function getDueNotes() {
        return allNotes.filter(({ note }) => isDue(note));
    }

    function dueCountText(count) {
        return count > 0 ? `📅 ${count} card${count !== 1 ? 's' : ''} due` : '';
    }

    function refreshDueBadge() {
        const count = getDueNotes().length;
        dueBadge.style.display = count > 0 ? 'inline-block' : 'none';
        dueBadge.textContent = dueCountText(count);
        chrome.runtime.sendMessage({ command: 'updateBadge', count }).catch(() => {});
    }

    // ── Data Loading ──────────────────────────────────────────────────────────

    function loadLocalNotes() {
        chrome.storage.local.get(null, (data) => {
            loading.style.display = 'none';

            const videoKeys = Object.keys(data).filter(k => k !== 'aiTutorEnabled');
            if (videoKeys.length === 0) {
                emptyState.style.display = 'block';
                return;
            }

            allNotes = [];
            const collections = videoKeys
                .map(k => data[k])
                .filter(c => c && c.sections)
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

            collections.forEach(col => {
                col.sections.forEach(note => {
                    allNotes.push({
                        note,
                        title: col.title || 'Untitled Video',
                        videoId: col.videoId,
                        storageKey: col.videoId
                    });
                });
            });

            noteCountEl.textContent = `${allNotes.length} note${allNotes.length !== 1 ? 's' : ''}`;
            filteredNotes = [...allNotes];
            refreshDueBadge();
            renderStatsBar(allNotes, videoKeys.length);
            renderNotes();
        });
    }

    /** Persist SM-2 changes back to storage — uses UUID as stable key, falls back to topic+timestamp */
    function persistNote(entry) {
        chrome.storage.local.get([entry.storageKey], (data) => {
            const col = data[entry.storageKey];
            if (!col || !col.sections) return;
            const idx = col.sections.findIndex(n =>
                (entry.note.uuid && n.uuid === entry.note.uuid) ||
                (n.topic === entry.note.topic && n.timestamp === entry.note.timestamp)
            );
            if (idx !== -1) {
                col.sections[idx] = entry.note;
                col.updatedAt = Date.now();
                chrome.storage.local.set({ [entry.storageKey]: col });
            }
        });
    }

    // ── Stats Bar ────────────────────────────────────────────────────────────

    function renderStatsBar(notes, videoCount) {
        const statsBar = document.getElementById('stats-bar');
        if (!statsBar) return;
        const now = Date.now();
        const dueCount = notes.filter(({ note }) => !note.sm2 || now >= note.sm2.nextReview).length;
        const diffCounts = {};
        notes.forEach(({ note }) => { if (note.difficulty) diffCounts[note.difficulty] = (diffCounts[note.difficulty] || 0) + 1; });
        const topDiff = Object.entries(diffCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

        document.getElementById('sb-notes').textContent  = notes.length;
        document.getElementById('sb-videos').textContent = videoCount;
        document.getElementById('sb-due').textContent    = dueCount;
        document.getElementById('sb-diff').textContent   = topDiff;
        statsBar.style.display = 'flex';
    }

    function applyFilter(query) {
        if (!query) {
            filteredNotes = [...allNotes];
        } else {
            filteredNotes = allNotes.filter(({ note, title }) => {
                const haystack = [
                    note.topic, note.keyIdea, note.explanation,
                    note.example, title, ...(note.tags || [])
                ].join(' ').toLowerCase();
                return haystack.includes(query);
            });
        }
        renderNotes();
        if (currentMode === 'flashcard') { fcIndex = 0; fcFlipped = false; renderFlashcard(); }
    }

    // ── Notes View ────────────────────────────────────────────────────────────

    function renderNotes() {
        notesContainer.innerHTML = '';
        if (filteredNotes.length === 0) {
            notesContainer.innerHTML = '<div style="text-align:center;color:#aaa;margin-top:40px;">No notes match your search.</div>';
            return;
        }

        const DIFF_COLORS = { 'Beginner': '#2e7d32', 'Intermediate': '#e65100', 'Advanced': '#b71c1c' };

        filteredNotes.forEach((entry, i) => {
            const { note, title, videoId } = entry;
            const card = document.createElement('div');
            card.className = 'note-card';

            const youtubeLink = `https://www.youtube.com/watch?v=${videoId}&t=${parseTs(note.timestamp)}s`;
            const diffColor = DIFF_COLORS[note.difficulty] || '#555';
            const tagsHtml = (note.tags || []).map(t => `<span class="badge-tag">${t}</span>`).join('');

            // SM-2 due/reviewed badge
            let sm2Html = '';
            if (isDue(note)) {
                sm2Html = `<span class="badge-due">📅 Due</span>`;
            } else if (note.sm2 && note.sm2.repetitions > 0) {
                const days = Math.round((note.sm2.nextReview - Date.now()) / 86400000);
                sm2Html = `<span class="badge-reviewed">✓ Review in ${days}d</span>`;
            }

            card.innerHTML = `
                <div class="note-header">
                    <div class="note-header-left">
                        <h2 class="note-topic">${note.topic}</h2>
                        <div class="note-meta">
                            <span class="badge-ts">${note.timestamp}</span>
                            ${note.difficulty ? `<span class="badge-diff" style="background:${diffColor}">${note.difficulty}</span>` : ''}
                            ${tagsHtml}
                            ${sm2Html}
                            <span class="badge-video">📺 ${title}</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;align-items:flex-start;flex-shrink:0;">
                        <a href="${youtubeLink}" target="_blank" class="jump-btn">▶ Jump to Moment</a>
                        <button class="note-delete-btn" data-idx="${i}">✕</button>
                    </div>
                </div>
                <div class="note-key-idea">${note.keyIdea}</div>
                <div class="note-explanation">${note.explanation}</div>
                <div class="note-example">💡 Example: ${note.example}</div>
            `;

            card.querySelector('.note-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteNote(i);
            });

            notesContainer.appendChild(card);
        });
    }

    function deleteNote(filteredIdx) {
        const entry = filteredNotes[filteredIdx];
        const allIdx = allNotes.findIndex(n => n === entry);
        if (allIdx !== -1) allNotes.splice(allIdx, 1);

        chrome.storage.local.get(null, (data) => {
            const col = data[entry.videoId];
            if (col && col.sections) {
                col.sections = col.sections.filter(n =>
                    n.topic !== entry.note.topic || n.timestamp !== entry.note.timestamp
                );
                chrome.storage.local.set({ [entry.videoId]: col });
            }
        });

        noteCountEl.textContent = `${allNotes.length} note${allNotes.length !== 1 ? 's' : ''}`;
        applyFilter(searchInput.value.trim().toLowerCase());
        refreshDueBadge();
    }

    // ── Flashcard Mode ────────────────────────────────────────────────────────

    function switchMode(mode) {
        currentMode = mode;
        document.getElementById('btn-notes-view').className  = `mode-btn${mode === 'notes' ? ' active' : ''}`;
        document.getElementById('btn-flash-view').className  = `mode-btn${mode === 'flashcard' ? ' active' : ''}`;
        document.getElementById('btn-review-view').className = `mode-btn${mode === 'review' ? ' review-active' : ''}`;

        notesContainer.classList.toggle('hidden', mode !== 'notes');
        flashcardView.classList.toggle('active', mode === 'flashcard');
        reviewView.classList.toggle('active', mode === 'review');

        if (mode === 'flashcard') { fcIndex = 0; fcFlipped = false; renderFlashcard(); }
        if (mode === 'review')    { startReview(); }
    }

    function renderFlashcard() {
        const inner   = document.getElementById('flashcard-inner');
        const front   = document.getElementById('fc-front');
        const back    = document.getElementById('fc-back');
        const counter = document.getElementById('fc-counter');
        const prevBtn = document.getElementById('fc-prev');
        const nextBtn = document.getElementById('fc-next');

        inner.classList.remove('flipped');
        fcFlipped = false;

        if (filteredNotes.length === 0) {
            front.innerHTML = '<div class="fc-label">No Cards</div><div class="fc-topic">No notes to show</div>';
            back.innerHTML = '';
            counter.textContent = '0 / 0';
            prevBtn.disabled = nextBtn.disabled = true;
            return;
        }

        const { note } = filteredNotes[fcIndex];
        counter.textContent = `${fcIndex + 1} / ${filteredNotes.length}`;
        prevBtn.disabled = fcIndex === 0;
        nextBtn.disabled = fcIndex === filteredNotes.length - 1;

        front.innerHTML = `
            <div class="fc-ts">${note.timestamp}${note.difficulty ? ' · ' + note.difficulty : ''}</div>
            <div class="fc-label">Topic</div>
            <div class="fc-topic">${note.topic}</div>
            <div class="fc-keyidea">${note.keyIdea}</div>
        `;
        back.innerHTML = `
            <div style="width:100%">
                <div class="fc-label" style="color:#1565C0;margin-bottom:8px">Explanation</div>
                <div class="fc-explanation">${note.explanation}</div>
                <div class="fc-example">💡 ${note.example}</div>
            </div>
        `;
    }

    function flipCard() {
        const inner = document.getElementById('flashcard-inner');
        fcFlipped = !fcFlipped;
        inner.classList.toggle('flipped', fcFlipped);
    }

    function navigateFC(dir) {
        const newIdx = fcIndex + dir;
        if (newIdx < 0 || newIdx >= filteredNotes.length) return;
        fcIndex = newIdx;
        renderFlashcard();
    }

    // ── Spaced Repetition Review Mode ─────────────────────────────────────────

    let reviewQueue = [];
    let reviewIdx   = 0;
    let reviewFlipped = false;

    function startReview() {
        reviewQueue = getDueNotes();
        reviewIdx   = 0;
        reviewFlipped = false;

        if (reviewQueue.length === 0) {
            reviewBody.innerHTML = `
                <div class="review-complete">
                    <div class="review-complete-emoji">🎉</div>
                    <h2>All caught up!</h2>
                    <p>No cards are due right now. Come back later to keep your streak going.</p>
                    <button class="review-done-btn" id="review-done-btn">Back to Notes</button>
                </div>
            `;
            document.getElementById('review-done-btn').addEventListener('click', () => switchMode('notes'));
            return;
        }

        document.getElementById('review-subtitle').textContent =
            `${reviewQueue.length} card${reviewQueue.length !== 1 ? 's' : ''} due today`;

        showReviewCard();
    }

    function showReviewCard() {
        if (reviewIdx >= reviewQueue.length) {
            showReviewComplete();
            return;
        }

        reviewFlipped = false;
        const entry = reviewQueue[reviewIdx];
        const { note } = entry;

        reviewBody.innerHTML = `
            <div class="review-counter">${reviewIdx + 1} / ${reviewQueue.length}</div>
            <div class="review-card-wrapper" id="review-card-wrapper">
                <div class="flashcard-inner" id="review-inner">
                    <div class="flashcard-face flashcard-front" id="review-front">
                        <div class="fc-ts">${note.timestamp}</div>
                        <div class="fc-label">Topic</div>
                        <div class="fc-topic">${note.topic}</div>
                        <div class="fc-keyidea">${note.keyIdea}</div>
                    </div>
                    <div class="flashcard-face flashcard-back" id="review-back">
                        <div style="width:100%">
                            <div class="fc-label" style="color:#1565C0;margin-bottom:8px">Explanation</div>
                            <div class="fc-explanation">${note.explanation}</div>
                            <div class="fc-example">💡 ${note.example}</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="review-flip-hint">Click the card to flip it and reveal the explanation</div>
            <div class="review-rating-row" id="review-rating-row" style="display:none">
                <button class="rating-btn rating-hard" id="rate-hard">😓 Hard</button>
                <button class="rating-btn rating-good" id="rate-good">👍 Good</button>
                <button class="rating-btn rating-easy" id="rate-easy">🚀 Easy</button>
            </div>
        `;

        // Flip on card click
        document.getElementById('review-card-wrapper').addEventListener('click', () => {
            if (!reviewFlipped) {
                reviewFlipped = true;
                document.getElementById('review-inner').classList.add('flipped');
                document.getElementById('review-rating-row').style.display = 'flex';
            }
        });

        // Rating buttons
        const rateAndAdvance = (q) => {
            sm2Update(entry.note, q);
            persistNote(entry);
            refreshDueBadge();
            reviewIdx++;
            showReviewCard();
        };

        document.getElementById('rate-hard').addEventListener('click', () => rateAndAdvance(1));
        document.getElementById('rate-good').addEventListener('click', () => rateAndAdvance(3));
        document.getElementById('rate-easy').addEventListener('click', () => rateAndAdvance(5));
    }

    function showReviewComplete() {
        const easyCount = reviewQueue.filter(e => e.note.sm2 && e.note.sm2.interval > 1).length;
        reviewBody.innerHTML = `
            <div class="review-complete">
                <div class="review-complete-emoji">🏆</div>
                <h2>Session Complete!</h2>
                <p>You reviewed <strong>${reviewQueue.length} card${reviewQueue.length !== 1 ? 's' : ''}</strong> today.<br>
                ${easyCount > 0 ? `${easyCount} card${easyCount !== 1 ? 's' : ''} moved to longer intervals.` : 'Keep reviewing to build strong memory!'}</p>
                <button class="review-done-btn" id="review-done-btn">✓ Done</button>
            </div>
        `;
        document.getElementById('review-done-btn').addEventListener('click', () => switchMode('notes'));
        // Reload notes so SM-2 badges update
        loadLocalNotes();
    }

    // ── Exports ───────────────────────────────────────────────────────────────

    function exportMarkdown() {
        if (allNotes.length === 0) return;
        let md = `# EduNation Notebook\n\n> Exported on ${new Date().toLocaleDateString()}\n\n---\n\n`;
        const groups = {};
        allNotes.forEach(({ note, title, videoId }) => {
            if (!groups[videoId]) groups[videoId] = { title, notes: [] };
            groups[videoId].notes.push(note);
        });
        Object.values(groups).forEach(({ title, notes }) => {
            md += `# ${title}\n\n`;
            notes.sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp)).forEach(n => {
                md += `## ${n.topic}\n`;
                md += `**Timestamp:** \`${n.timestamp}\``;
                if (n.difficulty) md += ` · **Difficulty:** ${n.difficulty}`;
                if (n.tags?.length) md += ` · **Tags:** ${n.tags.join(' ')}`;
                md += `\n\n> ${n.keyIdea}\n\n${n.explanation}\n\n**Example:** ${n.example}\n\n---\n\n`;
            });
        });
        downloadFile('EduNation-Notebook.md', md, 'text/markdown');
    }

    function exportJSON() {
        chrome.storage.local.get(null, (data) => {
            const out = {};
            Object.keys(data).filter(k => k !== 'aiTutorEnabled').forEach(k => { out[k] = data[k]; });
            downloadFile('EduNation-backup.json', JSON.stringify(out, null, 2), 'application/json');
        });
    }

    function exportAnki() {
        if (allNotes.length === 0) return;
        const rows = [['Front', 'Back']];
        allNotes.forEach(({ note }) => {
            const front = `${note.topic}\n${note.keyIdea}`;
            const back  = `${note.explanation}\n\nExample: ${note.example}\n\nTimestamp: ${note.timestamp}`;
            rows.push([`"${front.replace(/"/g, '""')}"`, `"${back.replace(/"/g, '""')}"`]);
        });
        downloadFile('EduNation-Anki.csv', rows.map(r => r.join(',')).join('\n'), 'text/csv');
    }

    // ── Import JSON ───────────────────────────────────────────────────────────

    function importJSON(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const imported = JSON.parse(evt.target.result);
                if (typeof imported !== 'object' || Array.isArray(imported))
                    throw new Error('Invalid format');

                chrome.storage.local.get(null, (existing) => {
                    const merged = { ...existing };
                    let importedNotes = 0;
                    let importedVideos = 0;

                    Object.keys(imported).forEach(k => {
                        if (k === 'aiTutorEnabled') return;
                        const col = imported[k];
                        if (!col || !col.sections) return;

                        if (merged[k] && merged[k].sections) {
                            // Merge sections — avoid duplicates by UUID or topic+timestamp
                            const existingKeys = new Set(
                                merged[k].sections.map(n => n.uuid || `${n.topic}|${n.timestamp}`)
                            );
                            const newSections = col.sections.filter(n => {
                                const key = n.uuid || `${n.topic}|${n.timestamp}`;
                                return !existingKeys.has(key);
                            });
                            merged[k].sections = [...merged[k].sections, ...newSections];
                            importedNotes += newSections.length;
                        } else {
                            merged[k] = col;
                            importedNotes += col.sections.length;
                            importedVideos++;
                        }
                    });

                    chrome.storage.local.set(merged, () => {
                        alert(`✅ Import complete: ${importedNotes} notes across ${importedVideos} new video(s) added.`);
                        loadLocalNotes();
                    });
                });
            } catch (err) {
                alert(`❌ Import failed: ${err.message}`);
            }
        };
        reader.readAsText(file);
        // Reset input so same file can be re-imported
        e.target.value = '';
    }

    function downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function parseTs(t) {
        if (typeof t === 'number') return t;
        if (!t || typeof t !== 'string') return 0;
        const p = t.split(':');
        if (p.length === 3) return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseInt(p[2]);
        if (p.length === 2) return parseInt(p[0]) * 60 + parseInt(p[1]);
        const s = parseInt(t);
        return isNaN(s) ? 0 : s;
    }
});
