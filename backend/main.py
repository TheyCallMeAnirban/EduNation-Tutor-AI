import os
import json
import faiss
import pickle
import numpy as np
import logging
import time
from pathlib import Path
from collections import OrderedDict
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Optional, AsyncGenerator
from youtube_transcript_api import YouTubeTranscriptApi
from sentence_transformers import SentenceTransformer
from openai import AsyncOpenAI
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("EduNationAPI")

load_dotenv()

# Persistent cache directory
CACHE_DIR = Path("cache")
CACHE_DIR.mkdir(exist_ok=True)

# Setup embedding model
_model_load_start = time.time()
logger.info("Loading SentenceTransformer model (all-MiniLM-L6-v2)...")
embedder = SentenceTransformer('all-MiniLM-L6-v2')
logger.info(f"Model loaded in {time.time() - _model_load_start:.1f}s")

# In-memory LRU cache on top of disk cache
MAX_CACHE_SIZE = 50
video_cache = OrderedDict()

# OpenAI / compatible LLM client
client = AsyncOpenAI(
    api_key=os.getenv("LLM_API_KEY", "dummy_key"),
    base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
)
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("━" * 50)
    logger.info("  EduNation API v2.1 — ready on http://0.0.0.0:8000")
    logger.info("━" * 50)
    yield
    logger.info("Shutting down EduNation API...")

app = FastAPI(title="EduNation API", version="2.1.0", lifespan=lifespan)

# CORS — restrict to localhost origins in all environments
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        # Chrome extensions use a special origin; wildcard needed for extension requests
        "*",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Health & Stats ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "EduNation API v2.1 is running"}


@app.get("/stats")
async def get_stats():
    """Return stats about the local disk cache for the popup UI."""
    cached_files = list(CACHE_DIR.glob("*.faiss"))
    total_videos = len(cached_files)
    total_size_mb = sum(f.stat().st_size for f in CACHE_DIR.iterdir() if f.is_file()) / (1024 * 1024)
    return {
        "cached_videos": total_videos,
        "cache_size_mb": round(total_size_mb, 2),
        "model": "all-MiniLM-L6-v2",
        "llm": LLM_MODEL,
    }


# ── Pydantic Models ────────────────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    video_id: str
    timestamp: float
    context: str
    user_question: str
    chat_history: Optional[List[Dict[str, str]]] = []


class ExplainResponse(BaseModel):
    explanation: str


class ChatRequest(BaseModel):
    video_id: str
    note: Dict                          # full note object for context
    user_message: str
    chat_history: Optional[List[Dict[str, str]]] = []


class QuizRequest(BaseModel):
    video_id: str
    notes: List[Dict]                   # array of note objects from the session


# ── Helpers ───────────────────────────────────────────────────────────────────

def format_time(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins}:{secs:02d}"


def _disk_paths(video_id: str):
    return (
        CACHE_DIR / f"{video_id}.faiss",
        CACHE_DIR / f"{video_id}.pkl"
    )


def _save_to_disk(video_id: str, chunks, index):
    faiss_path, pkl_path = _disk_paths(video_id)
    faiss.write_index(index, str(faiss_path))
    with open(pkl_path, "wb") as f:
        pickle.dump(chunks, f)
    logger.info(f"Saved index to disk: {video_id}")


def _load_from_disk(video_id: str):
    faiss_path, pkl_path = _disk_paths(video_id)
    if faiss_path.exists() and pkl_path.exists():
        logger.info(f"Loading index from disk: {video_id}")
        index = faiss.read_index(str(faiss_path))
        with open(pkl_path, "rb") as f:
            chunks = pickle.load(f)
        return chunks, index
    return None, None


def get_or_build_index(video_id: str):
    # 1. In-memory LRU hit
    if video_id in video_cache:
        logger.info(f"Memory cache hit: {video_id}")
        video_cache.move_to_end(video_id)
        return video_cache[video_id]

    # 2. Disk cache hit
    chunks, index = _load_from_disk(video_id)
    if chunks is not None:
        if len(video_cache) >= MAX_CACHE_SIZE:
            oldest_key, _ = video_cache.popitem(last=False)
            logger.info(f"Memory cache full, evicted: {oldest_key}")
        video_cache[video_id] = {"chunks": chunks, "index": index}
        return video_cache[video_id]

    # 3. Build from scratch
    logger.info(f"Building index for video: {video_id}")
    try:
        ts_list = YouTubeTranscriptApi().list(video_id)

        try:
            transcript = ts_list.find_transcript(['en']).fetch()
        except Exception:
            try:
                manual = [t for t in ts_list if not t.is_generated]
                transcript = manual[0].fetch() if manual else ts_list.find_transcript(['en']).fetch()
            except Exception:
                transcript = next(iter(ts_list)).fetch()

        if not transcript:
            raise ValueError("Transcript not found")

        # Group into 40-second chunks
        chunks = []
        current_text = ""
        chunk_start = 0
        WINDOW_SECONDS = 40

        def get_v(obj, key):
            return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)

        for i, item in enumerate(transcript):
            start = get_v(item, 'start')
            dur = get_v(item, 'duration') or 0
            text = (get_v(item, 'text') or "").replace('\n', ' ')

            if current_text == "":
                chunk_start = start

            current_text += f"{text} "

            if (start + dur - chunk_start) > WINDOW_SECONDS or i == len(transcript) - 1:
                chunks.append({
                    "text": current_text.strip(),
                    "start": chunk_start,
                    "end": start + dur
                })
                current_text = ""

        texts = [c['text'] for c in chunks]
        embs = embedder.encode(texts, convert_to_numpy=True)
        index = faiss.IndexFlatL2(embs.shape[1])
        index.add(embs)

        _save_to_disk(video_id, chunks, index)

        if len(video_cache) >= MAX_CACHE_SIZE:
            oldest_key, _ = video_cache.popitem(last=False)
            logger.info(f"Memory cache full, evicted: {oldest_key}")

        video_cache[video_id] = {"chunks": chunks, "index": index}
        logger.info(f"Successfully indexed {len(chunks)} chunks for: {video_id}")
        return video_cache[video_id]

    except Exception as e:
        logger.error(f"Error processing {video_id}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to process transcript: {str(e)}")


def _get_rag_context(video_id: str, query: str, top_k: int = 3, max_chars: int = 1200) -> str:
    data = get_or_build_index(video_id)
    index = data['index']
    chunks = data['chunks']

    query_emb = embedder.encode([query], convert_to_numpy=True)
    _, indices = index.search(query_emb, top_k)

    # Use dict.fromkeys to deduplicate while preserving insertion order
    seen = dict.fromkeys(
        i
        for idx_list in indices
        for idx in idx_list
        if idx != -1 and idx < len(chunks)
        for i in range(max(0, idx - 1), min(len(chunks), idx + 2))
    )

    # Sort by chunk start time so the context reads chronologically
    sorted_indices = sorted(seen.keys(), key=lambda i: chunks[i]['start'])
    combined = "\n".join(chunks[i]['text'] for i in sorted_indices)
    return combined[:max_chars]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/explain", response_model=ExplainResponse)
async def explain_concept(request: ExplainRequest):
    logger.info(f"Explain request: {request.video_id} at {request.timestamp}s")

    try:
        ctx = _get_rag_context(
            request.video_id,
            f"{request.context} {request.user_question}",
            top_k=3,
            max_chars=1000
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Index error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

    formatted_timestamp = format_time(request.timestamp)

    prompt = f"""You are an AI tutor. Generate a study note as JSON.
Timestamp: {formatted_timestamp}

Lecture context:
{ctx}

Question: "{request.user_question}"

Respond with ONLY valid JSON:
{{
  "topic": "Concept name",
  "timestamp": "{formatted_timestamp}",
  "keyIdea": "One sentence core takeaway",
  "explanation": "Clear explanation (60-80 words)",
  "example": "A relatable real-world example",
  "difficulty": "Beginner"
}}
difficulty must be exactly one of: Beginner, Intermediate, Advanced.
"""

    messages = [
        {"role": "system", "content": "Expert tutor. Output only valid JSON."},
        {"role": "user", "content": prompt}
    ]

    if request.chat_history:
        messages = (
            [messages[0]]
            + request.chat_history
            + [messages[1]]
        )

    try:
        res = await client.chat.completions.create(
            model=LLM_MODEL,
            response_format={"type": "json_object"},
            messages=messages
        )
        logger.info(f"Explain response received for {request.video_id}")
        return ExplainResponse(explanation=res.choices[0].message.content)
    except Exception as e:
        logger.error(f"LLM Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")


@app.post("/chat")
async def chat_with_note(request: ChatRequest):
    """Multi-turn follow-up chat about a specific note. Streams response via SSE."""
    logger.info(f"Chat request: {request.video_id} — '{request.user_message[:60]}'")

    try:
        rag_ctx = _get_rag_context(
            request.video_id,
            request.user_message,
            top_k=2,
            max_chars=600
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"RAG error in chat: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

    note = request.note
    system_prompt = f"""You are EduNation, an AI tutor. Answer the student's follow-up concisely (2-3 sentences).

Note — Topic: {note.get('topic', '')} | Key Idea: {note.get('keyIdea', '')}
Context: {rag_ctx}

Do NOT output JSON."""

    messages = [{"role": "system", "content": system_prompt}]
    for msg in (request.chat_history or []):
        messages.append(msg)
    messages.append({"role": "user", "content": request.user_message})

    async def sse_generator() -> AsyncGenerator[str, None]:
        try:
            stream = await client.chat.completions.create(
                model=LLM_MODEL,
                messages=messages,
                stream=True
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield f"data: {json.dumps({'token': delta})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Streaming error: {str(e)}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/quiz")
async def generate_quiz(request: QuizRequest):
    """Generate 5 MCQ quiz questions from the session's saved notes."""
    logger.info(f"Quiz request for {request.video_id} with {len(request.notes)} notes")

    if not request.notes:
        raise HTTPException(status_code=400, detail="No notes provided to generate a quiz from.")

    # Build a compact summary of all notes (capped at 8)
    notes_summary = "\n".join([
        f"- {n.get('topic', '')}: {n.get('keyIdea', '')}"
        for n in request.notes[:8]
    ])

    # Build a combined query from all note topics for better RAG coverage
    combined_query = " ".join(
        n.get('topic', '') for n in request.notes[:8] if n.get('topic')
    )
    try:
        rag_ctx = _get_rag_context(request.video_id, combined_query, top_k=3, max_chars=600)
    except Exception:
        rag_ctx = ""

    prompt = f"""Generate 5 MCQ quiz questions from these study notes:
{notes_summary}
{chr(10) + rag_ctx if rag_ctx else ""}

Rules: 4 options each, 1 correct, test comprehension, plausible distractors.

Respond ONLY with this JSON (no markdown):
{{
  "questions": [
    {{
      "question": "?",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "explanation": "brief reason"
    }}
  ]
}}
"""

    try:
        res = await client.chat.completions.create(
            model=LLM_MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "Expert quiz generator. Output only valid JSON."},
                {"role": "user", "content": prompt}
            ]
        )
        logger.info(f"Quiz generated for {request.video_id}")
        return json.loads(res.choices[0].message.content)
    except Exception as e:
        logger.error(f"Quiz generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Quiz generation failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting uvicorn server...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
