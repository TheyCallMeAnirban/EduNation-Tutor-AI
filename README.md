# EduNation AI Tutor 🎓✨

EduNation AI is a sophisticated learning tool designed to bridge the gap between passive video watching and active studying. By integrating a FastAPI-powered RAG (Retrieval-Augmented Generation) system with a custom Chrome Extension, it allows students to get instant, context-aware explanations of any moment in a YouTube lecture.

## 🌟 Key Features

*   **📍 Contextual Explanations**: Uses vector embeddings to search the video's transcript and explain the precise concepts being discussed at any timestamp.
*   **📋 Structured Study Timeline**: Generates clear, concise study cards containing the **Topic**, **Key Idea**, **Explanation**, and a **Simplified Example**.
*   **⏩ Interactive Navigation**: Integrated "Jump to Moment" feature allows you to click any note to seek the video back to that specific explanation.
*   **💾 Local Storage Persistence**: All generated notes are saved in your browser's local storage, categorized by Video ID. Your notes survive page refreshes and browser restarts.
*   **📄 PDF Study Guides**: One-click export to download your entire session's study timeline as a professionally formatted PDF.
*   **🛠️ Smart RAG Chunking**: Backend logic groups transcripts into logical 40-second windows to ensure the AI has complete conceptual context for every query.

## 🛠️ Technology Stack

### Backend
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.9+)
- **Vector Search**: [FAISS](https://github.com/facebookresearch/faiss) (FlatL2 index)
- **Embeddings**: [Sentence-Transformers](https://www.sbert.net/) (`all-MiniLM-L6-v2`)
- **LLM**: OpenAI GPT-4o-mini (via AsyncOpenAI)

### Extension
- **Logic**: Vanilla JavaScript (ES6) with a modular state management pattern.
- **UI**: Modern CSS3 with glassmorphism effects and custom animations.
- **Library**: `jsPDF` for client-side document generation.

## ⚙️ Installation & Setup

### 1. Backend Configuration
Navigate to the `backend` directory and install the required packages:
```bash
pip install -r requirements.txt
```

Create a `.env` file in the `backend` root:
```env
LLM_API_KEY=your_openai_api_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

Start the API server:
```bash
python main.py
```

### 2. Extension Installation
1. Go to `chrome://extensions/` in your browser.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder from this repository.
4. Ensure your backend server is running (default: `localhost:8000`).

## 📖 Usage Guide
1. Open any YouTube lecture.
2. Enable the tutor via the extension popup.
3. Pause the video whenever you encounter a difficult concept.
4. Click the **✨ Explain this moment** button that appears on the player.
5. The **Study Timeline** sidebar will open, displaying your new study note.
6. Once finished, use **Export PDF** to save your notes for offline review.
