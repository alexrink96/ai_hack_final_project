import os
from openai import OpenAI
from dotenv import load_dotenv
import time
import random
import numpy as np
import re
import pickle
import pandas as pd
import faiss
from collections import defaultdict

load_dotenv()

LLM_API_KEY = os.getenv("LLM_API_KEY")
CHUNKS_INDEX_PATH = "static/kb_index_chunks.faiss"
CHUNKS_VECTORS_PATH = "static/kb_vectors_chunks.pkl"
CHUNKS_TEXTS_PATH = "static/kb_texts_chunks.pkl"
TRAIN_DATA_PATH = "static/train_data.csv"
NUMBER_OF_NEAREST_NEIGHBORS = 40
KNN_SCORE_THRESHOLD  = 0.1
CONTEXT_MAX_LENGTH = 10000

df = pd.read_csv(TRAIN_DATA_PATH)

def get_embedding(text: str):
    client = OpenAI(
      base_url="https://openrouter.ai/api/v1",
      api_key=LLM_API_KEY,
    )
    for attempt in range(5):
        try:
            embedding = client.embeddings.create(
              model="openai/text-embedding-3-small",
              input=text,
              encoding_format="float"
            )
            return np.array(embedding.data[0].embedding, dtype=np.float32)
        except Exception as e:
            if "429" in str(e):
                print("⏳ Лимит достигнут, жду 8 секунд и пробую снова...")
                time.sleep(8)
            else:
                print(e)
                print("Ошибка в get_embedding, пробую снова.")
    return "⚠️ Ошибка: не удалось получить ответ после 5 попыток."
    


def extract_section(full_text, chunk):
    """
    Возвращает Markdown-раздел (## ... до следующего ##)
    в котором встречается данный чанк.
    """
    if not isinstance(full_text, str):
        return None

    section_positions = [m.start() for m in re.finditer(r'^##\s', full_text, flags=re.MULTILINE)]
    section_positions.append(len(full_text))

    chunk_pos = full_text.find(chunk[:100])
    if chunk_pos == -1:
        return None

    section_start = 0
    for pos in section_positions:
        if pos < chunk_pos:
            section_start = pos
        else:
            break

    section_end_candidates = [pos for pos in section_positions if pos > section_start]
    section_end = section_end_candidates[0] if len(section_end_candidates) > 0 else len(full_text)

    section_text = full_text[section_start:section_end].strip()
    return section_text if len(section_text) > 0 else None

    
def add_metadata_to_context(context):
    final_context = []

    for sec in context:
        matched_row = None

        for _, row in df.iterrows():
            if isinstance(row["text"], str) and sec[:80] in row["text"]:
                matched_row = row
                break

        if matched_row is not None:
            final_context.append({
                "doc_id": matched_row["id"],
                "tags": matched_row["tags"],
                "annotation": matched_row["annotation"],
                "content": sec.strip()
            })
        else:
            final_context.append({
                "doc_id": None,
                "tags": None,
                "content": sec.strip()
            })
    return final_context
    
def structure_context(context):

    grouped = defaultdict(lambda: {"annotation": None, "tags": None, "chunks": []})

    for item in context:
        doc_id = item.get("doc_id")
        if doc_id is None:
            continue  

        if grouped[doc_id]["annotation"] is None:
            grouped[doc_id]["annotation"] = item.get("annotation")

        if grouped[doc_id]["tags"] is None:
            grouped[doc_id]["tags"] = item.get("tags")

        grouped[doc_id]["chunks"].append(item["content"].strip())

    restructured_context = []
    for doc_id, data in grouped.items():
        chunks_list = [
            {f"chunk_{i+1}": text} for i, text in enumerate(data["chunks"])
        ]
        restructured_context.append({
            "article_id": doc_id,
            "article_annotation": data["annotation"],
            "article_tags": data["tags"],
            "article_chunks": chunks_list
        })

    return restructured_context

def get_context_for_answer(query):
    if all(os.path.exists(p) for p in [CHUNKS_INDEX_PATH, CHUNKS_VECTORS_PATH, CHUNKS_TEXTS_PATH]):
        print("✅ Загружаем сохранённый индекс чанков...")
        with open(CHUNKS_TEXTS_PATH, "rb") as f:
            chunk_texts_list = pickle.load(f)
        with open(CHUNKS_VECTORS_PATH, "rb") as f:
            chunk_vectors = pickle.load(f)
        chunk_index = faiss.read_index(CHUNKS_INDEX_PATH)
    
    query_vec = np.array(get_embedding("query: " + query), dtype=np.float32)
    faiss.normalize_L2(query_vec.reshape(1, -1))
    
    # --- Поиск по чанкам ---
    D_c, I_c = chunk_index.search(query_vec.reshape(1, -1), NUMBER_OF_NEAREST_NEIGHBORS)
    chunk_candidates = [chunk_texts_list[i] for i in I_c[0]]
    chunk_knn_scores = D_c[0].tolist()
    
    chunk_results = sorted(
        [
            {
                "text": chunk_candidates[j],
                "knn": chunk_knn_scores[j],
            }
            for j in range(len(chunk_candidates))
        ],
        key=lambda x: x["knn"],
        reverse=True
    )
    
    sections = []
    for rank, r in enumerate(chunk_results, 1):
        
        if r["knn"] <= KNN_SCORE_THRESHOLD:
            continue
        
        chunk_text = r["text"]
        
        matched_article = next((t for t in df["text"].tolist() if chunk_text[:50] in t), None)

        if matched_article:
            section = extract_section(matched_article, chunk_text)
        else:
            section = chunk_text
            
        if section not in sections:
            sections.append(section)


    context = []
    for sec in sections:
        try:
            context_length = sum(len(i) for i in context)
            if context_length + len(sec) > CONTEXT_MAX_LENGTH:
                remaining = CONTEXT_MAX_LENGTH - context_length
                if remaining > 0:
                    context.append(sec[:remaining])
                REACHED_CONTEXT_LIMIT = True
                break
            else:
                context.append(sec)
        except TypeError as e:
            print(f"\n===============================")
            print("Ошибка при создании контекста.")
            print(f"Ошибка: {e}")
            print(f"\n===============================")
            continue
    
    context = add_metadata_to_context(context)
    
    context = structure_context(context)

    return context
