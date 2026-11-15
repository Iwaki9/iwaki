"""Plan dialogue/gestures from word timings without changing the renderer.

Inputs and outputs are deliberately plain Python data: the resulting ``clips`` and
``talk`` lists have the format consumed by the archived engine's compose.Renderer.
"""
from __future__ import annotations

import copy
import json
import math
import re
import unicodedata
from pathlib import Path
from zipfile import BadZipFile, ZipFile


class PlanError(ValueError):
    """The plan cannot be applied safely; the message describes what to fix."""


def load_text(path):
    """Read UTF-8 text from a file, or from ``archive.zip::path/inside``."""
    source = str(path)
    try:
        if "::" in source:
            archive, member = source.split("::", 1)
            if not archive or not member:
                raise PlanError(f"Неверный путь в архиве: {source}")
            with ZipFile(archive) as file:
                return file.read(member).decode("utf-8-sig")
        return Path(source).read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError, BadZipFile, KeyError) as exc:
        raise PlanError(f"Не удалось прочитать {source}: {exc}") from exc


def load_json(path):
    try:
        return json.loads(load_text(path))
    except json.JSONDecodeError as exc:
        raise PlanError(f"Неверный JSON в {path}: {exc}") from exc


def load_animation_ids(path):
    """Read the actual studio bake, rather than assuming which animations exist."""
    meta = load_json(path)
    if not isinstance(meta, dict) or not isinstance(meta.get("modes"), dict) or not meta["modes"]:
        raise PlanError(f"В {path} нет словаря animations/modes")
    return set(meta["modes"])


def plain(text):
    # Remove stress marks but keep й (U+0306 after NFD). This is how align.py
    # prepares the story and avoids turning "й" into "и".
    return unicodedata.normalize("NFC", "".join(
        char for char in unicodedata.normalize("NFD", text) if char != "\u0301"
    ))


def normalize(word):
    return "".join(char for char in plain(word).lower().replace("ё", "е") if char.isalnum())


def tokens(text):
    return [normalized for word in text.split() if (normalized := normalize(word))]


def _number(value, label, *, minimum=None, strict=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise PlanError(f"{label}: требуется конечное число")
    if minimum is not None and (value <= minimum if strict else value < minimum):
        op = ">" if strict else "≥"
        raise PlanError(f"{label}: требуется число {op} {minimum}")
    return float(value)


def _positive_int(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise PlanError(f"{label}: требуется целое число от 1")
    return value


def prepare_words(words):
    """Validate the ``words.json`` list (or the engine's Words object)."""
    if hasattr(words, "words"):
        words = words.words
    if not isinstance(words, list) or not words:
        raise PlanError("words.json должен содержать непустой список слов")
    norm = []
    previous = -1.0
    for index, word in enumerate(words):
        label = f"words.json, слово {index + 1}"
        if not isinstance(word, dict) or not isinstance(word.get("word"), str) or not normalize(word["word"]):
            raise PlanError(f"{label}: отсутствует непустое поле word")
        start = _number(word.get("start"), f"{label}, start", minimum=0)
        end = _number(word.get("end"), f"{label}, end", minimum=0)
        if end < start or start < previous:
            raise PlanError(f"{label}: неправильный порядок start/end или слов")
        previous = start
        norm.append(normalize(word["word"]))
    return words, norm


def matches(words, norm, text, paragraph=None, *, within=None):
    target = tokens(text)
    if not target:
        raise PlanError("Пустая фраза не может быть привязана к озвучке")
    first, last = within if within is not None else (0, len(words))
    found = []
    for pos in range(first, last - len(target) + 1):
        if norm[pos:pos + len(target)] != target:
            continue
        if paragraph is not None and any(w.get("paragraph") != paragraph for w in words[pos:pos + len(target)]):
            continue
        found.append((pos, pos + len(target)))  # exclusive end
    return found


def _select(found, occurrence, label):
    if not found:
        raise PlanError(f"{label}: фраза не найдена в words.json")
    if occurrence is None:
        if len(found) > 1:
            raise PlanError(f"{label}: найдено совпадений: {len(found)}; укажите paragraph и/или occurrence")
        return found[0]
    occurrence = _positive_int(occurrence, f"{label}, occurrence")
    if occurrence > len(found):
        raise PlanError(f"{label}: occurrence={occurrence}, но совпадений только {len(found)}")
    return found[occurrence - 1]


# These rules only read an explicitly supplied stage direction. They deliberately
# avoid treating the content of a spoken sentence as a description of an action.
_ACTION_RULES = (
    ("look_around", r"\b(?:огляд\w*|осматр\w*|осмотр\w*|прислуш\w*)"),
    ("freeze", r"\b(?:замер\w*|замира\w*|засты\w*|оцепен\w*)"),
    ("shiver", r"\b(?:дрож\w*|дрожит\w*|трепещ\w*|озноб\w*)"),
    ("wave", r"\b(?:маш\w*|помах\w*|маха\w*)"),
    ("nod", r"\b(?:кив\w*|кива\w*)"),
    ("shake_head", r"\b(?:мотает\s+головой|качает\s+головой)"),
    ("shrug", r"\b(?:пожим\w*|пожал\w*)\s+плеч\w*"),
    ("point", r"\b(?:указ\w*|показыва\w*|показа\w*)"),
    ("thinking", r"\b(?:задум\w*|размышл\w*|дума\w*)"),
    ("sigh", r"\b(?:вздох\w*|вздыха\w*)"),
    ("cry", r"\b(?:плач\w*|рыда\w*|заплак\w*)"),
    ("laugh", r"\b(?:сме[её]\w*|сме[яю]\w*|засме\w*|смеется\w*|хохоч\w*)"),
    ("recoil", r"\b(?:отшат\w*|отпрян\w*)"),
    ("crouch", r"\b(?:присел\w*|присе\w*|приседа\w*|на\s+корточк\w*)"),
    ("hide", r"\b(?:пряч\w*|спрята\w*|укрыва\w*)"),
    ("walk", r"\b(?:ид[её]т\w*|пош[её]л\w*|идти|шага\w*|ходит\w*)"),
    ("run", r"\b(?:беж\w*|побеж\w*|убег\w*)"),
    ("sneak", r"\b(?:крад[её]тся\w*|крал\w*|подкрад\w*)"),
    ("sit_chair", r"\b(?:сел\w*|сидит\w*)\s+на\s+стул\w*"),
    ("sit_floor", r"\b(?:сел\w*|сидит\w*)\s+на\s+пол\w*"),
    ("lie_down", r"\b(?:л[её]г\w*|лежит\w*)"),
    ("reach_hand", r"\b(?:тянет\s+руку|протян\w*\s+руку)"),
)


def choose_animation(cue, modes):
    """Return (mode or None, explanation, optional warning)."""
    setting = cue.get("animation", "auto")
    if not isinstance(setting, str):
        raise PlanError("animation должно быть строкой: auto, keep или ID анимации")
    if setting == "keep":
        return None, "сохранить существующую позу", None
    if setting != "auto":
        if setting not in modes:
            raise PlanError(f"Неизвестная анимация «{setting}»: проверьте engine/anims/anims.json")
        return setting, "выбрана вручную", None
    action = cue.get("action", "")
    if not isinstance(action, str):
        raise PlanError("action должно быть текстом описания действия")
    if action.strip():
        text = plain(action.lower()).replace("ё", "е")
        if re.search(r"\bне\s+\w+", text):
            return None, "действие с отрицанием не распознано", "Проверьте отрицание и при необходимости выберите animation вручную"
        if action.strip() in modes:
            return action.strip(), "ID из описания действия", None
        hits = [mode for mode, pattern in _ACTION_RULES if re.search(pattern, text)]
        if len(hits) > 1:
            return None, "неоднозначное описание", f"В описании несколько движений ({', '.join(hits)}); выберите animation вручную"
        if not hits:
            return None, "описание не распознано", "Движение не добавлено; выберите animation вручную"
        mode = hits[0]
        if mode not in modes:
            return None, "в этой версии движка нет подходящего движения", f"Анимация «{mode}» отсутствует в engine/anims/anims.json"
        return mode, f"по описанию: {action.strip()}", None
    if cue.get("kind", "speech") == "speech" and "?" in cue["text"] and "thinking" in modes:
        return "thinking", "предположение по вопросу — проверьте", None
    return None, "нет явного жеста: сохранена текущая поза", None


def _validate_roles(plan):
    roles = plan.get("roles")
    if not isinstance(roles, dict) or not roles:
        raise PlanError("В roles задайте хотя бы одну роль и её pack или tag")
    for name, selector in roles.items():
        if not isinstance(name, str) or not name.strip() or not isinstance(selector, dict):
            raise PlanError("Каждая роль должна быть непустым именем и объектом с pack и/или tag")
        if set(selector) - {"pack", "tag"}:
            raise PlanError(f"Роль «{name}»: допустимы только pack и tag")
        if not selector or any(not isinstance(v, str) or not v.strip() for v in selector.values()):
            raise PlanError(f"Роль «{name}»: укажите непустой pack и/или tag")
    return roles


def resolve_plan(words, plan, modes, voice_offset=0.0):
    """Resolve cues against current words, validate ambiguity, and suggest motions.

    No shots or files are changed. The resulting absolute times include voice_offset.
    """
    words, norm = prepare_words(words)
    voice_offset = _number(voice_offset, "voice_offset", minimum=0)
    if not isinstance(plan, dict) or type(plan.get("version")) is not int or plan["version"] != 1:
        raise PlanError("План должен быть объектом с version: 1")
    roles = _validate_roles(plan)
    if not isinstance(modes, (set, frozenset, dict)) or not modes:
        raise PlanError("Не передан список анимаций из engine/anims/anims.json")
    cues = plan.get("cues")
    if not isinstance(cues, list) or not cues:
        raise PlanError("В плане нет реплик/actions (cues)")
    result, warnings, ids = [], [], set()
    for number, cue in enumerate(cues, 1):
        label = f"cues[{number}]"
        if not isinstance(cue, dict):
            raise PlanError(f"{label}: требуется объект")
        cue_id = cue.get("id", f"cue-{number}")
        if not isinstance(cue_id, str) or not cue_id.strip() or cue_id in ids:
            raise PlanError(f"{label}: id должен быть непустым и уникальным")
        ids.add(cue_id)
        label = f"Реплика «{cue_id}»"
        role = cue.get("role")
        if not isinstance(role, str) or role not in roles:
            raise PlanError(f"{label}: выберите role из roles (говорящего нельзя определить автоматически)")
        kind = cue.get("kind", "speech")
        if kind not in ("speech", "action"):
            raise PlanError(f"{label}: kind должен быть speech или action")
        text = cue.get("text")
        if not isinstance(text, str) or not text.strip():
            raise PlanError(f"{label}: укажите text из words.json")
        paragraph = cue.get("paragraph")
        if paragraph is not None:
            _positive_int(paragraph, f"{label}, paragraph")
        first, end = _select(matches(words, norm, text, paragraph), cue.get("occurrence"), label)
        start_time = float(words[first]["start"]) + voice_offset
        end_time = float(words[end - 1]["end"]) + voice_offset
        if end_time <= start_time:
            raise PlanError(f"{label}: нулевая/отрицательная длительность в words.json")
        mode, reason, warning = choose_animation(cue, modes)
        if warning:
            warnings.append(f"{label}: {warning}")
        if any(float(w["end"]) - float(w["start"]) < 0.02 for w in words[first:end]):
            warnings.append(f"{label}: есть слова короче 0.02 с; проверьте выравнивание озвучки")
        at = cue.get("at")
        if at is not None:
            if not isinstance(at, str) or not at.strip():
                raise PlanError(f"{label}: at должно быть непустой фразой внутри text")
            at_first, _ = _select(matches(words, norm, at, within=(first, end)), cue.get("at_occurrence"), f"{label}, at")
        else:
            if "at_occurrence" in cue:
                raise PlanError(f"{label}: at_occurrence указан без at")
            at_first = first
        gesture_start = float(words[at_first]["start"]) + voice_offset
        duration = _number(cue.get("motion_duration", 2.4), f"{label}, motion_duration", minimum=0, strict=True)
        speed = _number(cue.get("speed", 0.8), f"{label}, speed", minimum=0, strict=True)
        blend = _number(cue.get("blend", 0.28), f"{label}, blend", minimum=0, strict=True)
        gesture_end = min(end_time, gesture_start + duration)
        if mode and mode in {"walk", "run", "sneak", "back_away"}:
            warnings.append(f"{label}: {mode} анимирует ноги на месте; перемещение задаётся отдельно через path")
        result.append({"id": cue_id, "role": role, "kind": kind, "text": text,
                       "start": start_time, "end": end_time, "animation": mode, "reason": reason,
                       "word_start": first, "word_end": end,  # half-open range in words.json
                       "explicit": cue.get("animation", "auto") not in ("auto", "keep"),
                       "gesture_start": gesture_start, "gesture_end": gesture_end,
                       "speed": speed, "blend": blend})
    result.sort(key=lambda item: (item["start"], item["word_start"], item["end"], item["id"]))
    # Selecting the same word twice is an error. Adjacent words can have slightly
    # overlapping audio timings, however: preserve their talk windows and warn.
    # Gesture conflicts on the single animation track are handled separately.
    for role in roles:
        role_cues = [item for item in result if item["role"] == role]
        spoken = [item for item in role_cues if item["kind"] == "speech"]
        for i, previous in enumerate(spoken):
            for current in spoken[i + 1:]:
                if current["start"] >= previous["end"]:
                    break
                if previous["word_start"] < current["word_end"] and current["word_start"] < previous["word_end"]:
                    raise PlanError(f"Реплики «{previous['id']}» и «{current['id']}» роли «{role}» пересекаются по словам")
                warnings.append(f"Реплики «{previous['id']}» и «{current['id']}» роли «{role}» пересекаются по времени: проверьте words.json")
        gestures = sorted((item for item in role_cues if item["animation"]),
                          key=lambda item: (item["gesture_start"], item["word_start"]))
        for previous, current in zip(gestures, gestures[1:]):
            if current["gesture_start"] < previous["gesture_end"]:
                if (previous["kind"] == current["kind"] == "speech"
                        and previous["word_end"] <= current["word_start"]):
                    previous["gesture_end"] = current["gesture_start"]
                    warnings.append(f"Движение «{previous['id']}» сокращено до начала «{current['id']}» из-за пересечения таймингов")
                else:
                    raise PlanError(f"Движения «{previous['id']}» и «{current['id']}» роли «{role}» пересекаются; выберите keep или разделите их")
    spoken = [item for item in result if item["kind"] == "speech"]
    for i, a in enumerate(spoken):
        for b in spoken[i + 1:]:
            if b["start"] >= a["end"]:
                break
            if a["role"] != b["role"]:
                warnings.append(f"Реплики «{a['id']}» и «{b['id']}» разных ролей пересекаются: проверьте, кто говорит")
    return {"cues": result, "warnings": warnings}


def _validate_shots(shots, duration):
    duration = _number(duration, "duration", minimum=0, strict=True)
    if not isinstance(shots, list) or not shots:
        raise PlanError("shots должен быть непустым списком планов")
    previous = -1.0
    for index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            raise PlanError(f"shots[{index}]: требуется объект")
        start = _number(shot.get("start"), f"shots[{index}].start", minimum=0)
        if start <= previous or start >= duration:
            raise PlanError(f"shots[{index}]: начала планов должны строго возрастать и быть меньше duration")
        if not isinstance(shot.get("actors", []), (list, tuple)):
            raise PlanError(f"shots[{index}].actors: требуется список")
        previous = start
    return duration


def _actor_matches(actor, selector):
    return (isinstance(actor, dict)
            and ("pack" not in selector or actor.get("pack") == selector["pack"])
            and ("tag" not in selector or actor.get("animation_role") == selector["tag"]))


def _valid_clips(actor, label, modes):
    clips = actor.get("clips")
    if not isinstance(clips, (list, tuple)) or not clips:
        raise PlanError(f"{label}: для добавления жестов нужен существующий непустой список clips")
    previous = -1.0
    for i, clip in enumerate(clips):
        if not isinstance(clip, dict) or not isinstance(clip.get("anim"), str) or clip["anim"] not in modes:
            raise PlanError(f"{label}, clips[{i}]: неизвестная анимация")
        # Shot-local times originate from subtraction of absolute timestamps.
        # Round at nanosecond precision to avoid phantom duplicate keys due to
        # floating-point noise (far below the engine's 30-fps frame interval).
        t = round(_number(clip.get("t"), f"{label}, clips[{i}].t", minimum=0), 9)
        if t <= previous or (i == 0 and t != 0):
            raise PlanError(f"{label}: clips должны начинаться в 0 и строго возрастать по t")
        for field in ("speed", "offset", "hold", "blend"):
            if field in clip and not (field == "hold" and clip[field] is None):
                _number(clip[field], f"{label}, clips[{i}].{field}",
                        minimum=0 if field in ("speed", "hold", "blend") else None,
                        strict=field == "blend")
        previous = t
    return list(clips)


def _merge_talk(existing, new, label):
    if not isinstance(existing, (list, tuple)):
        raise PlanError(f"{label}: talk должен быть списком интервалов")
    ranges = []
    for span in list(existing) + new:
        if not isinstance(span, (tuple, list)) or len(span) != 2:
            raise PlanError(f"{label}: talk должен содержать пары (начало, конец)")
        # Existing authored windows may start before this shot (e.g. say(start, a, b)).
        start = _number(span[0], f"{label}, talk start")
        end = _number(span[1], f"{label}, talk end")
        if end <= start:
            raise PlanError(f"{label}: конец talk должен быть позже начала")
        ranges.append((start, end))
    result = []
    for start, end in sorted(ranges):
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(end, result[-1][1]))
        else:
            result.append((start, end))
    return result


def _overlay_clips(manual, gestures, shot_start, shot_end, label, warnings):
    """Temporarily overlay gestures; later manually authored clips have priority."""
    # Keep manual clips unchanged; auto-start wins over the baseline at t=0 only.
    entries = {round(float(clip["t"]), 9): (3, copy.deepcopy(clip)) for clip in manual}
    shot_length = round(shot_end - shot_start, 9)
    for event in sorted(gestures, key=lambda cue: (cue["gesture_start"], cue["word_start"])):
        start = round(max(shot_start, event["gesture_start"]) - shot_start, 9)
        end = round(min(shot_end, event["gesture_end"]) - shot_start, 9)
        if end <= start:
            continue
        original_end = end
        manual_times = [round(float(clip["t"]), 9) for clip in manual]
        blockers = [t for t in manual_times if t > 0 and start <= t < end]
        if blockers:
            end = min(blockers)
            warnings.append(f"{label}: ручной clip в {end:.2f} с прерывает движение «{event['id']}»")
        if end <= start:
            continue
        baseline = max((clip for clip in manual if round(float(clip["t"]), 9) <= start),
                       key=lambda clip: float(clip["t"]))
        if baseline["anim"] != "idle":
            if not event["explicit"]:
                warnings.append(f"{label}: предложение «{event['id']}» пропущено, чтобы сохранить {baseline['anim']}; задайте animation явно, если хотите заменить позу")
                continue
            warnings.append(f"{label}: движение «{event['id']}» временно заменяет {baseline['anim']}; проверьте позу")
        auto = {"t": start, "anim": event["animation"], "speed": event["speed"], "blend": event["blend"]}
        phase = max(0.0, shot_start - event["gesture_start"]) * event["speed"]
        if phase:
            auto["offset"] = phase
        # At t=0, replace the baseline; otherwise a manual key always wins.
        # A following gesture can replace the preceding gesture's restore.
        if start == 0.0 or start not in entries or entries[start][0] == 1:
            entries[start] = (4 if start == 0.0 else 2, auto)
        # Do not reinsert the original pose at a cut or over a manual clip.
        if end < shot_length and end == original_end:
            base = max((clip for clip in manual if round(float(clip["t"]), 9) <= end),
                       key=lambda clip: float(clip["t"]))
            restored = copy.deepcopy(base)
            restored["t"] = end
            restored["offset"] = float(base.get("offset", 0.0)) + (end - float(base["t"])) * float(base.get("speed", 1.0))
            if end not in entries:
                entries[end] = (1, restored)
    return [entry[1] for _, entry in sorted(entries.items())]


def apply_plan(shots, duration, words, plan, modes, voice_offset=0.0, *, talk_policy="merge"):
    """Return ``(new_shots, report)``; the input is never mutated, even on failure.

    ``talk_policy='merge'`` preserves existing talk. ``'replace'`` clears existing
    talk only for actors in shots touched by a speech cue. Manually authored clip
    changes have priority over generated gestures; animation and face assets are untouched.
    """
    duration = _validate_shots(shots, duration)
    if talk_policy not in ("merge", "replace"):
        raise PlanError("talk_policy должен быть merge или replace")
    report = resolve_plan(words, plan, modes, voice_offset)
    # A scene may intentionally reuse the same actor dictionary in several shots.
    # Copy each shot separately so its shot-local talk/clips never leak into another.
    new_shots = [copy.deepcopy(shot) for shot in shots]
    coverage = {cue["id"]: 0.0 for cue in report["cues"]}
    roles = plan["roles"]
    for index, shot in enumerate(new_shots):
        shot_start = float(shot["start"])
        shot_end = float(new_shots[index + 1]["start"]) if index + 1 < len(new_shots) else duration
        label = f"План «{shot.get('id', index)}»"
        active = [cue for cue in report["cues"] if cue["start"] < shot_end and cue["end"] > shot_start]
        assigned = {}
        for role, selector in roles.items():
            events = [cue for cue in active if cue["role"] == role]
            if not events:
                continue
            actors = [actor for actor in shot.get("actors", []) if _actor_matches(actor, selector)]
            if len(actors) > 1:
                raise PlanError(f"{label}: роли «{role}» соответствуют несколько актёров; добавьте animation_role и tag")
            if not actors:
                continue
            actor = actors[0]
            actor_key = id(actor)
            if actor_key in assigned:
                raise PlanError(f"{label}: одному актёру соответствуют роли «{assigned[actor_key]}» и «{role}»; уточните pack/tag")
            assigned[actor_key] = role
            for event in events:
                coverage[event["id"]] += min(shot_end, event["end"]) - max(shot_start, event["start"])
            speech = [(max(shot_start, event["start"]) - shot_start, min(shot_end, event["end"]) - shot_start)
                      for event in events if event["kind"] == "speech"]
            if speech:
                existing = actor.get("talk") if talk_policy == "merge" else ()
                if existing is None:
                    existing = ()
                actor["talk"] = _merge_talk(existing, speech, f"{label}, роль «{role}»")
            gestures = [event for event in events if event["animation"]
                        and event["gesture_start"] < shot_end and event["gesture_end"] > shot_start]
            if gestures:
                actor_label = f"{label}, роль «{role}»"
                manual = _valid_clips(actor, actor_label, modes)
                actor["clips"] = _overlay_clips(manual, gestures, shot_start, shot_end, actor_label, report["warnings"])
    for event in report["cues"]:
        covered = coverage[event["id"]]
        event["onscreen"] = covered
        missing = event["end"] - event["start"] - covered
        if missing > 1e-6:
            report["warnings"].append(f"«{event['id']}»: роль «{event['role']}» отсутствует в кадре {missing:.2f} с из {event['end'] - event['start']:.2f} с")
    return new_shots, report
