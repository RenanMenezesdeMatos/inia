"""Etapa 08 — renders de conferência em dois estúdios.

- "web": a iluminação do app (`lib/export_web_studio.py`: luzes do three.js, PBR Neutral) — é assim
  que a personagem aparece no produto; as luzes ficam fixas no mundo e a câmera orbita, como no app.
- "agx": o estúdio de iteração das etapas 02–05 (`common.setup_studio`, AgX, luzes que acompanham a
  câmera) — só para comparar com os renders antigos.
Enquadramentos: "reference" (topo do cabelo → abaixo do quadril, igual a `common.render_views`, para
alinhar com as referências) e close-ups do rosto guiados pelo empty INIA_Frame_Face.
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector

import common
from common import REFERENCE_VIEWS, WORK, bone_world_head, obj, world_bbox
import export_web_studio as WS
import finalize_contract as C

TAN = math.tan(math.atan(12 / 85))  # lente de 85 mm, sensor vertical de 24 mm


def head_depth(z_min: float) -> tuple[float, float]:
    """Extensão em Y (frente → trás) de cabeça + cabelo acima de `z_min` (mundo)."""
    ys = []
    for name in ("INIA_Head", C.HAIR, C.CURLS):
        ob = obj(name)
        for vertex in ob.data.vertices:
            world = ob.matrix_world @ vertex.co
            if world.z > z_min:
                ys.append(world.y)
    return min(ys), max(ys)


def _studio(studio: str) -> None:
    common._clear_render_helpers()
    if studio == "web":
        WS.setup_web_studio()
    else:
        common.setup_studio()


def _agx_lights(aim: Vector, direction: Vector, side: Vector) -> None:
    for ob in list(bpy.data.objects):
        if ob.name.startswith("_render_") and ob.type == "LIGHT":
            bpy.data.objects.remove(ob, do_unlink=True)
    common._add_light("key", aim + direction * 2.2 - side * 1.6 + Vector((0, 0, 1.4)), aim, 520, 2.4, (1.0, 0.95, 0.9))
    common._add_light("fill", aim + direction * 2.4 + side * 1.8 + Vector((0, 0, 0.3)), aim, 220, 3.0, (0.95, 0.97, 1.0))
    common._add_light("rim", aim - direction * 2.0 + side * 0.8 + Vector((0, 0, 1.2)), aim, 320, 1.6)


def _shoot(prefix: str, shots: list[tuple[str, Vector, float]], studio: str, res: tuple[int, int]) -> list[Path]:
    """shots: (vista, ponto mirado, distância)."""
    _studio(studio)
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    data = bpy.data.cameras.new("_render_camera")
    data.lens, data.sensor_fit, data.sensor_height = 85, "VERTICAL", 24
    camera = bpy.data.objects.new("_render_camera", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    written = []
    for view, aim, distance in shots:
        angle = math.radians(REFERENCE_VIEWS[view][0])
        direction = Vector((math.sin(angle), -math.cos(angle), 0))
        side = Vector((math.cos(angle), math.sin(angle), 0))
        camera.location = aim + direction * distance
        common._look_at(camera, aim)
        if studio != "web":
            _agx_lights(aim, direction, side)
        path = WORK / "renders" / f"{prefix}_{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        written.append(path)
    common._clear_render_helpers()
    return written


def render_reference(prefix: str, views: list[str], studio: str = "web", res=(518, 760)) -> list[Path]:
    meshes = [ob for ob in bpy.data.objects if ob.type == "MESH" and ob.visible_get()]
    _, hi = world_bbox(meshes)
    top, bottom = hi.z + 0.03, bone_world_head("Hips").z - 0.06
    aim = Vector((0.0, bone_world_head("Head").y, (top + bottom) / 2))
    distance = ((top - bottom) / 2) / TAN * 1.02
    return _shoot(prefix, [(view, aim, distance) for view in views], studio, res)


def render_closeups(prefix: str, views: list[str], studio: str = "web", height: float = 0.40,
                    drop: float = 0.015, res: tuple[int, int] = (560, 640)) -> list[Path]:
    """Retrato: `height` metros visíveis, centro `drop` abaixo dos olhos; perfil enquadra nariz → nuca."""
    face = obj(C.FRAME_FACE).matrix_world.translation
    top = obj(C.FRAME_TOP).matrix_world.translation
    center = Vector((face.x, (face.y + top.y) / 2, face.z - drop))
    distance = (height / 2) / TAN
    depth = head_depth(face.z - height / 2)
    shots = []
    for view in views:
        aim, span = center, distance
        if view == "profile":
            aim = Vector((center.x, (depth[0] + depth[1]) / 2, center.z))
            span = max(distance, ((depth[1] - depth[0] + 0.03) * res[1] / res[0] / 2) / TAN)
        shots.append((view, aim, span))
    return _shoot(prefix, shots, studio, res)
