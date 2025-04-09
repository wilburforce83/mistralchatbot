# load_pdfs.py
import os
import pdfplumber

# We need chroma_client for adding documents but no longer call persist()
from vector_store import add_documents, chroma_client

def chunk_text(text, chunk_size=300, overlap=50):
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = words[start:end]
        chunks.append(" ".join(chunk))
        start += chunk_size - overlap
    return chunks

def table_to_csv(table):
    lines = []
    for row in table:
        row_str = ",".join(cell if cell else "" for cell in row)
        lines.append(row_str)
    return "\n".join(lines)

def load_pdfs_into_chroma(pdf_folder="./.pdfs"):
    if not os.path.isdir(pdf_folder):
        print(f"Folder does not exist: {pdf_folder}")
        return

    for root, dirs, files in os.walk(pdf_folder):
        for file in files:
            if file.lower().endswith(".pdf"):
                pdf_path = os.path.join(root, file)
                print(f"Loading PDF: {pdf_path}")

                try:
                    with pdfplumber.open(pdf_path) as pdf:
                        for page_num, page in enumerate(pdf.pages, start=1):
                            page_text = page.extract_text() or ""
                            tables = page.extract_tables() or []

                            # Process main text
                            if page_text.strip():
                                text_chunks = chunk_text(page_text)
                                for chunk in text_chunks:
                                    doc_metadata = {
                                        "source_file": file,
                                        "folder": root,
                                        "page_number": page_num,
                                        "type": "page_text"
                                    }
                                    add_documents([chunk], [doc_metadata])

                            # Process tables
                            for table_idx, table_data in enumerate(tables):
                                csv_string = table_to_csv(table_data)
                                table_chunks = chunk_text(csv_string)
                                for chunk in table_chunks:
                                    doc_metadata = {
                                        "source_file": file,
                                        "folder": root,
                                        "page_number": page_num,
                                        "table_index": table_idx + 1,
                                        "type": "page_table"
                                    }
                                    add_documents([chunk], [doc_metadata])

                except Exception as e:
                    print(f"**WARNING**: Could not process {pdf_path} due to error:\n{e}\nSkipping...")

if __name__ == "__main__":
    load_pdfs_into_chroma(pdf_folder="./.pdfs")
    print("All done! Data stored automatically in your persist_directory.")
