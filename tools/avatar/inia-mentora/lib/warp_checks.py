"""Verificações da etapa 03: shape keys preservadas, solda cabeça-corpo, boca/pálpebras (poke-through).

- `key_stats(ob)`: deslocamento máximo (mm) e nº de vértices movidos por shape key.
- `seam_gap(ring_positions)`: distância do anel de borda da cabeça até o vértice mais próximo do corpo.
- `poke_counts(tag)`: renders Workbench chapados (pele cinza, interior da boca verde, globo ocular
  verde numa câmera dos olhos) para casos de expressão; conta pixels verdes visíveis. Casos de boca
  fechada e piscada devem ficar em ~0 como no modelo base. Não salva nada (use numa sessão descartável).
"""
from __future__ import annotations

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from common import BODY, EYES, HEAD, WORK
from warp_apply import key_world_coords, mesh_world_coords
from warp_landmarks import _islands, face_landmarks

POKE_CASES = [
    ("neutral", {}),
    ("jawOpen07", {"jawOpen": 0.7}),
    ("jawOpen06_mouthClose06", {"jawOpen": 0.6, "mouthClose": 0.6}),
    ("jawOpen1_mouthClose1", {"jawOpen": 1.0, "mouthClose": 1.0}),
    ("smile", {"mouthSmileLeft": 1.0, "mouthSmileRight": 1.0}),
    ("smile_jaw", {"mouthSmileLeft": 0.7, "mouthSmileRight": 0.7, "jawOpen": 0.35}),
    ("funnel", {"mouthFunnel": 1.0}),
    ("pucker", {"mouthPucker": 1.0}),
    ("rollLower", {"mouthRollLower": 1.0}),
    ("press", {"mouthPressLeft": 1.0, "mouthPressRight": 1.0}),
    ("blink", {"eyeBlinkLeft": 1.0, "eyeBlinkRight": 1.0}),
]
# casos em que a boca está FECHADA: o interior (verde) não pode aparecer
CLOSED_CASES = ("neutral", "jawOpen06_mouthClose06", "jawOpen1_mouthClose1", "smile", "pucker", "rollLower", "press", "blink")


def key_stats(ob) -> dict:
    keys = key_world_coords(ob)
    if not keys:
        return {}
    base = keys["Basis"]
    out = {}
    for name, P in keys.items():
        if name == "Basis":
            continue
        d = np.linalg.norm(P - base, axis=1)
        out[name] = {"max_mm": round(float(d.max()) * 1000, 2), "moved": int((d > 1e-5).sum())}
    return out


def compare_key_stats(before: dict, after: dict) -> dict:
    rows = {}
    for name, b in before.items():
        a = after.get(name, {"max_mm": None, "moved": None})
        ratio = round(a["max_mm"] / b["max_mm"], 3) if b["max_mm"] and a["max_mm"] is not None else None
        rows[name] = {"before_mm": b["max_mm"], "after_mm": a["max_mm"], "ratio": ratio,
                      "moved_before": b["moved"], "moved_after": a["moved"]}
    return rows


def seam_gap(ring: np.ndarray) -> float:
    """Maior distância (mm) de um vértice do anel da cabeça ao vértice mais próximo do INIA_Body."""
    if ring is None or len(ring) == 0:
        return float("nan")
    body = mesh_world_coords(bpy.data.objects[BODY])
    near = body[np.linalg.norm(body - ring.mean(0)[None, :], axis=1) < 0.12]
    d = np.linalg.norm(ring[:, None, :] - near[None, :, :], axis=2).min(1)
    return round(float(d.max()) * 1000, 4)


# ---------------------------------------------------------------------------
# Poke-through (Workbench chapado)
# ---------------------------------------------------------------------------

def _flat(name: str, rgba) -> bpy.types.Material:
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = rgba
    return m


def _camera(name: str, loc: Vector, target: Vector, lens: float = 85.0) -> bpy.types.Object:
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.005
    cam = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (target - loc).to_track_quat("-Z", "Y").to_euler()
    return cam


def _green_pixels(path: str) -> int:
    img = bpy.data.images.load(path)
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    a = a.reshape(-1, 4)
    return int(((a[:, 1] > 0.6) & (a[:, 0] < 0.3) & (a[:, 2] < 0.3)).sum())


def poke_counts(tag: str, cases=POKE_CASES) -> dict:
    """Prepara a cena atual (descartável!) e conta pixels verdes por caso e câmera."""
    lm = face_landmarks()
    head, eyes = bpy.data.objects[HEAD], bpy.data.objects[EYES]
    for ob in bpy.data.objects:
        if ob not in (head, eyes) and ob.type == "MESH":
            ob.hide_render = True
    labels = _islands(head, mesh_world_coords(head))
    ids, counts = np.unique(labels, return_counts=True)
    skin = labels == ids[np.argmax(counts)]
    grey, green = _flat("_probe_grey", (0.5, 0.5, 0.5, 1)), _flat("_probe_green", (0, 1, 0, 1))
    me = head.data
    me.materials.clear()
    me.materials.append(grey)
    me.materials.append(green)
    fv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", fv)
    starts = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", starts)
    me.polygons.foreach_set("material_index", np.where(skin[fv[starts]], 0, 1).astype(np.int32))
    # olhos: sem córnea, globo verde (conta globo visível na piscada)
    eme = eyes.data
    glass = [i for i, m in enumerate(eme.materials) if m and ("glass" in m.name.lower() or "cornea" in m.name.lower())]
    bm = bmesh.new()
    bm.from_mesh(eme)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in glass], context="FACES")
    bm.to_mesh(eme)
    bm.free()
    eye_mat = _flat("_probe_eye", (0.9, 0.9, 0.9, 1))
    eme.materials.clear()
    eme.materials.append(eye_mat)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "MATERIAL"
    sc.render.resolution_x, sc.render.resolution_y = 400, 320
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    U = lm["U"]
    mouth = Vector((0.0, float(lm["slit"][1]) + 0.03, float(lm["slit"][2])))
    ang = math.radians(35)
    cams = {"front": _camera("_pf", mouth + Vector((0, -0.36, 0.02)), mouth),
            "tq": _camera("_ptq", mouth + Vector((0.36 * math.sin(ang), -0.36 * math.cos(ang), 0.02)), mouth),
            "low": _camera("_plow", mouth + Vector((0, -0.33, -0.14)), mouth)}
    eye_c = Vector(lm["eye"].tolist())
    eye_cams = {"eyes": _camera("_pe", eye_c + Vector((0, -0.40, 0.03)), eye_c + Vector((0, 0, -0.01)))}
    out_dir = WORK / "renders" / "03_poke"
    os.makedirs(out_dir, exist_ok=True)
    res = {}
    for name, values in cases:
        for ob in (head, eyes):
            if ob.data.shape_keys:
                for kb in ob.data.shape_keys.key_blocks[1:]:
                    kb.value = values.get(kb.name, 0.0)
        row = {}
        eye_mat.diffuse_color = (0, 1, 0, 1) if name == "blink" else (0.9, 0.9, 0.9, 1)
        for vn, cam in (eye_cams if name == "blink" else cams).items():
            sc.camera = cam
            path = str(out_dir / f"{tag}_{name}_{vn}.png")
            sc.render.filepath = path
            bpy.ops.render.render(write_still=True)
            row[vn] = _green_pixels(path)
        res[name] = row
    res["_U_m"] = round(U, 4)
    return res
