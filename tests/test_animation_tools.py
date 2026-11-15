import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from animation_tools import PlanError, apply_plan, load_animation_ids, resolve_plan
from animation_tools.draft import draft_from_story
from animation_tools.planner import normalize
from animation_tools.review import parse_roles, review_draft

ROOT = Path(__file__).resolve().parents[1]
MODES = {"idle", "wave", "thinking", "walk", "run", "point", "freeze", "sit_chair", "nod"}
WORDS = [
    {"word": "Привет", "start": 1.0, "end": 2.0, "paragraph": 1},
    {"word": "друг", "start": 2.0, "end": 3.0, "paragraph": 1},
    {"word": "Кто", "start": 4.0, "end": 4.5, "paragraph": 2},
    {"word": "ты", "start": 4.5, "end": 5.0, "paragraph": 2},
    {"word": "Привет", "start": 6.0, "end": 6.5, "paragraph": 3},
    {"word": "друг", "start": 6.5, "end": 7.0, "paragraph": 3},
]


def plan(cues=None, roles=None):
    return {"version": 1, "roles": roles or {"герой": {"pack": "hero"}}, "cues": cues or [
        {"id": "hello", "role": "герой", "text": "Привет, друг!", "paragraph": 1,
         "animation": "wave", "motion_duration": 2.0, "speed": 1.0}]}


def actor(pack="hero", clips=None, **other):
    return {"pack": pack, "clips": clips or [{"t": 0.0, "anim": "idle"}], **other}


class ResolutionTests(unittest.TestCase):
    def test_normalization_preserves_y_and_equates_accent_yo(self):
        self.assertEqual(normalize("синИ́Й!"), "синий")
        self.assertNotEqual(normalize("й"), normalize("и"))
        self.assertEqual(normalize("ЁЖ"), normalize("еж"))
        self.assertEqual(normalize("что-то"), "чтото")

    def test_ambiguity_and_explicit_occurrence(self):
        cue = {"role": "герой", "text": "Привет друг", "animation": "keep"}
        with self.assertRaisesRegex(PlanError, "совпадений"):
            resolve_plan(WORDS, plan([cue]), MODES)
        cue["occurrence"] = 2
        self.assertEqual(resolve_plan(WORDS, plan([cue]), MODES)["cues"][0]["start"], 6.0)
        cue["occurrence"] = 3
        with self.assertRaisesRegex(PlanError, "только 2"):
            resolve_plan(WORDS, plan([cue]), MODES)

    def test_cue_word_offset_and_retiming(self):
        p = plan([{"role": "герой", "text": "Привет друг", "paragraph": 1,
                   "animation": "wave", "at": "друг", "motion_duration": .4}])
        result = resolve_plan(WORDS, p, MODES, voice_offset=6)["cues"][0]
        self.assertEqual((result["start"], result["end"]), (7, 9))
        self.assertEqual((result["gesture_start"], result["gesture_end"]), (8, 8.4))
        moved = copy.deepcopy(WORDS)
        moved[1]["start"] = 2.4
        moved[1]["end"] = 3.4
        result = resolve_plan(moved, p, MODES, voice_offset=6)["cues"][0]
        self.assertEqual((result["gesture_start"], result["end"]), (8.4, 9.4))

    def test_at_must_be_inside_text_and_unique(self):
        cue = {"role": "герой", "text": "Привет друг", "paragraph": 1, "at": "Кто"}
        with self.assertRaisesRegex(PlanError, "не найдена"):
            resolve_plan(WORDS, plan([cue]), MODES)
        repeated = [{"word": "да", "start": 0, "end": .3, "paragraph": 1},
                    {"word": "да", "start": .3, "end": .6, "paragraph": 1}]
        cue.update(text="да да", at="да")
        with self.assertRaisesRegex(PlanError, "совпадений"):
            resolve_plan(repeated, plan([cue]), MODES)
        cue["at_occurrence"] = 2
        self.assertEqual(resolve_plan(repeated, plan([cue]), MODES)["cues"][0]["gesture_start"], .3)

    def test_suggestions_and_negation_are_conservative(self):
        base = {"role": "герой", "text": "Кто ты?", "paragraph": 2}
        self.assertEqual(resolve_plan(WORDS, plan([base]), MODES)["cues"][0]["animation"], "thinking")
        base["action"] = "не кивает"
        r = resolve_plan(WORDS, plan([base]), MODES)
        self.assertIsNone(r["cues"][0]["animation"])
        self.assertIn("отрицание", r["warnings"][0])
        base["action"] = "кивает и машет"
        r = resolve_plan(WORDS, plan([base]), MODES)
        self.assertIsNone(r["cues"][0]["animation"])
        self.assertIn("несколько", r["warnings"][0])
        base["animation"] = "bad_name"
        with self.assertRaisesRegex(PlanError, "Неизвестная анимация"):
            resolve_plan(WORDS, plan([base]), MODES)

    def test_adjacent_distinct_words_with_overlapping_times_warn_and_do_not_conflict(self):
        words = [{"word": "да", "start": 1, "end": 2.1, "paragraph": 1},
                 {"word": "нет", "start": 2, "end": 3, "paragraph": 1}]
        p = plan([{"role": "герой", "text": "да", "animation": "wave"},
                  {"role": "герой", "text": "нет", "animation": "point"}])
        report = resolve_plan(words, p, MODES)
        self.assertEqual(report["cues"][0]["gesture_end"], 2)
        self.assertTrue(any("пересекаются по времени" in w for w in report["warnings"]))
        new, _ = apply_plan([{"start": 0, "actors": [actor()]}], 5, words, p, MODES)
        self.assertEqual(new[0]["actors"][0]["talk"], [(1, 3)])
        self.assertEqual([(c["t"], c["anim"]) for c in new[0]["actors"][0]["clips"]],
                         [(0, "idle"), (1, "wave"), (2, "point"), (3, "idle")])

    def test_role_required_and_invalid_numbers_rejected(self):
        with self.assertRaisesRegex(PlanError, "говорящего"):
            resolve_plan(WORDS, plan([{"role": "", "text": "Привет друг"}]), MODES)
        for key, value in [("speed", 0), ("blend", 0), ("motion_duration", -1), ("speed", float("nan"))]:
            p = plan(); p["cues"][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(PlanError):
                resolve_plan(WORDS, p, MODES)
        invalid = copy.deepcopy(WORDS); invalid[1]["start"] = -1
        with self.assertRaises(PlanError):
            resolve_plan(invalid, plan(), MODES)

    def test_overlap_rejected_for_same_role(self):
        cues = [{"id": "one", "role": "герой", "text": "Привет", "paragraph": 1},
                {"id": "two", "role": "герой", "text": "Привет друг", "paragraph": 1}]
        with self.assertRaisesRegex(PlanError, "пересекаются"):
            resolve_plan(WORDS, plan(cues), MODES)
        cues[1]["kind"] = "action"  # An action may coincide with speech if only one gesture is generated.
        cues[1]["animation"] = "wave"
        self.assertEqual(len(resolve_plan(WORDS, plan(cues), MODES)["cues"]), 2)
        cues[0]["animation"] = "point"
        with self.assertRaisesRegex(PlanError, "Движения"):
            resolve_plan(WORDS, plan(cues), MODES)


class ApplyTests(unittest.TestCase):
    def test_split_across_shots_voice_offset_phase_and_restore(self):
        original = [
            {"id": "first", "start": 6, "actors": [actor(), actor("bystander")]},
            {"id": "second", "start": 8, "actors": [actor()]},
            {"id": "third", "start": 8.5, "actors": [actor(clips=[{"t": 0, "anim": "idle", "speed": .7, "offset": 2.0}])]},
        ]
        before = copy.deepcopy(original)
        result, report = apply_plan(original, 10, WORDS, plan(), MODES, voice_offset=6)
        self.assertEqual(original, before)  # Caller can safely keep its original scenes.
        a, b, c = [shot["actors"][0] for shot in result]
        self.assertEqual(a["talk"], [(1.0, 2.0)])
        self.assertEqual(b["talk"], [(0.0, .5)])
        self.assertEqual(c["talk"], [(0.0, .5)])
        self.assertEqual(a["clips"][1]["anim"], "wave")
        self.assertEqual(b["clips"][0]["offset"], 1.0)
        self.assertEqual(c["clips"][0]["offset"], 1.5)
        self.assertEqual(c["clips"][1]["anim"], "idle")
        self.assertAlmostEqual(c["clips"][1]["offset"], 2.35)
        self.assertEqual(result[0]["actors"][1], before[0]["actors"][1])
        self.assertAlmostEqual(report["cues"][0]["onscreen"], 2.0)
        self.assertFalse(report["warnings"])

    def test_reused_actor_dict_does_not_share_shot_local_tracks(self):
        shared = actor()
        shots = [{"start": 0, "actors": [shared]}, {"start": 2, "actors": [shared]}]
        new, _ = apply_plan(shots, 5, WORDS, plan(), MODES)
        self.assertIsNot(new[0]["actors"][0], new[1]["actors"][0])
        self.assertEqual(new[0]["actors"][0]["talk"], [(1, 2)])
        self.assertEqual(new[1]["actors"][0]["talk"], [(0, 1)])
        self.assertNotIn("talk", shared)

    def test_manual_change_priority_and_resume_phase(self):
        manual = [{"t": 0, "anim": "idle", "speed": .5, "offset": 3},
                  {"t": 2.0, "anim": "walk", "speed": 1.2}]
        shots = [{"start": 0, "actors": [actor(clips=manual)]}]
        new, report = apply_plan(shots, 8, WORDS, plan(), MODES)
        self.assertEqual([(x["t"], x["anim"]) for x in new[0]["actors"][0]["clips"]],
                         [(0, "idle"), (1, "wave"), (2, "walk")])
        self.assertTrue(any("прерывает" in s for s in report["warnings"]))
        shots[0]["actors"][0]["clips"] = manual[:1]
        new, _ = apply_plan(shots, 8, WORDS, plan(), MODES)
        restored = new[0]["actors"][0]["clips"][-1]
        self.assertEqual((restored["t"], restored["anim"]), (3, "idle"))
        self.assertEqual(restored["offset"], 4.5)

    def test_manual_key_at_same_time_wins_despite_float_roundoff(self):
        words = [{"word": "да", "start": .7, "end": 1.2, "paragraph": 1}]
        p = plan([{"role": "герой", "text": "да", "animation": "point"}])
        shots = [{"start": .4, "actors": [actor(clips=[{"t": 0, "anim": "idle"},
                                                       {"t": .3, "anim": "walk"}])]}]
        new, report = apply_plan(shots, 2, words, p, MODES)
        self.assertEqual([(c["t"], c["anim"]) for c in new[0]["actors"][0]["clips"]], [(0, "idle"), (.3, "walk")])
        self.assertTrue(any("прерывает" in msg for msg in report["warnings"]))

    def test_auto_does_not_replace_authored_sitting_but_explicit_can(self):
        shots = [{"start": 0, "actors": [actor(clips=[{"t": 0, "anim": "sit_chair"}])]}]
        p = plan([{"role": "герой", "text": "Кто ты?", "paragraph": 2}])
        new, report = apply_plan(shots, 8, WORDS, p, MODES)
        self.assertEqual(new[0]["actors"][0]["clips"], shots[0]["actors"][0]["clips"])
        self.assertTrue(any("пропущено" in s for s in report["warnings"]))
        p["cues"][0]["animation"] = "thinking"
        new, report = apply_plan(shots, 8, WORDS, p, MODES)
        self.assertIn("thinking", [c["anim"] for c in new[0]["actors"][0]["clips"]])
        self.assertTrue(any("временно заменяет" in s for s in report["warnings"]))

    def test_talk_merge_replace_and_action_only(self):
        shots = [{"start": 0, "actors": [actor(talk=[(-1, 1.2), (5, 6)])]}]
        p = plan([{"role": "герой", "text": "Привет друг", "paragraph": 1, "animation": "keep"}])
        new, _ = apply_plan(shots, 8, WORDS, p, MODES)
        self.assertEqual(new[0]["actors"][0]["talk"], [(-1, 3), (5, 6)])
        new, _ = apply_plan(shots, 8, WORDS, p, MODES, talk_policy="replace")
        self.assertEqual(new[0]["actors"][0]["talk"], [(1, 3)])
        p["cues"][0]["kind"] = "action"
        new, _ = apply_plan(shots, 8, WORDS, p, MODES, talk_policy="replace")
        self.assertEqual(new[0]["actors"][0]["talk"], [(-1, 1.2), (5, 6)])
        p["cues"][0]["kind"] = "speech"
        shots[0]["actors"][0]["talk"] = None  # valid falsey value in the original renderer
        new, _ = apply_plan(shots, 8, WORDS, p, MODES)
        self.assertEqual(new[0]["actors"][0]["talk"], [(1, 3)])

    def test_missing_actor_and_ambiguous_match(self):
        shots = [{"start": 0, "actors": []}]
        new, report = apply_plan(shots, 8, WORDS, plan(), MODES)
        self.assertEqual(shots, new)
        self.assertTrue(any("отсутствует" in msg for msg in report["warnings"]))
        shots = [{"start": 0, "actors": [actor(), actor()]}]
        before = copy.deepcopy(shots)
        with self.assertRaisesRegex(PlanError, "несколько актёров"):
            apply_plan(shots, 8, WORDS, plan(), MODES)
        self.assertEqual(shots, before)
        shots[0]["actors"][0]["animation_role"] = "one"
        shots[0]["actors"][1]["animation_role"] = "two"
        p = plan(roles={"герой": {"pack": "hero", "tag": "one"}})
        new, _ = apply_plan(shots, 8, WORDS, p, MODES)
        self.assertIn("talk", new[0]["actors"][0])
        self.assertNotIn("talk", new[0]["actors"][1])

    def test_two_roles_cannot_target_same_actor(self):
        p = plan([
            {"role": "герой", "text": "Привет друг", "paragraph": 1, "animation": "keep"},
            {"role": "двойник", "text": "Кто ты", "paragraph": 2, "animation": "keep"}],
            {"герой": {"pack": "hero"}, "двойник": {"pack": "hero"}})
        shots = [{"start": 0, "actors": [actor()]}]
        with self.assertRaisesRegex(PlanError, "одному актёру"):
            apply_plan(shots, 8, WORDS, p, MODES)

    def test_adjacent_gestures_do_not_create_duplicate_t(self):
        adjacent = [{"word": "да", "start": 1, "end": 2, "paragraph": 1},
                    {"word": "нет", "start": 2, "end": 3, "paragraph": 1}]
        p = plan([{"role": "герой", "text": "да", "animation": "wave"},
                  {"role": "герой", "text": "нет", "animation": "point"}])
        shots = [{"start": 0, "actors": [actor()]}]
        new, _ = apply_plan(shots, 5, adjacent, p, MODES)
        self.assertEqual([(x["t"], x["anim"]) for x in new[0]["actors"][0]["clips"]],
                         [(0, "idle"), (1, "wave"), (2, "point"), (3, "idle")])


class DraftAndCliTests(unittest.TestCase):
    def test_draft_does_not_assume_speakers_and_skips_narrator(self):
        story = "— Приве́т, друг! — тихо сказал он. — Кто ты?"
        words = [
            {"word": "Привет", "start": 0, "end": .4, "paragraph": 1},
            {"word": "друг", "start": .4, "end": .8, "paragraph": 1},
            {"word": "тихо", "start": .8, "end": 1, "paragraph": 1},
            {"word": "сказал", "start": 1, "end": 1.3, "paragraph": 1},
            {"word": "он", "start": 1.3, "end": 1.5, "paragraph": 1},
            {"word": "Кто", "start": 1.5, "end": 1.7, "paragraph": 1},
            {"word": "ты", "start": 1.7, "end": 2, "paragraph": 1},
        ]
        draft, notes = draft_from_story(story, words)
        self.assertEqual([c["text"] for c in draft["cues"]], ["Привет, друг!", "Кто ты?"])
        self.assertTrue(all(c["role"] == "" for c in draft["cues"]))
        self.assertEqual(draft["roles"], {})
        self.assertTrue(any("сказал" in n for n in notes))
        with self.assertRaises(PlanError):
            resolve_plan(words, draft, MODES)

    def test_review_assigns_roles_and_gesture_or_skips(self):
        draft = {"version": 1, "roles": {}, "cues": [
            {"id": "1", "role": "", "text": "Привет друг", "paragraph": 1},
            {"id": "2", "role": "", "text": "Кто ты?", "paragraph": 2},
            {"id": "3", "role": "", "text": "Привет друг", "paragraph": 3},
        ]}
        choices = iter(["1", "@кивает", "", "2", "keep", "", "s"])
        output = []
        roles = parse_roles(["герой=hero", "лесник=forester"])
        reviewed, report = review_draft(draft, WORDS, {"modes": {m: {} for m in MODES}}, roles,
                                        read=lambda prompt: next(choices), write=output.append)
        self.assertEqual([c["role"] for c in reviewed["cues"]], ["герой", "лесник"])
        self.assertEqual([c["animation"] for c in report["cues"]], ["nod", None])
        self.assertEqual(draft["cues"][0]["role"], "")
        self.assertTrue(any("Кто говорит" not in line and "Привет друг" in line for line in output))

    def test_review_cancel_does_not_complete(self):
        draft = {"version": 1, "roles": {}, "cues": [{"role": "", "text": "Привет друг", "paragraph": 1}]}
        def cancel(_prompt):
            raise EOFError()
        with self.assertRaisesRegex(PlanError, "прервана"):
            review_draft(draft, WORDS, {"modes": {m: {} for m in MODES}},
                         {"герой": {"pack": "hero"}}, read=cancel, write=lambda _: None)

    def test_cli_creates_draft_safely_and_checks_reviewed_plan(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            (base / "story.txt").write_text("— Привет, друг!", encoding="utf-8")
            (base / "words.json").write_text(json.dumps(WORDS, ensure_ascii=False), encoding="utf-8")
            (base / "anims.json").write_text(json.dumps({"modes": {m: {} for m in MODES}}), encoding="utf-8")
            draft = base / "plan.json"
            command = [sys.executable, "-m", "animation_tools", "draft", "--story", str(base / "story.txt"),
                       "--words", str(base / "words.json"), "--out", str(draft)]
            self.assertEqual(subprocess.run(command, cwd=ROOT, capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(command, cwd=ROOT, capture_output=True).returncode, 2)
            reviewed = base / "reviewed.json"
            review = subprocess.run([sys.executable, "-m", "animation_tools", "review", "--draft", str(draft),
                                     "--words", str(base / "words.json"), "--anims", str(base / "anims.json"),
                                     "--role", "герой=hero", "--out", str(reviewed)], cwd=ROOT,
                                    input="1\n\n", capture_output=True, text=True)
            self.assertEqual(review.returncode, 0, review.stderr)
            self.assertEqual(json.loads(reviewed.read_text(encoding="utf-8"))["cues"][0]["role"], "герой")
            check = subprocess.run([sys.executable, "-m", "animation_tools", "check", "--plan", str(reviewed),
                                    "--words", str(base / "words.json"), "--anims", str(base / "anims.json"),
                                    "--offset", "6"], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)
            self.assertIn("7.00", check.stdout)


class ActualArchiveTests(unittest.TestCase):
    def test_real_tri_dnya_dialogue_and_catalogue(self):
        archive1 = ROOT / "part1_инструкции_движок_персонажи.zip"
        archive4 = ROOT / "part4_озвучка.zip"
        if not archive1.exists() or not archive4.exists():
            self.skipTest("Example archives not present")
        with ZipFile(archive1) as z:
            modes = set(json.loads(z.read("engine/anims/anims.json"))["modes"])
            story = z.read("projects/03_tri_dnya/история.txt").decode("utf-8-sig")
        with ZipFile(archive4) as z:
            words = json.loads(z.read("projects/03_tri_dnya/audio/words.json"))
        p = json.loads((ROOT / "animation_tools/examples/tri_dnya_dialogue.json").read_text(encoding="utf-8"))
        report = resolve_plan(words, p, modes, 6)
        self.assertEqual(len(report["cues"]), 4)
        self.assertAlmostEqual(report["cues"][0]["start"], 143.9)
        self.assertEqual(report["cues"][1]["animation"], "point")
        draft, notes = draft_from_story(story, words)
        self.assertGreaterEqual(len(draft["cues"]), 15)
        self.assertFalse(any("фрагмент не найден" in n for n in notes))
        self.assertTrue(all(not cue["role"] for cue in draft["cues"]))
        cli = subprocess.run([sys.executable, "-m", "animation_tools", "check",
                              "--plan", str(ROOT / "animation_tools/examples/tri_dnya_dialogue.json"),
                              "--words", f"{archive4}::projects/03_tri_dnya/audio/words.json",
                              "--anims", f"{archive1}::engine/anims/anims.json", "--offset", "6"],
                             cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertIn("143.90", cli.stdout)


if __name__ == "__main__":
    unittest.main()
