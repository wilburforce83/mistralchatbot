# embedder.py
import os
from sentence_transformers import SentenceTransformer

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_model = None

def get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model

def embed_texts(texts):
    """
    Returns a pure Python list of lists,
    so Chroma won't complain about NumPy arrays.
    """
    model = get_model()
    embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
    # Convert from NumPy array (shape: [num_texts, emb_dim]) to list of lists
    return embeddings.tolist()

def embed_query(query):
    # This also returns a single embedding as a list of floats
    return embed_texts([query])[0]
