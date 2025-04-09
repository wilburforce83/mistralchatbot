from fastapi import FastAPI, Request
from pydantic import BaseModel
from embedder import embed_query
from vector_store import query_vector_store

app = FastAPI()

class QueryRequest(BaseModel):
    question: str

@app.post("/query")
async def query_endpoint(req: QueryRequest):
    question = req.question
    question_embedding = embed_query(question)
    top_docs = query_vector_store(question_embedding)
    return {"context": top_docs, "question": question}
