"""Refine the MPFB INIA base with non-destructive facial shape keys.

This stage focuses on silhouette and facial likeness. Hair, eyes, clothing and
the final shader are deliberately left for their own reviewable stages.
"""

import os
import bpy
from bl_ext.user_default.mpfb.services import TargetService


ROOT = "/Users/renanmenezes/Developer/Works/inia"
SOURCE = os.path.join(ROOT, "assets", "avatar", "inia", "inia_human_base_v03.blend")
OUTPUT = os.path.join(ROOT, "assets", "avatar", "inia", "inia_face_v04.blend")
PREVIEW = os.path.join(ROOT, "assets", "avatar", "inia", "inia_face_v04_preview.png")
TARGET_ROOT = "/private/tmp/mpfb-stage.6MDp2k/makehumancommunity-mpfb2-80919fa/src/mpfb/data/targets"


def target(relative_path: str, weight: float) -> None:
    path = os.path.join(TARGET_ROOT, relative_path + ".target.gz")
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    name = os.path.basename(relative_path)
    TargetService.load_target(human, path, weight=weight, name=name)


def aim(obj, point):
    from mathutils import Vector
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


bpy.ops.wm.open_mainfile(filepath=SOURCE)
human = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.startswith("INIA_Human"))
bpy.context.view_layer.objects.active = human
human.select_set(True)

# The reference has a friendly, rounded and lightly stylised face. Values stay
# moderate so the MakeHuman topology remains sound for subsequent rigging.
for relative_path, weight in (
    ("head/head-round", 0.46),
    ("head/head-scale-horiz-incr", 0.18),
    ("head/head-scale-vert-decr", 0.10),
    ("cheek/l-cheek-volume-incr", 0.34),
    ("cheek/r-cheek-volume-incr", 0.34),
    ("cheek/l-cheek-bones-incr", 0.18),
    ("cheek/r-cheek-bones-incr", 0.18),
    ("eyes/l-eye-scale-incr", 0.34),
    ("eyes/r-eye-scale-incr", 0.34),
    ("eyes/l-eye-height2-incr", 0.14),
    ("eyes/r-eye-height2-incr", 0.14),
    ("eyes/l-eye-corner2-up", 0.10),
    ("eyes/r-eye-corner2-up", 0.10),
    ("nose/nose-width2-incr", 0.22),
    ("nose/nose-width3-incr", 0.32),
    ("nose/nose-nostrils-width-incr", 0.20),
    ("nose/nose-scale-depth-decr", 0.10),
    ("mouth/mouth-scale-horiz-incr", 0.22),
    ("mouth/mouth-upperlip-volume-incr", 0.38),
    ("mouth/mouth-lowerlip-volume-incr", 0.34),
    ("mouth/mouth-upperlip-height-incr", 0.18),
    ("mouth/mouth-lowerlip-height-incr", 0.14),
    ("mouth/mouth-angles-up", 0.22),
    ("mouth/mouth-dimples-out", 0.12),
    ("chin/chin-width-incr", 0.10),
    ("chin/chin-height-decr", 0.10),
    ("chin/chin-prominent-decr", 0.08),
):
    target(relative_path, weight)

human["inia_stage"] = "face_refinement_v04"
human["inia_shape_keys_are_editable"] = True

scene = bpy.context.scene
scene["inia_next_step"] = "eyes_and_hair"

# Replace the earlier full-body review framing with a square bust portrait.
camera = bpy.data.objects.get("INIA_Review_Camera")
camera.location = (0.0, -1.42, 1.47)
camera.data.lens = 72
aim(camera, (0.0, 0.0, 1.47))
scene.camera = camera

for light in [obj for obj in scene.objects if obj.type == "LIGHT"]:
    light.hide_render = True

for name, location, energy, color, size in (
    ("INIA_Portrait_Key", (-1.15, -1.35, 2.15), 520, (1.0, 0.78, 0.62), 1.25),
    ("INIA_Portrait_Fill", (1.05, -1.05, 1.75), 360, (0.55, 0.40, 1.0), 1.10),
    ("INIA_Portrait_Rim", (0.15, 0.55, 2.05), 480, (0.66, 0.28, 1.0), 0.90),
):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.color, data.shape, data.size = energy, color, "DISK", size
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    aim(obj, (0.0, 0.0, 1.45))
    scene.collection.objects.link(obj)

scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = PREVIEW
scene.world.color = (0.012, 0.006, 0.02)

bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
bpy.ops.render.render(write_still=True)
print("INIA_FACE_V04_READY", OUTPUT, PREVIEW, len(human.data.shape_keys.key_blocks))
