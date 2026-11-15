"""Make a reviewable, deliberately unassigned dialogue draft from a story."""
from __future__ import annotations

import re

from .planner import PlanError, matches, plain, prepare_words

# Conservative heuristics: a skipped piece is listed for human inspection.
# The story is prose, not a screenplay with guaranteed speaker labels.
_AUTHOR_WORDS = re.compile(
    r"\b(?:сказал\w*|ответил\w*|спросил\w*|прошептал\w*|прошепт\w*|"
    r"прохрипел\w*|прохрип\w*|выдохнул\w*|пробормотал\w*|проговорил\w*|"
    r"отозвал\w*|вскрикнул\w*|взревел\w*|заорал\w*|сорвал\w*|"
    r"осип\w*|осек\w*|замедлил\w*|воскликнул\w*)\b"
)


def _looks_like_author(text):
    # Only lowercase pieces after a dash are eligible. Uppercase may begin a
    # new sentence of dialogue. A match can still be wrong, so expose skips.
    stripped = text.lstrip(" «»\"“”")
    if not stripped or not stripped[0].islower():
        return False
    first_words = " ".join(plain(stripped).lower().replace("ё", "е").split()[:12])
    return bool(_AUTHOR_WORDS.search(first_words))


def draft_from_story(story, words):
    """Return (draft plan, notes). Never guess a speaker or approve the draft.

    Only paragraphs beginning with an em dash are considered. The dash can
    separate dialogue, a narrator's aside, or an interruption: review is needed.
    """
    if not isinstance(story, str):
        raise PlanError("История должна быть текстом")
    words, norm = prepare_words(words)
    cues, notes = [], []
    for paragraph, line in enumerate((p.strip() for p in story.splitlines() if p.strip()), 1):
        if not line.startswith("—"):
            continue
        parts = re.split(r"\s*—\s*", line[1:].strip())
        cursor = 0
        for part_number, part in enumerate(parts):
            part = plain(part.strip().strip("«»\"“” "))
            if not part:
                continue
            if part_number and _looks_like_author(part):
                notes.append(f"Абзац {paragraph}: пропущена возможная авторская ремарка: {part}")
                continue
            found = matches(words, norm, part, paragraph)
            available = [(i, span) for i, span in enumerate(found, 1) if span[0] >= cursor]
            cue = {"id": f"p{paragraph}-{part_number + 1}", "kind": "speech", "role": "",
                   "text": part, "paragraph": paragraph, "animation": "auto"}
            if available:
                ordinal, span = available[0]
                cursor = span[1]
                if len(found) > 1:
                    cue["occurrence"] = ordinal
            else:
                cue["note"] = "Не найдено в words.json; исправьте text или удалите эту строку"
                notes.append(f"Абзац {paragraph}: фрагмент не найден в словах: {part}")
            cues.append(cue)
    if not cues:
        notes.append("Абзацев, начинающихся с длинного тире, не найдено. Реплики можно добавить вручную.")
    return {"version": 1, "roles": {}, "cues": cues}, notes
