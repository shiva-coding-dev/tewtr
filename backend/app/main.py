from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import os
import shutil
from typing import List, Optional
from .pdf_processor import PDFProcessor
from .agent import VLMAgent
from PIL import Image
import io

from pydantic import BaseModel

class ChatRequest(BaseModel):
    filename: str
    page_index: int
    context: str
    question: str

app = FastAPI(title="AI Tutor Agent Backend")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    
    if len(files) == 1 and files[0].filename.lower().endswith(".pdf"):
        file = files[0]
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        filename = file.filename
    else:
        images = []
        for file in files:
            if not file.filename.lower().endswith((".png", ".jpg", ".jpeg")):
                 raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.filename}")
            img_data = await file.read()
            img = Image.open(io.BytesIO(img_data)).convert("RGB")
            images.append(img)
        
        filename = "combined_images.pdf"
        file_path = os.path.join(UPLOAD_DIR, filename)
        if images:
            images[0].save(file_path, save_all=True, append_images=images[1:])
        else:
            raise HTTPException(status_code=400, detail="No valid images found")

    try:
        pages = PDFProcessor.split_pdf_to_pages(file_path)
        return {
            "message": "Upload successful",
            "filename": filename,
            "total_pages": len(pages),
            "pages": pages
        }
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/preview/{filename}/{page_index}")
async def get_preview(filename: str, page_index: int):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        img_bytes = PDFProcessor.get_page_image(file_path, page_index)
        return Response(content=img_bytes, media_type="image/png")
    except IndexError:
        raise HTTPException(status_code=400, detail="Invalid page index")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/transcribe/{filename}")
async def transcribe_document(filename: str, page_index: int = 0):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        agent = VLMAgent()
        transcription = await agent.transcribe_page(file_path, page_index)
        return {"markdown": transcription}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ExplainRequest(BaseModel):
    transcription: str
    previous_context: str = ""

class FlashcardsRequest(BaseModel):
    transcription: str
    explanation: str

@app.post("/explain")
async def explain_document(request: ExplainRequest):
    try:
        agent = VLMAgent()
        result = await agent.generate_tutor_json(request.transcription, request.previous_context)
        return {"result": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/flashcards")
async def flashcards_only(request: FlashcardsRequest):
    try:
        agent = VLMAgent()
        result = await agent.generate_flashcards_only(request.transcription, request.explanation)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat_with_tutor(request: ChatRequest):
    try:
        agent = VLMAgent()
        answer = await agent.chat(request.context, request.question)
        return {"answer": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)