"""VERO Chunking: Hierarchical Structure-Aware Chunker.

Creates a two-level hierarchy:
  Level 0 (Section): Large context-rich chunks that capture an entire section
  Level 1 (Paragraph): Smaller search-optimized chunks linked to their parent section

Search matches on Level-1 (paragraph) chunks for precision,
but the agent can fetch the Level-0 parent for broader context.
"""

import re
import uuid
from app.schema import ChunkResponse
from .base import BaseChunker


# Heading patterns for structure detection
_HEADING_RE = re.compile(
    r'^(#{1,4})\s+(.+)$',   # Markdown headings: # H1, ## H2, etc.
    re.MULTILINE,
)

# Fallback: detect structure from blank-line-separated paragraphs
_PARAGRAPH_SEP = re.compile(r'\n\s*\n')


class HierarchicalChunker(BaseChunker):
    """
    Structure-aware hierarchical chunker that creates parent-child relationships.

    For structured text (markdown, headings):
      - Splits by headings into sections (Level 0)
      - Each section is further split into paragraph chunks (Level 1)
      - Each paragraph chunk stores its parent section ID

    For unstructured text (plain text, PDFs):
      - Groups paragraphs into logical sections by proximity
      - Creates section-level summaries as Level 0 chunks
      - Paragraph-level chunks as Level 1
    """

    def __init__(self, token_limit: int = 500, section_token_limit: int = 1500, overlap: int = 50):
        super().__init__(token_limit=token_limit)
        self.section_token_limit = section_token_limit
        self.overlap = overlap

    def chunk(self, text: str, doc_id: str, project_id: str, doc_title: str = "") -> list[ChunkResponse]:
        """Split text into hierarchical chunks."""
        # Detect if text has markdown headings
        headings = list(_HEADING_RE.finditer(text))

        if headings:
            return self._chunk_with_headings(text, headings, doc_id, project_id, doc_title)
        else:
            return self._chunk_unstructured(text, doc_id, project_id, doc_title)

    def _chunk_with_headings(
        self, text: str, headings: list, doc_id: str, project_id: str, doc_title: str
    ) -> list[ChunkResponse]:
        """Split structured text by headings into section + paragraph hierarchy."""
        chunks: list[ChunkResponse] = []

        # Build sections from heading positions
        sections = []
        for i, match in enumerate(headings):
            level = len(match.group(1))  # Number of # characters
            title = match.group(2).strip()
            start = match.start()
            end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
            section_text = text[start:end].strip()

            if section_text and self.count_tokens(section_text) > 5:
                sections.append({
                    "title": title,
                    "heading_level": level,
                    "text": section_text,
                    "start": start,
                    "end": end,
                })

        # Build breadcrumb hierarchy
        heading_stack: list[str] = []

        for section in sections:
            h_level = section["heading_level"]

            # Trim stack to current level
            while len(heading_stack) >= h_level:
                heading_stack.pop()
            heading_stack.append(section["title"])

            breadcrumb = " > ".join(heading_stack)
            section_id = uuid.uuid4().hex[:12]

            # Level 0: Section chunk (full section content for context)
            section_context = f"[Source: {doc_title}]\n[{breadcrumb}]\n" if doc_title else f"[{breadcrumb}]\n"
            full_section_text = section_context + section["text"]

            # If the section fits in our section_token_limit, keep it as one chunk
            section_tokens = self.count_tokens(full_section_text)

            if section_tokens <= self.section_token_limit:
                chunks.append(ChunkResponse(
                    id=section_id,
                    doc_id=doc_id,
                    project_id=project_id,
                    text=full_section_text,
                    start_char=section["start"],
                    end_char=section["end"],
                    token_count=section_tokens,
                    strategy="hierarchical",
                    level=0,
                    parent_id=None,
                    metadata={
                        "doc_title": doc_title,
                        "breadcrumbs": breadcrumb,
                        "heading_level": h_level,
                    }
                ))

            # Level 1: Paragraph chunks within this section
            paragraphs = _PARAGRAPH_SEP.split(section["text"])
            current_para = ""
            para_start = section["start"]

            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                candidate = (current_para + "\n\n" + para).strip() if current_para else para

                if self.count_tokens(candidate) > self.token_limit and current_para:
                    # Flush current paragraph chunk
                    para_context = f"[Source: {doc_title}]\n[{breadcrumb}]\n" if doc_title else f"[{breadcrumb}]\n"
                    contextualized = para_context + current_para

                    chunks.append(ChunkResponse(
                        id=uuid.uuid4().hex[:12],
                        doc_id=doc_id,
                        project_id=project_id,
                        text=contextualized,
                        start_char=para_start,
                        end_char=para_start + len(current_para),
                        token_count=self.count_tokens(contextualized),
                        strategy="hierarchical",
                        level=1,
                        parent_id=section_id,
                        metadata={
                            "doc_title": doc_title,
                            "breadcrumbs": breadcrumb,
                            "parent_section": section["title"],
                        }
                    ))
                    para_start = para_start + len(current_para)
                    current_para = para
                else:
                    current_para = candidate

            # Flush remaining
            if current_para.strip():
                para_context = f"[Source: {doc_title}]\n[{breadcrumb}]\n" if doc_title else f"[{breadcrumb}]\n"
                contextualized = para_context + current_para

                chunks.append(ChunkResponse(
                    id=uuid.uuid4().hex[:12],
                    doc_id=doc_id,
                    project_id=project_id,
                    text=contextualized,
                    start_char=para_start,
                    end_char=section["end"],
                    token_count=self.count_tokens(contextualized),
                    strategy="hierarchical",
                    level=1,
                    parent_id=section_id,
                    metadata={
                        "doc_title": doc_title,
                        "breadcrumbs": breadcrumb,
                        "parent_section": section["title"],
                    }
                ))

        return chunks if chunks else self._chunk_unstructured(text, doc_id, project_id, doc_title)

    def _chunk_unstructured(
        self, text: str, doc_id: str, project_id: str, doc_title: str
    ) -> list[ChunkResponse]:
        """Split unstructured text into paragraph-grouped sections."""
        chunks: list[ChunkResponse] = []
        paragraphs = _PARAGRAPH_SEP.split(text)

        # Group paragraphs into sections of ~section_token_limit tokens
        current_section: list[str] = []
        current_tokens = 0
        section_start = 0
        section_num = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            para_tokens = self.count_tokens(para)

            if current_tokens + para_tokens > self.section_token_limit and current_section:
                # Flush section
                section_num += 1
                section_id = uuid.uuid4().hex[:12]
                section_text = "\n\n".join(current_section)
                section_end = section_start + len(section_text)

                label = f"Section {section_num}"
                section_context = f"[Source: {doc_title}]\n[{label}]\n" if doc_title else f"[{label}]\n"

                # Level 0: Section chunk
                full_section = section_context + section_text
                chunks.append(ChunkResponse(
                    id=section_id,
                    doc_id=doc_id,
                    project_id=project_id,
                    text=full_section,
                    start_char=section_start,
                    end_char=section_end,
                    token_count=self.count_tokens(full_section),
                    strategy="hierarchical",
                    level=0,
                    parent_id=None,
                    metadata={"doc_title": doc_title, "section_num": section_num}
                ))

                # Level 1: Paragraph chunks within this section
                self._create_paragraph_chunks(
                    chunks, current_section, section_id, section_start,
                    doc_id, project_id, doc_title, label
                )

                section_start = section_end
                current_section = [para]
                current_tokens = para_tokens
            else:
                current_section.append(para)
                current_tokens += para_tokens

        # Flush remaining
        if current_section:
            section_num += 1
            section_id = uuid.uuid4().hex[:12]
            section_text = "\n\n".join(current_section)
            section_end = section_start + len(section_text)

            label = f"Section {section_num}"
            section_context = f"[Source: {doc_title}]\n[{label}]\n" if doc_title else f"[{label}]\n"

            full_section = section_context + section_text
            chunks.append(ChunkResponse(
                id=section_id,
                doc_id=doc_id,
                project_id=project_id,
                text=full_section,
                start_char=section_start,
                end_char=section_end,
                token_count=self.count_tokens(full_section),
                strategy="hierarchical",
                level=0,
                parent_id=None,
                metadata={"doc_title": doc_title, "section_num": section_num}
            ))

            self._create_paragraph_chunks(
                chunks, current_section, section_id, section_start,
                doc_id, project_id, doc_title, label
            )

        return chunks

    def _create_paragraph_chunks(
        self,
        chunks: list[ChunkResponse],
        paragraphs: list[str],
        parent_id: str,
        base_offset: int,
        doc_id: str,
        project_id: str,
        doc_title: str,
        section_label: str,
    ):
        """Create Level-1 paragraph chunks from a list of paragraph texts."""
        current_chunk = ""
        chunk_start = base_offset

        for para in paragraphs:
            candidate = (current_chunk + "\n\n" + para).strip() if current_chunk else para

            if self.count_tokens(candidate) > self.token_limit and current_chunk:
                # Flush
                context = f"[Source: {doc_title}]\n[{section_label}]\n" if doc_title else f"[{section_label}]\n"
                contextualized = context + current_chunk

                chunks.append(ChunkResponse(
                    id=uuid.uuid4().hex[:12],
                    doc_id=doc_id,
                    project_id=project_id,
                    text=contextualized,
                    start_char=chunk_start,
                    end_char=chunk_start + len(current_chunk),
                    token_count=self.count_tokens(contextualized),
                    strategy="hierarchical",
                    level=1,
                    parent_id=parent_id,
                    metadata={
                        "doc_title": doc_title,
                        "section": section_label,
                    }
                ))
                chunk_start += len(current_chunk)
                current_chunk = para
            else:
                current_chunk = candidate

        # Flush remaining
        if current_chunk.strip():
            context = f"[Source: {doc_title}]\n[{section_label}]\n" if doc_title else f"[{section_label}]\n"
            contextualized = context + current_chunk

            chunks.append(ChunkResponse(
                id=uuid.uuid4().hex[:12],
                doc_id=doc_id,
                project_id=project_id,
                text=contextualized,
                start_char=chunk_start,
                end_char=chunk_start + len(current_chunk),
                token_count=self.count_tokens(contextualized),
                strategy="hierarchical",
                level=1,
                parent_id=parent_id,
                metadata={
                    "doc_title": doc_title,
                    "section": section_label,
                }
            ))
