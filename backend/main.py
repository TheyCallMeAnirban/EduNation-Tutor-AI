import os
import faiss
import numpy as np
import logging
from collections import OrderedDict
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
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

# Setup models
logger.info("Loading SentenceTransformer model...")
embedder = SentenceTransformer('all-MiniLM-L6-v2')

# Cache for video transcripts and indices (LRU-like cache)
MAX_CACHE_SIZE = 50
video_cache = OrderedDict()

# OpenAI Setup
client = AsyncOpenAI(
    api_key=os.getenv("LLM_API_KEY", "dummy_key"),
    base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
)
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting EduNation API...")
    yield
    logger.info("Shutting down EduNation API...")

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
    # Check cache and move to end (LRU behavior)
    if video_id in video_cache:
        logger.info(f"Cache hit for video: {video_id}")
        video_cache.move_to_end(video_id)
        return video_cache[video_id]
    
    logger.info(f"Building index for video: {video_id}")
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
        
        # Cache management
        if len(video_cache) >= MAX_CACHE_SIZE:
            oldest_key, _ = video_cache.popitem(last=False)
            logger.info(f"Cache full, evicted: {oldest_key}")
            
        video_cache[video_id] = {"transcript": transcript, "chunks": chunks, "index": idx}
        logger.info(f"Successfully indexed video: {video_id}")
        return video_cache[video_id]
        
    except Exception as e:
        logger.error(f"Error processing {video_id}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to process transcript: {str(e)}")

@app.post("/explain", response_model=ExplainResponse)
async def explain_concept(request: ExplainRequest):
    logger.info(f"Request: explain concept for {request.video_id} at {request.timestamp}s")
    try:
        data = get_or_build_index(request.video_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in explain_concept: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
         
    index = data['index']
    chunks = data['chunks']
    
    # RAG search - find top 5 relevant chunks instead of 3
    query_emb = embedder.encode([f"{request.context} {request.user_question}"], convert_to_numpy=True)
    _, indices = index.search(query_emb, 5)
    
    ctx_list = []
    for idx_list in indices:
        for idx in idx_list:
            if idx != -1 and idx < len(chunks):
                # Include more padding: 2 chunks before and 2 after
                s, e = max(0, idx - 2), min(len(chunks) - 1, idx + 2)
                for i in range(s, e + 1):
                    ctx_list.append(chunks[i]['text'])
            
    formatted_timestamp = format_time(request.timestamp)
    prompt = f"""You are an expert AI tutor generating high-quality study notes for students.
Paused at: {request.timestamp} seconds ({formatted_timestamp})

Lecture context (around the current timestamp):
{"\n".join(set(ctx_list))}

Student Question: "{request.user_question}"

Instructions:
1. Topic: Provide a professional name for the concept.
2. Timestamp: YOU MUST USE THE EXACT STRING '{formatted_timestamp}'. DO NOT CHANGE IT OR ESTIMATE IT.
3. KeyIdea: Single sentence summarizing the core takeaway.
4. Explanation: Provide a comprehensive, clear, and humanly understandable explanation. Use 100-150 words. Avoid generic phrases; explain the *how* and *why* based on the context provided.
5. Example: A simple, relatable analogy or real-world example to illustrate the concept.

Respond with ONLY this JSON structure:
{{
  "topic": "Concept name",
  "timestamp": "{formatted_timestamp}",
  "keyIdea": "Main takeaway",
  "explanation": "Detailed explanation here...",
  "example": "Relatable example here..."
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
        logger.info(f"LLM response received for {request.video_id}")
        return ExplainResponse(explanation=res.choices[0].message.content)
    except Exception as e:
        logger.error(f"LLM Error for {request.video_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting uvicorn server...")
    # reload=False is safer on Windows to prevent file-watching hangs
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
