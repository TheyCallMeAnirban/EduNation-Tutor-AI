document.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("notes-container");
    const loading = document.getElementById("loading");

    loadLocalNotes();

    function loadLocalNotes() {
        chrome.storage.local.get(null, (data) => {
            loading.style.display = 'none';
            const videoKeys = Object.keys(data).filter(k => k !== 'aiTutorEnabled');
            
            if (videoKeys.length === 0) {
                list.innerHTML = '<div style="text-align: center; color: #666; margin-top: 50px;">No saved notes found locally.</div>';
                return;
            }

            list.innerHTML = '';
            // Convert to array and sort by latest
            const collections = videoKeys.map(k => data[k]).sort((a,b) => b.createdAt - a.createdAt);

            collections.forEach(col => {
                if (col.sections) {
                    col.sections.forEach(note => {
                        const card = createCard(col.title, col.videoId, note);
                        list.appendChild(card);
                    });
                }
            });
        });
    }

    function createCard(title, videoId, note) {
        const div = document.createElement("div");
        div.className = "note-card";
        
        const youtubeLink = `https://www.youtube.com/watch?v=${videoId}&t=${parseTs(note.timestamp)}s`;

        div.innerHTML = `
            <div class="note-header">
                <div>
                    <h2 class="note-topic">${note.topic}</h2>
                    <div class="note-meta">${title}</div>
                </div>
                <a href="${youtubeLink}" target="_blank" class="badge">Jump to Moment</a>
            </div>
            <div class="note-content">
                <div style="margin-bottom: 8px;"><strong>Idea:</strong> ${note.keyIdea}</div>
                <div style="margin-bottom: 8px;">${note.explanation}</div>
                <div style="color: #666; font-size: 0.9em;"><em>Example: ${note.example}</em></div>
            </div>
        `;
        return div;
    }

    function parseTs(t) {
        const p = t.split(':');
        return p.length === 2 ? parseInt(p[0]) * 60 + parseInt(p[1]) : 0;
    }
});
