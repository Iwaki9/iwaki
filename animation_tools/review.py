"""Small offline terminal wizard for confirming draft speakers and motions."""
from __future__ import annotations

import copy

from .planner import PlanError, resolve_plan


def _ask(prompt, read):
    try:
        return read(prompt).strip()
    except (EOFError, KeyboardInterrupt) as exc:
        raise PlanError("Проверка прервана; выходной файл не записан") from exc


def parse_roles(values, existing=None):
    roles = copy.deepcopy(existing or {})
    if not isinstance(roles, dict):
        raise PlanError("roles должен быть объектом")
    for value in values:
        if "=" not in value:
            raise PlanError(f"Неверный --role «{value}»: используйте имя=имя_пака")
        name, pack = (part.strip() for part in value.split("=", 1))
        if not name or not pack or name in roles:
            raise PlanError(f"Неверная или повторная роль «{name}»")
        roles[name] = {"pack": pack}
    if not roles:
        raise PlanError("Укажите хотя бы одну роль: --role имя=имя_пака")
    return roles


def review_draft(draft, words, metadata, roles, voice_offset=0, *, read=input, write=print):
    """Review each proposed line interactively, returning a validated plan.

    Nothing is written until every selected cue passes the same validation used
    during rendering. ``read`` and ``write`` are injectable for tests.
    """
    if not isinstance(draft, dict) or draft.get("version") != 1 or not isinstance(draft.get("cues"), list):
        raise PlanError("Неверный черновик: ожидаются version: 1 и список cues")
    if not isinstance(metadata, dict) or not isinstance(metadata.get("modes"), dict) or not metadata["modes"]:
        raise PlanError("В метаданных анимаций нет modes")
    if not isinstance(roles, dict) or not roles:
        raise PlanError("Для проверки нужны роли")
    modes = metadata["modes"]
    result = {"version": 1, "roles": copy.deepcopy(roles), "cues": []}
    role_names = list(roles)
    if len(draft["cues"]) == 0:
        raise PlanError("В черновике нет реплик; добавьте их вручную")
    for number, source in enumerate(draft["cues"], 1):
        if not isinstance(source, dict):
            raise PlanError(f"cues[{number}]: требуется объект")
        candidate = copy.deepcopy(source)
        candidate["role"] = role_names[0]  # temporary, only to resolve the phrase
        while True:
            try:
                preview = resolve_plan(words, {**result, "cues": [candidate]}, modes, voice_offset)
                break
            except PlanError as exc:
                write(f"\nФрагмент {number}: {exc}")
                replacement = _ask("Введите исправленную фразу из words.json или Enter, чтобы пропустить: ", read)
                if not replacement:
                    candidate = None
                    break
                candidate["text"] = replacement
                candidate.pop("occurrence", None)
        if candidate is None:
            continue
        item = preview["cues"][0]
        write(f"\n[{number}/{len(draft['cues'])}] {item['start']:.2f}–{item['end']:.2f} с, "
              f"абзац {candidate.get('paragraph', '?')}: {candidate['text']}")
        while True:
            choices = ", ".join(f"{i + 1}={name}" for i, name in enumerate(role_names))
            selection = _ask(f"Кто говорит? {choices}; s=пропустить: ", read)
            if selection.lower() in ("s", "skip"):
                candidate = None
                break
            if selection.isdigit() and 1 <= int(selection) <= len(role_names):
                candidate["role"] = role_names[int(selection) - 1]
                break
            if selection in roles:
                candidate["role"] = selection
                break
            write("Введите номер/имя роли или s.")
        if candidate is None:
            continue
        while True:
            preview = resolve_plan(words, {**result, "cues": [candidate]}, modes, voice_offset)
            item = preview["cues"][0]
            write(f"Движение: {item['animation'] or 'сохранить'} ({item['reason']}).")
            for warning in preview["warnings"]:
                write(f"  Внимание: {warning}")
            choice = _ask("Enter=принять; keep=сохранить позу; ID=выбрать; @описание; ?=список: ", read)
            if not choice:
                break
            if choice == "?":
                for mode in sorted(modes):
                    info = modes[mode]
                    name = info.get("name", mode) if isinstance(info, dict) else mode
                    write(f"  {mode}: {name}")
            elif choice == "keep":
                candidate["animation"] = "keep"
                candidate.pop("action", None)
            elif choice == "auto":
                candidate["animation"] = "auto"
                candidate.pop("action", None)
            elif choice.startswith("@") and choice[1:].strip():
                candidate["animation"] = "auto"
                candidate["action"] = choice[1:].strip()
            elif choice in modes:
                candidate["animation"] = choice
                candidate.pop("action", None)
            else:
                write("Неизвестное действие. Введите ID, @описание, auto, keep или ?.")
        candidate.pop("note", None)
        try:
            resolve_plan(words, {**result, "cues": result["cues"] + [candidate]}, modes, voice_offset)
        except PlanError as exc:
            # Do not silently create an invalid plan. Keep already reviewed cues;
            # the conflicting candidate is listed and deliberately not applied.
            write(f"Фрагмент пропущен из-за конфликта: {exc}")
            continue
        result["cues"].append(candidate)
    if not result["cues"]:
        raise PlanError("Не выбрано ни одной реплики; выходной файл не записан")
    report = resolve_plan(words, result, modes, voice_offset)
    return result, report
