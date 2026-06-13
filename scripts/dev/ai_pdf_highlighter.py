#!/usr/bin/env python3
"""Local prototype for parser-owned PDF highlighting.

This script demonstrates the intended Citation Density anchoring pattern:
the parser extracts real text chunks and their coordinates, the AI may only
select known chunk IDs, and the renderer highlights parser-owned geometry.

It is intentionally not wired into production or Vercel build steps.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from typing import Iterable

try:
    import pymupdf
except ModuleNotFoundError:
    import fitz as pymupdf


DEFAULT_MODEL = "gpt-4.1-mini"


@dataclass(frozen=True)
class TextChunk:
    chunk_id: str
    page_index: int
    page_number: int
    text: str
    rect: tuple[float, float, float, float]
    quads: list[tuple[float, float, float, float, float, float, float, float]]


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def extract_text_chunks(input_path: str) -> list[TextChunk]:
    doc = pymupdf.open(input_path)
    chunks: list[TextChunk] = []

    for page_index, page in enumerate(doc):
        page_dict = page.get_text("dict")
        row_index = 0
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                text = normalize_text(" ".join(span.get("text", "") for span in spans))
                if not text:
                    continue

                rect = pymupdf.Rect(line["bbox"])
                quads = [
                    (
                        rect.x0,
                        rect.y0,
                        rect.x1,
                        rect.y0,
                        rect.x0,
                        rect.y1,
                        rect.x1,
                        rect.y1,
                    )
                ]
                row_index += 1
                chunks.append(
                    TextChunk(
                        chunk_id=f"p{page_index + 1}:line{row_index}",
                        page_index=page_index,
                        page_number=page_index + 1,
                        text=text,
                        rect=(rect.x0, rect.y0, rect.x1, rect.y1),
                        quads=quads,
                    )
                )

    doc.close()
    return chunks


def build_chunk_prompt(chunks: Iterable[TextChunk], instruction: str) -> list[dict[str, str]]:
    chunk_lines = "\n".join(
        f"{chunk.chunk_id}: {chunk.text}" for chunk in chunks
    )
    system = (
        "You select PDF text chunks for highlighting. "
        "Return JSON only with a top-level selected_chunk_ids array. "
        "You must choose only chunk IDs that appear in the provided list. "
        "Do not invent page coordinates, rectangles, quads, or new IDs."
    )
    user = (
        f"Highlighting instruction:\n{instruction}\n\n"
        "Known chunks:\n"
        f"{chunk_lines}\n\n"
        'Return exactly: {"selected_chunk_ids":["p1:line1"]}'
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def select_chunks_with_openai(chunks: list[TextChunk], instruction: str, model: str) -> list[str]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return []

    try:
        from openai import OpenAI
    except ModuleNotFoundError:
        print("openai package is not installed; using keyword fallback.", file=sys.stderr)
        return []

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        messages=build_chunk_prompt(chunks, instruction),
        temperature=0,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return []

    allowed_ids = {chunk.chunk_id for chunk in chunks}
    selected = parsed.get("selected_chunk_ids", [])
    if not isinstance(selected, list):
        return []
    return [
        chunk_id for chunk_id in selected
        if isinstance(chunk_id, str) and chunk_id in allowed_ids
    ]


def select_chunks_by_keywords(chunks: list[TextChunk], instruction: str) -> list[str]:
    terms = {
        "scan",
        "calibration",
        "adas",
        "aftermarket",
        "a/m",
        "lkq",
        "labor",
        "material",
        "rate",
        "link",
        "referenced",
        "supplier",
    }
    instruction_terms = {
        token.lower()
        for token in re.findall(r"[a-zA-Z0-9/]+", instruction)
        if len(token) > 2
    }
    terms |= instruction_terms & terms

    selected: list[str] = []
    for chunk in chunks:
        haystack = chunk.text.lower()
        if any(term in haystack for term in terms):
            selected.append(chunk.chunk_id)
    return selected


def highlight_selected_chunks(
    input_path: str,
    output_path: str,
    chunks: list[TextChunk],
    selected_chunk_ids: Iterable[str],
) -> int:
    selected = set(selected_chunk_ids)
    chunk_index = {chunk.chunk_id: chunk for chunk in chunks}
    doc = pymupdf.open(input_path)
    highlights_added = 0

    for chunk_id in selected:
        chunk = chunk_index.get(chunk_id)
        if not chunk:
            continue
        page = doc[chunk.page_index]
        rect = pymupdf.Rect(chunk.rect)
        annot = page.add_highlight_annot(rect)
        annot.set_info(
            title="Collision IQ prototype",
            content=f"{chunk.chunk_id}: {chunk.text}",
        )
        annot.update()
        highlights_added += 1

    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    return highlights_added


def write_chunks_json(path: str, chunks: list[TextChunk]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump([asdict(chunk) for chunk in chunks], handle, indent=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Prototype PDF highlighter: parser extracts real PDF coordinates, "
            "AI selects known chunk IDs, renderer applies highlights."
        )
    )
    parser.add_argument("input_pdf", help="Path to the source estimate PDF.")
    parser.add_argument("output_pdf", help="Path for the highlighted PDF.")
    parser.add_argument("instruction", help="Natural-language highlighting instruction.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"OpenAI model name. Default: {DEFAULT_MODEL}")
    parser.add_argument(
        "--chunks-json",
        help="Optional path to write extracted chunks and parser-owned coordinates as JSON.",
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Skip OpenAI and use the local keyword selector for smoke testing.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    chunks = extract_text_chunks(args.input_pdf)
    if args.chunks_json:
        write_chunks_json(args.chunks_json, chunks)

    selected_ids = [] if args.no_ai else select_chunks_with_openai(chunks, args.instruction, args.model)
    if not selected_ids:
        selected_ids = select_chunks_by_keywords(chunks, args.instruction)

    highlights_added = highlight_selected_chunks(
        args.input_pdf,
        args.output_pdf,
        chunks,
        selected_ids,
    )

    print(f"Extracted chunks: {len(chunks)}")
    print(f"Highlights added: {highlights_added}")
    print(f"Output path: {args.output_pdf}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
