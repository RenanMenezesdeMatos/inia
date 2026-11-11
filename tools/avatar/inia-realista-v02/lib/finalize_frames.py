"""Etapa 06 — empties de enquadramento (`INIA_Frame_*`) medidos no modelo em repouso.

`rig-framing.ts` usa: Top.y = topo do cabelo; Face = alvo (x/z) e centro do rosto; Chest.y = limite
INFERIOR da vista do chat (um pouco abaixo do broche e do logo do peito); Belt.y = limite INFERIOR
das vistas de referência (logo abaixo do cinto). Em Blender (Z para cima) isso é a coordenada z.
"""
from __future__ import annotations

import bpy
import numpy as np
from mathutils import Vector

from common import BODY, EYES, RIG, obj, parent_to_rig
import finalize_contract as C


def world_coords(ob: bpy.types.Object, vertex_mask=None) -> np.ndarray:
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    if vertex_mask is not None:
        co = co[vertex_mask]
    m = np.array(ob.matrix_world)
    return co @ m[:3, :3].T + m[:3, 3]


def material_vertex_mask(ob: bpy.types.Object, prefixes: tuple[str, ...]) -> np.ndarray:
    slots = {i for i, s in enumerate(ob.material_slots) if s.material and s.material.name.startswith(prefixes)}
    mask = np.zeros(len(ob.data.vertices), dtype=bool)
    for poly in ob.data.polygons:
        if poly.material_index in slots:
            mask[list(poly.vertices)] = True
    if not mask.any():
        raise RuntimeError(f"{ob.name}: nenhum vértice com material {prefixes}")
    return mask


def measure() -> dict[str, Vector]:
    hair = np.vstack([world_coords(obj(C.HAIR)), world_coords(obj(C.CURLS))])
    top = Vector((0.0, float((hair[:, 1].min() + hair[:, 1].max()) / 2), float(hair[:, 2].max())))

    eyes = obj(EYES)
    eyeball = world_coords(eyes, material_vertex_mask(eyes, ("M_Skin", "girl_mat")))
    centers = []
    for side in (eyeball[eyeball[:, 0] > 0], eyeball[eyeball[:, 0] < 0]):
        centers.append((side.min(0) + side.max(0)) / 2)
    mid = (centers[0] + centers[1]) / 2
    face = Vector((0.0, float(mid[1]), float(mid[2])))

    badge = world_coords(obj(C.BADGE))
    logos = world_coords(obj(C.LOGOS))
    chest_logo = logos[np.abs(logos[:, 0]) < 0.15]
    if len(chest_logo) == 0:
        raise RuntimeError("logo do peito não encontrado em INIA_Logos (|x| < 15 cm)")
    marks_bottom = float(min(badge[:, 2].min(), chest_logo[:, 2].min()))
    chest_z = marks_bottom - C.FRAME_CHEST_BELOW_MARKS
    polo = world_coords(obj(C.POLO))
    band = polo[np.abs(polo[:, 2] - chest_z) < 0.02]
    chest = Vector((0.0, float((band[:, 1].min() + band[:, 1].max()) / 2), chest_z))

    body = obj(BODY)
    belt_pts = world_coords(body, material_vertex_mask(body, ("M_Belt", "M_Buckle")))
    belt = Vector((0.0, float((belt_pts[:, 1].min() + belt_pts[:, 1].max()) / 2),
                   float(belt_pts[:, 2].min()) - C.FRAME_BELT_BELOW_BELT))
    frames = {C.FRAME_TOP: top, C.FRAME_FACE: face, C.FRAME_CHEST: chest, C.FRAME_BELT: belt}
    order = [frames[name].z for name in C.FRAMES]
    if order != sorted(order, reverse=True):
        raise RuntimeError(f"empties fora de ordem (Top > Face > Chest > Belt): {order}")
    return frames


def create_frames() -> dict:
    for name in C.FRAMES:
        old = bpy.data.objects.get(name)
        if old is not None:
            bpy.data.objects.remove(old, do_unlink=True)
    frames = measure()
    collection = obj(RIG).users_collection[0]
    report = {}
    for name, location in frames.items():
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "PLAIN_AXES"
        empty.empty_display_size = 0.04
        collection.objects.link(empty)
        empty.location = location
        bpy.context.view_layer.update()
        parent_to_rig(empty, with_armature_modifier=False)
        report[name] = [round(v, 4) for v in location]
    bpy.context.view_layer.update()
    for name, location in frames.items():
        drift = (obj(name).matrix_world.translation - location).length
        if drift > 1e-5:
            raise RuntimeError(f"{name}: posição mudou ao parentar ({drift})")
    return report
