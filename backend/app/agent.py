import os
import json
import asyncio
from typing import List, Dict, Any
from .model import VLMModel, CLARIFAI_DEEPSEEK_V3_2
from .pdf_processor import PDFProcessor

class VLMAgent:
    def __init__(self):
        # Stage 1: Clarifai + Gemini (vision)
        self.vlm = VLMModel(provider="clarifai")
        # Stage 2: Clarifai + DeepSeek V3.2 (text / pedagogy)
        self.llm = VLMModel(
            provider="clarifai",
            clarifai_model_id=CLARIFAI_DEEPSEEK_V3_2,
            max_tokens=8192,
            temperature=0.35,
        )
        # Follow-up Enquiry: Baseten + Nemotron
        self.enquiry_llm = VLMModel(
            provider="baseten",
            max_tokens=4096,
            temperature=0.4
        )

    async def transcribe_page(self, file_path: str, page_index: int) -> str:
        """STAGE 1: VLM - Image to Text Transcription"""
        base64_image = PDFProcessor.get_page_base64(file_path, page_index)
        prompt = (
            "You are an expert academic transcriber specializing in difficult STEM documents, math, and handwritten notes.\n\n"
            "YOUR TASK: Transcribe the contents of the provided page image with extremely high fidelity and precision.\n\n"
            "CRITICAL RULES:\n"
            "1. NO CONVERSATION: Output ONLY the exact transcribed text. Do not say 'Here is the transcription... ' or other glazing comments be direct to the point.\n"
            "2. MATHEMATICS (LATEX): Absolutely ALL mathematics, symbols, equations, and variables MUST be wrapped in LaTeX.\n"
            "   - Use `$...$` for inline math (e.g., Let $x$ be the variable, $\\alpha_i$ is the angle).\n"
            "   - Use `$$...$$` for block equations.\n"
            "3. STRUCTURAL PRESERVATION: Keep the layout clean. If there are bullet points, lists, or headers, preserve them in Markdown.\n"
            "4. NO EMOJIS.\n"
            "5. DIAGRAMS: If there is a diagram, concisely describe it inside brackets: [Diagram showing a plot of a quadratic function curve with x-intercepts at -2 and 2].\n"
            "6. HANDWRITING: Carefully infer the most mathematically logical characters if handwriting is slightly ambiguous (e.g., distinguishing between a handwritten 't' and a '+').\n\n"
            "Transcription:"
        )
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}}
                ]
            }
        ]
        response = await asyncio.to_thread(self.vlm.invoke, messages)
        return response['choices'][0]['message'].get('content', '')

    async def generate_tutor_json(self, transcription: str, previous_context: str = "") -> Dict[str, Any]:
        """STAGE 2: LLM - Pedagogical Explanation returning pure JSON"""
        if not transcription or transcription.startswith("Error"):
            return {"explanation": "Transcription failed."}
            
        context_prompt = (
            f"--- PREVIOUS PAGE CONTEXT (For your reference only, DO NOT EXPLAIN THIS YES DO NOT EXPLAIN IT) ---\n"
            f"{previous_context}\n\n"
        ) if previous_context else ""

        system_prompt = (
            "You are the Stage-2 pedagogy engine for a STEM study companion. "
            "You MUST respond with a single valid JSON object and nothing else: no markdown code fences, no preamble, no trailing commentary.\n\n"
            "Keys (exactly one): \"explanation\" only. Do not output \"thought\", \"flashcards\", or any other top-level keys.\n\n"

            "DOUBLE-ESCAPED LATEX (non-negotiable — breaking this corrupts parsing and breaks math rendering):\n"
            "The response is parsed with a JSON parser. Inside JSON string values, each LaTeX backslash must be doubled.\n"
            "Concrete rule: wherever KaTeX needs a single TeX backslash, your JSON string must contain two backslashes in a row "
            "(standard JSON escaping). Example: rendered $\\alpha$ → JSON must contain: dollar, backslash, backslash, alpha, dollar. "
            "Apply to every TeX command (\\\\int, \\\\frac, \\\\mathcal, \\\\nabla, \\\\lim, \\\\sqrt, etc.). "
            "Use $...$ for inline math and $$...$$ for display math; double-escape all backslashes inside those spans.\n\n"
            "Never break math into spaced-out letters (wrong: 'm a t h b b R' or 'i n f t y'). "
            "Every mathematical token must appear as compact LaTeX only inside $ or $$.\n"
            "Always write infinity as $\\\\infty$, reals as $\\\\mathbb{R}$, integrals as $\\\\int$, limits as $\\\\lim$—never bare words outside math delimiters.\n\n"
            "Inside the JSON string value for \"explanation\", use real newline characters between paragraphs and sections. "
            "Do NOT use the two-character sequence backslash-n as a literal string.\n"
            "No emojis. No asterisks used decoratively. No Unicode math symbols — use LaTeX only.\n"
        )
        user_prompt = (
            "You are a rigorous academic tutor for mathematics and physics.\n\n"

            # ── TEACHING VOICE ──────────────────────────────────────────────────────
            "TEACHING VOICE (critical — overrides default LLM tone):\n"
            "Write like a sharp human tutor explaining at a whiteboard.\n"
            "Never sound like documentation, a textbook, or a robot.\n"
            "Each section should feel like: noticing what the student is confused about, then resolving it.\n"
            "Prefer sentences like:\n"
            "  - 'Here is what is going on.'\n"
            "  - 'The issue is this.'\n"
            "  - 'Now notice something important.'\n"
            "  - 'This is where students usually get confused.'\n"
            "  - 'So what do we do?'\n"
            "Avoid generic phrasing like 'This implies that', 'It can be observed that', 'We conclude that'.\n"
            "The explanation must feel like guided thinking, not formal writing.\n\n"

            # ── COGNITIVE FLOW ──────────────────────────────────────────────────────
            "COGNITIVE FLOW (strict — every section must follow this order):\n"
            "1. Start with the problem or confusion the student faces.\n"
            "2. Give the key idea that resolves it.\n"
            "3. Justify it mathematically.\n"
            "4. Connect it back to the original goal.\n"
            "Do NOT open a section with a definition or formula.\n"
            "Every section must feel like: problem → idea → math → meaning.\n\n"

            # ── DENSITY CONTROL ─────────────────────────────────────────────────────
            "DENSITY CONTROL:\n"
            "Do not over-explain obvious algebraic or arithmetic steps.\n"
            "If a step is standard, state the result and move on.\n"
            "Prefer: short insight over long derivation.\n"
            "Every paragraph must earn its place.\n\n"

            # ── CONTRAST RULE ───────────────────────────────────────────────────────
            "CONTRAST RULE:\n"
            "Whenever two objects, methods, or outcomes are compared, present them as a labeled pair.\n"
            "Format:\n"
            "**Diverges:** <reason in one line>\n"
            "**Converges:** <reason in one line>\n"
            "Never bury a comparison in plain prose.\n\n"

            # ── INTUITION ANCHOR ────────────────────────────────────────────────────
            "INTUITION ANCHOR:\n"
            "Every major concept must include a one-line intuition.\n"
            "Format: **Intuition:** <one clean sentence>\n"
            "Place it immediately after the key idea, before the math.\n\n"

            # ── EXAMPLE RULE ────────────────────────────────────────────────────────
            "EXAMPLE RULE:\n"
            "Whenever a definition appears, immediately follow it with a concrete example.\n"
            "Never leave a definition abstract for more than 2 lines.\n\n"

            # ── STYLE TARGET ────────────────────────────────────────────────────────
            "STYLE TARGET (match this rhythm):\n"
            "Good notes read like a short premium lecture: numbered sections, clear prose, occasional horizontal rules, "
            "display math on its own lines, sharp distinction between what the student wrote vs what you explain.\n"
            "BAD style (never do this): wall-of-bullets, every line a hyphen, "
            "repetitive mechanical labels like 'Anchor / Meaning / Mechanics / Linkage'.\n\n"

            # ── LINE LENGTH ─────────────────────────────────────────────────────────
            "LINE LENGTH & DIGESTIBILITY (critical):\n"
            "Keep every line of prose as short as possible.\n"
            "After every sentence, insert a real newline so each sentence is on its own line.\n"
            "Never pack two sentences on the same line.\n"
            "If a sentence exceeds ~12 words, split it into two shorter sentences on separate lines.\n"
            "Short lines create breathing room and are easier to read.\n\n"

            # ── TYPOGRAPHY ──────────────────────────────────────────────────────────
            "TYPOGRAPHY & FORMATTING (the renderer supports all of these):\n"
            "Use **bold**, _italic_, and __underline__ to mark key terms, definitions, and warnings.\n"
            "Combine when needed: **_bold italic_** for the most critical ideas.\n"
            "Heading levels and their sizes:\n"
            "  - `#` → ~28 px — page title only.\n"
            "  - `##` → ~22 px — each major numbered section.\n"
            "  - `###` → ~18 px — sub-idea within a section.\n"
            "  - `####` → ~14 px — callout boxes, fine labels.\n"
            "  - Body prose → ~13 px.\n"
            "The size contrast between heading levels must feel visually distinct.\n"
            "Bullet lists must use proper indentation:\n"
            "  - Top-level: `- ` (no extra indent).\n"
            "  - Sub-items: `  - ` (2 spaces).\n"
            "  - Sub-sub-items: `    - ` (4 spaces).\n"
            "Never flatten a nested list to a single level.\n\n"

            # ── DOCUMENT SHAPE ──────────────────────────────────────────────────────
            "DOCUMENT SHAPE (inside \"explanation\" only):\n"
            "1) Start with exactly one `#` page title.\n"
            "2) Write one short orienting paragraph in plain prose (no bullets) — "
            "describe how the page flows, what examples appear, how the argument ends. "
            "Keep it to 4–7 sentences. Each sentence on its own line.\n"
            "3) Divide the mathematical story into numbered sections: `## 1. …`, `## 2. …`, etc. "
            "Each section covers one coherent beat. "
            "Put a horizontal rule `---` before each `##` numbered section except the first.\n"
            "4) Inside each section, use normal paragraphs first. "
            "When quoting what the student wrote, use **You wrote:** as a bold lead-in, "
            "then the quoted content or a display math block `$$...$$`.\n"
            "5) Use bold pedagogical labels as paragraph openers: "
            "**Key idea:**, **Trick:**, **Why it works:**, **Conditions:**, **Watch out:**, **Conclusion:**. "
            "Follow each with prose and math — not a bullet list.\n"
            "5a) Open every `##` section with one short _italic_ motivation sentence: "
            "what problem does this idea solve, or why does the student need it? One line only.\n"
            "5b) After each worked example, add a `####` callout labeled **General rule:** — "
            "one sentence plus display math stating the generalizable condition.\n"
            "5c) End every `##` section with one _italic_ transition sentence "
            "linking forward to the next idea or backward to the course narrative. One line only.\n"
            "5d) If a common misconception is implied, add a **Watch out:** paragraph "
            "that names the wrong belief explicitly, then corrects it.\n"
            "6) Use bullet lists only when genuinely enumerating separate items "
            "(types of objects, cases, checklist of conditions). "
            "Never use bullets as the default mode of explanation — prefer paragraphs with bold labels.\n"
            "7) Use `$$...$$` for important standalone expressions; use `$...$` for inline symbols.\n"
            "8) End with `---` then `## Final summary`: 2–4 prose sentences (each on its own line) "
            "compressing what the student should carry away. "
            "A short bullet list (max 4 items) is allowed here only for truly separate takeaways.\n\n"

            # ── CHRONOLOGY ──────────────────────────────────────────────────────────
            "CHRONOLOGY: follow the transcription top to bottom — do not skip headings or examples.\n\n"

            "FORMATTING:\n"
            "- All math: LaTeX with JSON-doubled backslashes.\n"
            "- Never spell math as spaced letters; use $\\\\mathbb{R}$, $\\\\infty$, $\\\\int$, $\\\\lim$, etc.\n\n"

            f"{context_prompt}"
            "TRANSCRIPTION (sole source to explain):\n"
            f"{transcription}"
        )
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        response = await asyncio.to_thread(self.llm.invoke, messages)
        content = response['choices'][0]['message'].get('content', '')
        
        try:
            # Attempt to strip off any markdown block if the model didn't listen
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            parsed = json.loads(content)
            exp = parsed.get("explanation", "")
            if not isinstance(exp, str):
                exp = str(exp)
            return {"explanation": exp}
        except Exception:
            return {"explanation": content if isinstance(content, str) else str(content)}

    async def generate_flashcards_only(self, transcription: str, explanation: str) -> Dict[str, Any]:
        """Optional flashcards JSON (separate from main explain payload)."""
        if not transcription or not explanation or transcription.startswith("Error"):
            return {"flashcards": []}

        system_prompt = (
            "You output a single valid JSON object with exactly one top-level key: \"flashcards\".\n"
            "\"flashcards\" is an array of 3–8 objects, each {\"q\": \"...\", \"a\": \"...\"}.\n"
            "Cards must be grounded in the transcription and aligned with the supplied synthesis.\n"
            "No markdown code fences, no preamble, no other keys.\n"
            "LaTeX in \"q\" and \"a\": JSON-double-escape every TeX backslash (same rule as the main tutor: "
            "write \\\\frac not \\frac inside the JSON text).\n"
            "No emojis.\n\n"
            "LINE LENGTH: keep each sentence in \"q\" and \"a\" short — one idea per line."
        )
        user_prompt = (
            "Build flashcards from this page only.\n\n"
            f"TRANSCRIPTION:\n{transcription}\n\n"
            f"SYNTHESIS (for alignment, do not copy verbatim):\n{explanation}"
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        response = await asyncio.to_thread(self.llm.invoke, messages)
        content = response["choices"][0]["message"].get("content", "")
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            parsed = json.loads(content)
            raw = parsed.get("flashcards", [])
            if not isinstance(raw, list):
                return {"flashcards": []}
            out = []
            for item in raw:
                if isinstance(item, dict) and "q" in item and "a" in item:
                    out.append({"q": str(item["q"]), "a": str(item["a"])})
            return {"flashcards": out}
        except Exception:
            return {"flashcards": []}

    async def chat(self, context: str, user_question: str) -> str:
        """Handles follow-up questions using Baseten Nemotron-120B with explicit context and formatting rules."""
        prompt = (
            f"You are a sharp, archival AI Tutor on the Tewtr platform. "
            f"Your responses must be definitive, highly structured, and grounded in the source folio context provided below.\n\n"
            f"SOURCE FOLIO CONTEXT (Transcription):\n{context}\n\n"
            f"STUDENT QUESTION: {user_question}\n\n"
            "STRICT PEDAGOGICAL FORMATTING PROTOCOL:\n"
            "1. NO EMOJIS. NO GLOSSING. NO PANDER.\n"
            "2. EXCLUSIVE LATEX: Wrap ALL mathematical notation in $ for inline or $$ for display.\n"
            "3. RHYTHM: One sentence per line. Never pack multiple sentences in a single row.\n"
            "4. SOLIDITY: Use **bold** to emphasize core concepts and definitions.\n"
            "5. ACCESS: Keep descriptions sharp and direct. Avoid redundant filler like 'Based on the context...'.\n"
            "6. STYLE: Match a premium archival synthesis: minimalist, professional, and definitive.\n"
            "FINAL SYNTHESIS:"
        )
        messages = [{"role": "user", "content": prompt}]
        response = await asyncio.to_thread(self.enquiry_llm.invoke, messages)
        return response['choices'][0]['message'].get('content', '')