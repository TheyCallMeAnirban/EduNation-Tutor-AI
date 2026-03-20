# EduNation AI Tutor v2.0 🎓✨

EduNation AI is an AI-powered study companion that integrates a FastAPI RAG backend with a Chrome Extension to give students instant, context-aware explanations of any moment in a YouTube lecture.

## 🌟 What's New in v2.0

- **🔍 Custom Questions** — Type your own question before analyzing a concept
- **💬 Multi-turn Chat** — Follow up on any note with a streaming AI conversation
- **✏️ Inline Editing** — Double-click any note field to edit it directly
- **🏷️ Note Tagging** — Tag notes as `#important`, `#confusing`, or `#review`
- **🗑️ Note Deletion** — Remove individual notes from the sidebar or dashboard
- **🎯 Difficulty Badge** — Each note is rated Beginner / Intermediate / Advanced
- **⌨️ Keyboard Shortcut** — Press `Alt+E` to trigger Explain instantly
- **🔢 Icon Badge** — Extension icon shows live note count for the current video
- **🃏 Flashcard Mode** — Flip-card revision mode in the Notebook dashboard
- **🔎 Note Search** — Filter all notes by keyword, topic, or tag
- **📝 Markdown Export** — Download notes as a `.md` file for Obsidian/Notion
- **💾 JSON Backup** — Full import/export of your notes database
- **🃏 Anki CSV Export** — Export flashcards directly importable into Anki
- **💾 Persistent Cache** — FAISS index saved to disk; survives backend restarts

---

## 🛠️ Technology Stack

### Backend
- **Framework**: FastAPI (Python 3.9+)
- **Vector Search**: FAISS (FlatL2 index) with **disk persistence**
- **Embeddings**: Sentence-Transformers (`all-MiniLM-L6-v2`)
- **LLM**: OpenAI GPT-4o-mini (streaming via `AsyncOpenAI`)
- **Streaming**: Server-Sent Events (SSE) for the `/chat` endpoint

### Extension
- **Logic**: Vanilla JavaScript (ES6+), modular state management
- **UI**: Modern CSS3 with glassmorphism, 3D card flip, micro-animations
- **Libraries**: `jsPDF` for PDF export

---

## ⚙️ Installation & Setup

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file:
```env
LLM_API_KEY=your_openai_api_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

Start the server:
```bash
python main.py
```

> **Persistent cache**: After the first request for a video, a `backend/cache/` folder will be created with the FAISS index saved to disk. Repeat requests (even after restart) load instantly from disk.

### 2. Extension

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Ensure the backend server is running (`localhost:8000`)

---

## 📖 Usage Guide

1. Open any YouTube lecture
2. Enable the tutor via the extension popup
3. Pause the video at a concept you want to understand
4. (Optional) Type a specific question in the input field
5. Click **✨ Analyze Concept** — or press `Alt+E`
6. View the note in the **Study Timeline** sidebar
7. Click **💬 Ask a follow-up** for a streaming AI chat about that note
8. Double-click any note field to edit it inline
9. Tag notes with `#important`, `#confusing`, or `#review`
10. Open **📔 My Notebook** for flashcard mode, search, and exports

---

## 📤 Export Options

| Format | Location | Use case |
|---|---|---|
| PDF | Sidebar | Print-ready study guide |
| Markdown | Sidebar + Notebook | Obsidian, Notion, GitHub |
| JSON | Sidebar + Notebook | Full backup / restore |
| Anki CSV | Sidebar + Notebook | Spaced repetition flashcards |

---

## 📜 License

MIT License — Copyright (c) 2026

---
*Empowering students through AI-driven context.*
