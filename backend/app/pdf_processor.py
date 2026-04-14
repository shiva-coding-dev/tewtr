import fitz  # PyMuPDF
import os
from typing import List, Dict, Any

class PDFProcessor:
    @staticmethod
    def split_pdf_to_pages(file_path: str) -> List[Dict[str, Any]]:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")
        doc = fitz.open(file_path)
        pages = []
        for i in range(len(doc)):
            page = doc.load_page(i)
            pages.append({
                "index": i,
                "page_number": i + 1,
                "width": page.rect.width,
                "height": page.rect.height
            })
        doc.close()
        return pages
    @staticmethod
    def get_page_image(file_path: str, page_index: int) -> bytes:
        doc = fitz.open(file_path)
        if page_index < 0 or page_index >= len(doc):
            doc.close()
            raise IndexError("Page index out of range")
        page = doc.load_page(page_index)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img_bytes = pix.tobytes("png")
        doc.close()
        return img_bytes

    @staticmethod
    def get_page_base64(file_path: str, page_index: int) -> str:
        import base64
        img_bytes = PDFProcessor.get_page_image(file_path, page_index)
        return base64.b64encode(img_bytes).decode('utf-8')
