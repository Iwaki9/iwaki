"""Optional integration test using the actual, unmodified engine and character pack.

Runs if the project archives and engine dependencies (numpy, cv2, Pillow) exist.
The normal unit tests and the tool itself only require Python's standard library.
"""
import importlib
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from animation_tools import apply_plan

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE1 = ROOT / "part1_инструкции_движок_персонажи.zip"
ARCHIVE2 = ROOT / "part2_фоны_1.zip"
ARCHIVE4 = ROOT / "part4_озвучка.zip"
try:
    import numpy as np
    import cv2  # noqa: F401
    from PIL import Image  # noqa: F401
    HAS_ENGINE_DEPS = True
except ImportError:
    HAS_ENGINE_DEPS = False
try:
    from scipy.io import wavfile
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


@unittest.skipUnless(HAS_ENGINE_DEPS and ARCHIVE1.exists() and ARCHIVE2.exists() and ARCHIVE4.exists(),
                     "Requires project archives and numpy, opencv and Pillow")
class RealEngineTests(unittest.TestCase):
    def test_real_puppet_pose_mouth_and_cpu_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with ZipFile(ARCHIVE1) as z:
                for item in z.infolist():
                    if item.filename in ("engine/compose.py", "engine/puppet.py", "engine/render.py") or item.filename.startswith(
                            ("engine/anims/", "anim/lesnik_tulup_v1/")):
                        z.extract(item, root)
            with ZipFile(ARCHIVE2) as z:
                z.extract("bg/T00.jpg", root)
            with ZipFile(ARCHIVE4) as z:
                words = json.loads(z.read("projects/03_tri_dnya/audio/words.json"))
            meta = json.loads((root / "engine/anims/anims.json").read_text(encoding="utf-8"))
            plan = json.loads((ROOT / "animation_tools/examples/tri_dnya_dialogue.json").read_text(encoding="utf-8"))
            # This smoke scene intentionally covers the forester's two lines only.
            plan["cues"] = plan["cues"][:2]
            pack = "lesnik_tulup_v1"
            actor = {"pack": pack, "path": [(0, (.5, .94, .65))],
                     "clips": [{"t": 0, "anim": "idle"}], "face": [(0, (134, 331))], "blink": False}
            shots = [{"id": "a", "start": 143.0, "bg": "T00", "actors": [actor]},
                     {"id": "b", "start": 145.0, "bg": "T00", "actors": [actor]},
                     {"id": "c", "start": 150.0, "bg": "T00", "actors": [actor]},
                     {"id": "d", "start": 153.5, "bg": "T00", "actors": [actor]}]
            shots, report = apply_plan(shots, 158, words, plan, set(meta["modes"]), voice_offset=6)
            self.assertFalse(report["warnings"], report["warnings"])
            self.assertAlmostEqual(shots[1]["actors"][0]["talk"][0][1], .92)
            sys.path.insert(0, str(root / "engine"))
            try:
                puppet = importlib.import_module("puppet")
                compose = importlib.import_module("compose")
                anims = puppet.Animations(root / "engine/anims")
                actual = puppet.Puppet(root / "anim" / pack, anims)
                project = {"bg_dir": root / "bg", "animations": anims, "puppets": {pack: actual},
                           "fps": 30, "envelope": lambda absolute: .8}
                renderer = compose.Renderer(project, width=640, height=360, use_gpu=False)
                compose.layout(shots, 158)
                # Before speech the selected base mouth stays closed; during speech
                # the existing renderer uses its envelope and opens the mouth.
                a = shots[0]["actors"][0]
                self.assertEqual(renderer.actor_face(a, .5, 143.5)[1], 331)
                self.assertEqual(renderer.actor_face(a, 1.0, 144.0)[1], 221)
                c = shots[2]["actors"][0]
                pose, _ = renderer.actor_pose(c, 2.8)  # 152.8 s, during "point"
                self.assertEqual(renderer.last_anim, "point")
                self.assertTrue(all(math.isfinite(float(v)) for v in pose))
                d = shots[3]["actors"][0]
                renderer.actor_pose(d, .1)
                self.assertEqual(renderer.last_anim, "point")  # gesture continues across cut
                for shot, local in ((shots[0], 1.0), (shots[1], .2), (shots[2], 2.8), (shots[3], .1)):
                    frame = renderer.shot_frame(shot, local)
                    self.assertEqual(frame.shape, (360, 640, 3))
                    self.assertTrue(np.isfinite(frame).all())
                    self.assertGreater(float(frame.std()), .01)

                if HAS_SCIPY:
                    # Exercise the documented scenes.py integration through the real
                    # render.load_project, including its real narration envelope.
                    project_dir = root / "projects" / "demo"
                    audio_dir = project_dir / "audio"
                    audio_dir.mkdir(parents=True)
                    (audio_dir / "words.json").write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
                    (project_dir / "auto_animation.json").write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
                    source = '''\
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from animation_tools import apply_plan, load_animation_ids, load_json
OFFSET = 6.0

def build(ctx):
    actor = {"pack": "lesnik_tulup_v1", "path": [(0, (.5, .94, .65))],
             "clips": [{"t": 0, "anim": "idle"}], "face": [(0, (134, 331))], "blink": False}
    shots = [{"id": "a", "start": 143.0, "bg": "T00", "actors": [actor]},
             {"id": "b", "start": 145.0, "bg": "T00", "actors": [actor]},
             {"id": "c", "start": 150.0, "bg": "T00", "actors": [actor]},
             {"id": "d", "start": 153.5, "bg": "T00", "actors": [actor]}]
    duration = 158.0
    shots, report = apply_plan(shots, duration, ctx["words"],
        load_json(Path(__file__).with_name("auto_animation.json")),
        load_animation_ids(ROOT / "engine" / "anims" / "anims.json"), voice_offset=OFFSET)
    assert not report["warnings"], report["warnings"]
    return dict(shots=shots, duration=duration, voice_offset=OFFSET)
'''
                    (project_dir / "scenes.py").write_text(source, encoding="utf-8")
                    rate = 6000
                    sound = np.zeros(rate * 152, dtype=np.int16)
                    sound[rate * 138:rate * 139] = (24000 * np.sin(2 * np.pi * 120 * np.arange(rate) / rate)).astype(np.int16)
                    wavfile.write(str(audio_dir / "narration.wav"), rate, sound)
                    render = importlib.import_module("render")
                    film, loaded_shots, loaded_renderer = render.load_project(project_dir, 360, use_gpu=False)
                    self.assertEqual(film["voice_offset"], 6.0)
                    loaded_actor = loaded_shots[0]["actors"][0]
                    self.assertEqual(loaded_renderer.actor_face(loaded_actor, 1.2, 144.2)[1], 221)
                    self.assertEqual(loaded_renderer.shot_frame(loaded_shots[0], 1.2).shape, (360, 640, 3))
            finally:
                # render.py and scenes.py add paths when imported.
                while str(root / "engine") in sys.path:
                    sys.path.remove(str(root / "engine"))
                if str(root) in sys.path:
                    sys.path.remove(str(root))
                sys.modules.pop("render", None)
                sys.modules.pop("compose", None)
                sys.modules.pop("puppet", None)


if __name__ == "__main__":
    unittest.main()
