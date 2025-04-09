# Mistral Chatbot with RAG

This project sets up a **local** Mistral-based chatbot (via Ollama) with a **Python-based Retrieval-Augmented Generation (RAG)** pipeline using **ChromaDB** as a vector store.

---

## 1) Prerequisites

- **macOS or Linux** (Windows might require WSL; untested here)  
- **Node.js** (v16 or v18 recommended)  
- **Python 3.8+** (3.10 or 3.11 often work best)  
- **Ollama** (to run Mistral or other LLMs locally)

**Installing Ollama**  
Visit [Ollama’s GitHub](https://github.com/jmorganca/ollama) for instructions.  
Once installed, verify by running:  
```
ollama run mistral
```  
You should see a short prompt or reply from Mistral.

---

## 2) Repository Setup

1. **Clone** this repository:
```
git clone <your-repo-url.git>
cd <repo-folder>
```
2. **Install Node.js dependencies**:
```
npm install
```
3. **Install Python dependencies** (inside the `python_rag_service` folder):
```
cd python_rag_service
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
```
Make sure `chromadb==0.3.26` is used if you’re following the instructions in this project.

---

## 3) Project Structure

- **server.js** – Main Node server (serves UI, routes, etc.)  
- **python_rag_service/**  
  - **load_pdfs.py** – Script to process & ingest PDFs into Chroma  
  - **embedder.py** – Handles embeddings with SentenceTransformers  
  - **vector_store.py** – Manages adding/querying docs in Chroma  
- **public/** – Static front-end files (HTML/JS)  
- **.pdfs/** – Folder for PDFs (git-ignored)

---

## 4) Running the RAG Pipeline

1. **Place PDFs** in `python_rag_service/.pdfs/` (or your chosen folder).
2. **Ingest PDFs**:
```
cd python_rag_service
python3 load_pdfs.py
```
This reads & chunks your PDFs, storing them in a local Chroma database (`chroma_db/`).  
3. **(Optional)** If you have a FastAPI service, run it:
```
uvicorn main:app --host 0.0.0.0 --port 8008
```
4. **Start Node** in the root folder:
```
cd ..
node server.js
```
or use `npm start` if configured.  
5. **Ensure Ollama** is running (daemon or foreground):
```
ollama run mistral
```
The Node server (or Python scripts) will call Ollama to generate LLM responses with doc chunks inserted as context.

---

## 5) Using the Chat UI

- Open a browser to `http://localhost:<port>` (depending on your Node setup).  
- Type your question. The Node app will:  
  1. Call the Python RAG service to find relevant doc chunks  
  2. Insert those chunks into the prompt for Ollama  
  3. Return the final Mistral-generated answer to the UI  

---

## 6) Additional Notes

- If Chroma complains about “deprecated config,” use `chromadb==0.3.26`.  
- Any **password-protected** PDFs may be skipped with warnings.  
- `.gitignore` excludes large artifacts like `node_modules`, `.pdfs`, `.wav`, `memory/`, and local Chroma DB files.  
- If you have encryption, chunk-size, or table-extraction issues, adjust `load_pdfs.py` or your PDF reading strategy.

---

You now have a local, self-hosted Mistral chatbot with RAG. If anything goes wrong, check logs in:
- `server.js` (Node logs)
- Python scripts (FastAPI or `load_pdfs.py`)
- Ollama’s console output  
