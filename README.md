# EduNation AI Tutor 🎓

> **An AI-powered study companion that transforms any YouTube lecture into structured, reviewable knowledge — right inside your browser.**

<br>

## ✨ What It Does

EduNation AI sits alongside YouTube lectures and does three things traditional note-taking can't:

1. **Understands the lecture** — Transcribes and semantically indexes the full video using FAISS vector search
2. **Answers at any moment** — Pause the video, ask a question, get a structured study note in seconds
3. **Builds long-term memory** — Notes feed into an SM-2 spaced repetition system with flashcard review

No accounts. No cloud. All data stays on your device.

---

## 🌟 Feature Highlights

| Feature | Description |
|---|---|
| **✨ Instant Concept Analysis** | Pause → click → get a structured note: topic, key idea, explanation, example, difficulty |
| **💬 Streaming AI Chat** | Ask follow-up questions on any note with a live-streamed response |
| **📅 Spaced Repetition (SM-2)** | Review cards at scientifically-optimized intervals |
| **🃏 Flashcard Mode** | Flip-card revision with keyboard navigation |
| **🧪 Quiz Generation** | 5 MCQ questions generated from your session notes |
| **✏️ Inline Editing** | Edit any note field directly in the sidebar |
| **🏷️ Note Tags** | Tag notes as `#important`, `#confusing`, `#review` |
| **🔍 Full-text Search** | Search all your notes across all videos instantly |
| **📤 Multi-format Export** | PDF · Markdown · JSON · Anki CSV |
| **📥 JSON Import** | Restore a backup — merges without duplicating |
| **⌨️ Keyboard Shortcut** | `Alt+E` triggers analysis without touching the mouse |
| **⚙️ Configurable Backend** | Set backend URL from the popup — no code edits needed |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│              Chrome Extension (MV3)                 │
│                                                     │
│  popup.html/js   ←─── toggle, stats, settings       │
│  content.js      ←─── sidebar, notes, quiz, chat    │
│  history.js      ←─── notebook, flashcards, SM-2    │
│  background.js   ←─── badge counter, shortcuts      │
└────────────────────────┬────────────────────────────┘
                         │  HTTP (localhost:8000)
┌────────────────────────▼────────────────────────────┐
│                  FastAPI Backend                     │
│                                                     │
│  /explain   ←─── RAG + LLM → structured note JSON   │
│  /chat      ←─── RAG + streaming SSE response       │
│  /quiz      ←─── multi-note → 5 MCQ questions       │
│  /stats     ←─── cache metadata for popup UI        │
│  /health    ←─── liveness probe                     │
│                                                     │
│  FAISS Index (disk-persisted per video)             │
│  SentenceTransformer (all-MiniLM-L6-v2)            │
│  OpenAI-compatible LLM (gpt-4o-mini default)        │
└─────────────────────────────────────────────────────┘
```

---

## ⚙️ Setup

### Prerequisites
- Python 3.9+
- Google Chrome (or Chromium-based browser)
- OpenAI API key (or any OpenAI-compatible endpoint)

### 1. Backend — Python

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file:
```env
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

Start the server:
```bash
python main.py
```

The first request for a video will build and cache the FAISS index to `backend/cache/`. All subsequent requests for that video load instantly from disk.

### 1b. Backend — Docker (recommended for demos)

```bash
cd backend
docker compose up
```

### 2. Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. Make sure the backend is running at `localhost:8000`

---

## 🚀 Usage

1. Open any YouTube lecture video
2. Enable EduNation via the extension popup
3. Pause at a concept you want to capture
4. *(Optional)* Type a specific question in the sidebar input
5. Click **✨ Analyze Concept** or press `Alt+E`
6. A structured note appears in the timeline
7. Click **💬 Ask a follow-up** to chat with the AI about that note
8. Open **📔 My Notebook** to review all notes with flashcards and spaced repetition

---

## 📤 Export Formats

| Format | From | Use case |
|---|---|---|
| PDF | Sidebar | Print-ready study guide |
| Markdown | Sidebar + Notebook | Obsidian, Notion, GitHub |
| JSON | Sidebar + Notebook | Full backup and restore |
| Anki CSV | Sidebar + Notebook | Import into Anki for SR |

---

## 🛠️ Tech Stack

**Backend**
- FastAPI · Uvicorn
- FAISS (FlatL2, disk-persistent)
- Sentence-Transformers (`all-MiniLM-L6-v2`)
- OpenAI Python SDK (async, streaming)

**Extension**
- Chrome Manifest V3 · Vanilla JS (ES6+)
- CSS3 glassmorphism · Web Animations API
- jsPDF · chrome.storage.local

**Algorithms**
- SM-2 Spaced Repetition
- RAG (Retrieval-Augmented Generation) with semantic chunking

---


