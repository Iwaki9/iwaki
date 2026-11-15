"""CLI for preparing and checking animation cues; no engine dependencies required."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .draft import draft_from_story
from .planner import PlanError, load_animation_ids, load_json, load_text, resolve_plan
from .review import parse_roles, review_draft


def _write_new(path, data, force):
    path = Path(path)
    try:
        # Refuse to overwrite a reviewed plan unless explicitly requested.
        with path.open("w" if force else "x", encoding="utf-8", newline="\n") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")
    except OSError as exc:
        raise PlanError(f"Не удалось записать {path}: {exc}") from exc


def main(argv=None):
    parser = argparse.ArgumentParser(description="Помощник анимации по словам озвучки (офлайн)")
    sub = parser.add_subparsers(dest="command", required=True)
    draft = sub.add_parser("draft", help="Найти возможные реплики в истории; роли не угадываются")
    draft.add_argument("--story", required=True, help="Текст истории: один абзац на строку")
    draft.add_argument("--words", required=True, help="audio/words.json")
    draft.add_argument("--out", required=True, help="Путь к новому JSON-плану")
    draft.add_argument("--force", action="store_true", help="Перезаписать существующий файл")
    review = sub.add_parser("review", help="Подтвердить говорящих и движения в терминале")
    review.add_argument("--draft", required=True, help="JSON-черновик из draft")
    review.add_argument("--words", required=True)
    review.add_argument("--anims", default="engine/anims/anims.json")
    review.add_argument("--role", action="append", default=[], metavar="ИМЯ=ПАК", help="Повторите для каждого персонажа")
    review.add_argument("--offset", type=float, default=0.0)
    review.add_argument("--out", required=True, help="Новый проверенный план")
    review.add_argument("--force", action="store_true", help="Перезаписать существующий файл")
    check = sub.add_parser("check", help="Проверить и показать предложенные движения и их тайминг")
    check.add_argument("--plan", required=True)
    check.add_argument("--words", required=True)
    check.add_argument("--anims", default="engine/anims/anims.json", help="Метаданные анимаций движка")
    check.add_argument("--offset", type=float, default=0.0, help="Задержка озвучки от начала фильма, секунды")
    args = parser.parse_args(argv)
    try:
        words = load_json(args.words)
        if args.command == "draft":
            story = load_text(args.story)
            result, notes = draft_from_story(story, words)
            _write_new(args.out, result, args.force)
            print(f"Создан черновик: {args.out}; возможных фрагментов: {len(result['cues'])}.")
            print("Обязательно проверьте текст и назначьте роли: без этого план не будет применён.")
            for note in notes:
                print(f"  Внимание: {note}")
        elif args.command == "review":
            if Path(args.out).exists() and not args.force:
                raise PlanError(f"{args.out} уже существует; выберите другой путь или --force")
            draft_plan = load_json(args.draft)
            roles = parse_roles(args.role, draft_plan.get("roles") if isinstance(draft_plan, dict) else None)
            reviewed, report = review_draft(draft_plan, words, load_json(args.anims), roles, args.offset)
            _write_new(args.out, reviewed, args.force)
            print(f"\nСохранено: {args.out}; подтверждённых фрагментов: {len(reviewed['cues'])}.")
            for warning in report["warnings"]:
                print(f"Внимание: {warning}")
            print("Проверьте видимость актёров и результат при применении к сценам.")
        else:
            report = resolve_plan(words, load_json(args.plan), load_animation_ids(args.anims), args.offset)
            for item in report["cues"]:
                motion = item["animation"] or "сохранить текущую"
                print(f"{item['start']:8.2f}–{item['end']:8.2f}  {item['role']}  [{motion}]  {item['text']}")
                timing = (f"жест: {item['gesture_start']:.2f}–{item['gesture_end']:.2f} с"
                          if item["animation"] else "новый жест не добавляется")
                print(f"    {item['reason']}; {timing}")
            for warning in report["warnings"]:
                print(f"Внимание: {warning}")
            print(f"Проверено фрагментов: {len(report['cues'])}. Видимость актёров проверяется при применении к shots.")
        return 0
    except PlanError as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
