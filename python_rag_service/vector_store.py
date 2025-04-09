# vector_store.py
import os
from typing import List, Dict
import chromadb
from chromadb.config import Settings
from embedder import embed_texts

chroma_client = chromadb.Client(
    Settings(
        chroma_db_impl="duckdb+parquet",
        persist_directory="./chroma_db"  # this folder will store your DB
    )
)

print("[vector_store] Using Chroma 0.3.26 with duckdb+parquet in ./chroma_db")

collection = chroma_client.get_or_create_collection("my_collection")

def add_documents(docs: List[str], metadatas: List[Dict] = None):
    if metadatas is None:
        metadatas = [{} for _ in docs]

    embeddings = embed_texts(docs)
    doc_ids = [f"doc_{collection.count() + i}" for i in range(len(docs))]

    collection.add(
        documents=docs,
        embeddings=embeddings,
        metadatas=metadatas,
        ids=doc_ids
    )
    print(f"[vector_store] Added {len(docs)} docs. Total so far = {collection.count()}")

def query_vector_store(query_embedding, top_k=3) -> List[Dict]:
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k
    )
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]

    combined = []
    for doc, meta in zip(documents, metadatas):
        combined.append({
            "text": doc,
            "metadata": meta
        })
    return combined
