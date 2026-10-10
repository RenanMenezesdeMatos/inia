"""Etapa 04 — renders de conferência do rosto (close-ups) e amostras de cor do render.

Uso interno do `04_skin_eyes.py` (opção `renders=<prefixo>`), SEMPRE depois de salvar o .blend: para
enxergar o rosto, as faces de cabelo do corpo são apagadas na memória e o arquivo nunca é salvo de
novo. A iluminação é a mesma de `common.render_views` (estúdio neutro, AgX), com as luzes apontando
para o torso como no enquadramento de referência, para que as cores sejam comparáveis às das
imagens de referência.
"""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import bmesh
import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

from common import BODY, FFMPEG, HEAD, WORK, _add_light, _clear_render_helpers, _look_at, obj, setup_studio

ANGLES = {"front": 0.0, "threequarter": -35.0, "profile": 90.0, "jaw": 0.0, "jawtq": -35.0, "back": 180.0}

# Pontos (x, z) de mundo para amostrar a cor renderizada na vista frontal (raio vindo de −Y).
SAMPLE_POINTS = {
    "forehead": (0.0, 1.715), "cheek": (0.052, 1.585), "cheek_hi": (0.06, 1.60), "nose_tip": (0.0, 1.575),
    "chin": (0.0, 1.515), "jaw_side": (0.085, 1.54), "neck": (0.0, 1.47), "neck_side": (0.035, 1.47),
    "under_eye": (0.045, 1.600), "lip_up": (0.0, 1.556), "lip_low": (0.0, 1.546), "brow": (0.05, 1.668),
    "iris": (0.0455, 1.6348),
}


def hide_hair_faces() -> None:
    body = obj(BODY)
    hair = [i for i, slot in enumerate(body.material_slots) if slot.material and slot.material.name.lower().startswith(("hair", "m_hair"))]
    if not hair:
        return
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in hair], context="FACES")
    bm.to_mesh(body.data)
    bm.free()


def _hex(c) -> str:
    return "#%02x%02x%02x" % tuple(int(round(x * 255)) for x in np.clip(c, 0, 1))


def render_head(prefix: str, views: list[str], res: int = 800, height: float = 0.30, zc: float = 1.625, jaw: float = 0.6) -> tuple[Path, dict]:
    _clear_render_helpers()
    setup_studio()
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("_render_camera")
    cam_data.lens = 85
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = 24
    cam = bpy.data.objects.new("_render_camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    distance = (height / 2) / math.tan(math.atan(12 / 85))
    head = obj(HEAD)
    keys = head.data.shape_keys.key_blocks if head.data.shape_keys else None
    out: list[str] = []
    samples: dict[str, str] = {}
    for view in views:
        angle = math.radians(ANGLES[view])
        center = Vector((0.0, -0.02, zc))
        direction = Vector((math.sin(angle), -math.cos(angle), 0))
        side = Vector((math.cos(angle), math.sin(angle), 0))
        cam.location = center + direction * distance
        _look_at(cam, center)
        for ob in list(bpy.data.objects):
            if ob.name.startswith("_render_") and ob.type == "LIGHT":
                bpy.data.objects.remove(ob, do_unlink=True)
        light_center = Vector((0.0, -0.02, 1.25))
        _add_light("key", light_center + direction * 2.2 - side * 1.6 + Vector((0, 0, 1.4)), light_center, 520, 2.4, (1.0, 0.95, 0.9))
        _add_light("fill", light_center + direction * 2.4 + side * 1.8 + Vector((0, 0, 0.3)), light_center, 220, 3.0, (0.95, 0.97, 1.0))
        _add_light("rim", light_center - direction * 2.0 + side * 0.8 + Vector((0, 0, 1.2)), light_center, 320, 1.6)
        if keys:
            for kb in keys[1:]:
                kb.value = 0.0
            if view.startswith("jaw") and "jawOpen" in keys:
                keys["jawOpen"].value = jaw
        bpy.context.view_layer.update()
        path = WORK / "renders" / f"{prefix}_head_{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        out.append(str(path))
        if view == "front":
            samples = _sample_front(scene, cam, path)
    if keys:
        for kb in keys[1:]:
            kb.value = 0.0
    _clear_render_helpers()
    sheet = WORK / "renders" / f"{prefix}_head.png"
    inputs: list[str] = []
    for p in out:
        inputs += ["-i", p]
    filt = f"hstack=inputs={len(out)}" if len(out) > 1 else "null"
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", *inputs, "-filter_complex", filt, str(sheet)], check=True)
    return sheet, samples


def _sample_front(scene, cam, path: Path) -> dict:
    deps = bpy.context.evaluated_depsgraph_get()
    img = bpy.data.images.load(str(path))
    w, h = img.size
    pix = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    samples = {}
    for name, (x, z) in SAMPLE_POINTS.items():
        for sign, suffix in ((-1, "_R"), (1, "_L")):
            if x == 0 and sign == 1:
                continue
            hit, loc, _n, _i, _ob, _m = scene.ray_cast(deps, Vector((sign * x, -1.0, z)), Vector((0, 1, 0)))
            if not hit:
                continue
            co = world_to_camera_view(scene, cam, loc)
            px, py = int(co.x * w), int(co.y * h)
            if not (0 <= px < w and 0 <= py < h):
                continue
            patch = pix[max(py - 3, 0):py + 4, max(px - 3, 0):px + 4, :3].reshape(-1, 3).mean(0)
            samples[name + ("" if x == 0 else suffix)] = _hex(patch)
    face = []
    for zz in np.linspace(1.52, 1.72, 26):
        for xx in np.linspace(-0.09, 0.09, 24):
            if (xx / 0.095) ** 2 + ((zz - 1.615) / 0.11) ** 2 > 1:
                continue
            if abs(zz - 1.635) < 0.025 and 0.01 < abs(xx) < 0.09:
                continue
            if abs(zz - 1.66) < 0.015 and 0.015 < abs(xx) < 0.095:
                continue
            if abs(zz - 1.552) < 0.014 and abs(xx) < 0.03:
                continue
            hit, loc, _n, _i, ob_hit, _m = scene.ray_cast(deps, Vector((xx, -1.0, zz)), Vector((0, 1, 0)))
            if not hit or ob_hit.name != HEAD:
                continue
            co = world_to_camera_view(scene, cam, loc)
            if not (0 <= co.x < 1 and 0 <= co.y < 1):
                continue
            face.append(pix[int(co.y * h), int(co.x * w), :3])
    if face:
        face_arr = np.array(face)
        order = np.argsort(face_arr @ np.array([0.2126, 0.7152, 0.0722]))
        for q in (10, 25, 50, 75, 90):
            samples[f"face_p{q}"] = _hex(face_arr[order[int(len(order) * q / 100)]])
    return samples


def dump(samples: dict) -> str:
    return json.dumps(samples)
