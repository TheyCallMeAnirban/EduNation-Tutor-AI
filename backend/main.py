import os
import faiss
import numpy as np
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
from youtube_transcript_api import YouTubeTranscriptApi
from sentence_transformers import SentenceTransformer
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

# Setup models
embedder = SentenceTransformer('all-MiniLM-L6-v2')

# Cache for video transcripts and indices
video_cache = {}

# OpenAI Setup
client = AsyncOpenAI(
    api_key=os.getenv("LLM_API_KEY", "dummy_key"),
    base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
)
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="EduNation API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "EduNation API is running"}

class ExplainRequest(BaseModel):
    video_id: str
    timestamp: float
    context: str
    user_question: str
    chat_history: Optional[List[Dict[str, str]]] = []

class ExplainResponse(BaseModel):
    explanation: str

def format_time(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins}:{secs:02d}"

def get_or_build_index(video_id: str):
    if video_id in video_cache:
        return video_cache[video_id]
    
    try:
        ts_list = YouTubeTranscriptApi().list(video_id)
        
        # Preference: manual English -> general manual -> auto English -> first available
        try:
            transcript = ts_list.find_transcript(['en']).fetch()
        except:
            try:
                manual = [t for t in ts_list if not t.is_generated]
                transcript = manual[0].fetch() if manual else ts_list.find_transcript(['en']).fetch()
            except:
                transcript = next(iter(ts_list)).fetch()

        if not transcript:
            raise ValueError("Transcript not found")
        
        # Group by logical time chunks
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
        
        # Indexing
        texts = [c['text'] for c in chunks]
        embs = embedder.encode(texts, convert_to_numpy=True)
        idx = faiss.IndexFlatL2(embs.shape[1])
        idx.add(embs)
        
        video_cache[video_id] = {"transcript": transcript, "chunks": chunks, "index": idx}
        return video_cache[video_id]
        
    except Exception as e:
        print(f"Error processing {video_id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/explain", response_model=ExplainResponse)
async def explain_concept(request: ExplainRequest):
    try:
        data = get_or_build_index(request.video_id)
    except Exception as e:
         raise HTTPException(status_code=500, detail=str(e))
         
    index = data['index']
    chunks = data['chunks']
    
    # RAG search
    query_emb = embedder.encode([f"{request.context} {request.user_question}"], convert_to_numpy=True)
    _, indices = index.search(query_emb, 3)
    
    ctx_list = []
    for idx_list in indices:
        for idx in idx_list:
            if idx != -1 and idx < len(chunks):
                s, e = max(0, idx - 1), min(len(chunks) - 1, idx + 1)
                for i in range(s, e + 1):
                    ctx_list.append(chunks[i]['text'])
            
    prompt = f"""You are an AI tutor generating structured study notes.
Paused at: {request.timestamp}s

Lecture context:
{"\n".join(set(ctx_list))}

Question: "{request.user_question}"

Respond with ONLY this JSON:
{{
  "topic": "Concept name",
  "timestamp": "{format_time(request.timestamp)}",
  "keyIdea": "Main takeaway",
  "explanation": "Clear summary (max 60 words)",
  "example": "Simple analogy"
}}
"""
    
    messages = [
        {"role": "system", "content": "Knowledgeable tutor, outputs structured JSON."},
        {"role": "user", "content": prompt}
    ]
    
    try:
        res = await client.chat.completions.create(
            model=LLM_MODEL,
            response_format={"type": "json_object"},
            messages=messages
        )
        return ExplainResponse(explanation=res.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
