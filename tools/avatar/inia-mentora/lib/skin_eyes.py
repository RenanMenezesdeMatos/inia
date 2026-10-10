"""Etapa 04 — geometria dos olhos e a córnea (M_Cornea).

- Os globos oculares usam o atlas da pele (a íris é pintada em `skin_paint._paint_eyes`); aqui só se
  mede a geometria: centro e raio de cada globo (ajuste de esfera nos vértices em repouso).
- A córnea é uma casca transparente sobre a frente do globo. No three.js a mistura alfa acontece
  DEPOIS do tone mapping (saída LDR), então um brilho especular com alfa uniforme de 0,07 some. A
  córnea ganha uma textura própria pequena (`eye_cornea.png`, RGBA 256²): RGB preto (dielétrico: não
  acrescenta difuso nem véu cinza sob luz ambiente) e alfa radial — mais alto sobre íris/pupila (onde o
  reflexo das luzes deve aparecer, como nas referências) e quase zero sobre a esclera.
- As UVs da córnea são REGERADAS a partir da geometria (projeção azimutal equidistante em torno do eixo
  do olhar), então o script é idempotente e continua correto se outra etapa redimensionar os olhos.
"""
from __future__ import annotations

import math

import bpy
import numpy as np

import skin_atlas as A
from skin_paint import smoothstep

CORNEA_UV_MAX_DEG = 105.0  # ângulo (a partir do polo) que vai até a borda do quadrado UV


def _object_vertices_world(ob: bpy.types.Object) -> np.ndarray:
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    m = np.array(ob.matrix_world, dtype=np.float64)
    return co @ m[:3, :3].T + m[:3, 3]


def _faces_vertices(ob: bpy.types.Object, slots: set[int]) -> np.ndarray:
    ids: set[int] = set()
    for polygon in ob.data.polygons:
        if polygon.material_index in slots:
            ids.update(polygon.vertices)
    return np.array(sorted(ids), dtype=np.int64)


def _sphere_fit(points: np.ndarray) -> tuple[np.ndarray, float]:
    a = np.c_[2 * points, np.ones(len(points))]
    b = (points ** 2).sum(1)
    c, *_ = np.linalg.lstsq(a, b, rcond=None)
    return c[:3], float(math.sqrt(c[3] + (c[:3] ** 2).sum()))


def eyeball_geometry(eyes: bpy.types.Object, material: bpy.types.Material) -> dict:
    """Centro (|x|, y, z) médio dos dois globos e raio, a partir das faces com o material da pele."""
    slots = {i for i, slot in enumerate(eyes.material_slots) if slot.material == material}
    if not slots:
        raise RuntimeError(f"{eyes.name} não usa {material.name} (globos oculares ausentes)")
    world = _object_vertices_world(eyes)
    ids = _faces_vertices(eyes, slots)
    sides = {}
    for sign in (-1, 1):
        pts = world[ids[np.sign(world[ids, 0]) == sign]]
        if len(pts) < 50:
            raise RuntimeError(f"globo ocular do lado {sign} não encontrado")
        sides[sign] = _sphere_fit(pts)
    centers = np.array([[abs(c[0]), c[1], c[2]] for c, _ in sides.values()])
    return {
        "center": centers.mean(0),
        "radius": float(np.mean([r for _, r in sides.values()])),
        "asymmetry_mm": float(np.abs(centers[0] - centers[1]).max() * 1000),
        "sides": {int(k): (np.array([c[0], c[1], c[2]]), r) for k, (c, r) in sides.items()},
    }


def iris_angle_deg(maps: A.AtlasMaps, center_abs: np.ndarray, iris_radius_px: float) -> float:
    """Raio angular (graus, a partir do eixo do olhar) do disco da íris pintado no atlas."""
    h, w = maps.shape
    pu, pv = A.IRIS_POLE_UV[0] * w - 0.5, A.IRIS_POLE_UV[1] * h - 0.5
    ys, xs = A.box_slices(maps.shape, A.BOX_EYE_FRONT)
    yy, xx = np.mgrid[ys, xs]
    eye = maps.label[ys, xs] == A.EYEBALL
    pole = maps.pos[int(round(pv)), int(round(pu))].astype(np.float64)
    center = np.array([math.copysign(center_abs[0], pole[0]), center_abs[1], center_abs[2]])
    axis = (pole - center) / np.linalg.norm(pole - center)
    ring = eye & (np.abs(np.hypot(xx - pu, yy - pv) - iris_radius_px) < 0.75)
    d = maps.pos[ys, xs][ring].astype(np.float64) - center
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    return float(np.degrees(np.arccos(np.clip(d @ axis, -1, 1))).mean())


def regenerate_cornea_uvs(eyes: bpy.types.Object, cornea: bpy.types.Material, geometry: dict) -> dict:
    """UV = projeção azimutal equidistante em torno do eixo do olhar (−Y) de cada globo, espelhada."""
    slots = {i for i, slot in enumerate(eyes.material_slots) if slot.material == cornea}
    if not slots:
        raise RuntimeError(f"{eyes.name} não usa {cornea.name}")
    me = eyes.data
    world = _object_vertices_world(eyes)
    uv_layer = me.uv_layers.active
    uvs = np.empty(len(me.loops) * 2, dtype=np.float32)
    uv_layer.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(-1, 2)
    loop_vert = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loop_vert)
    poly_mat = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("material_index", poly_mat)
    loop_start = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", loop_start)
    loop_total = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_total", loop_total)
    loops = np.concatenate([np.arange(s, s + t) for s, t, m in zip(loop_start, loop_total, poly_mat) if m in slots])
    p = world[loop_vert[loops]]
    sign = np.where(p[:, 0] >= 0, 1.0, -1.0)
    centers = np.stack([geometry["sides"][1 if s > 0 else -1][0] for s in sign])
    d = p - centers
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    theta = np.degrees(np.arccos(np.clip(-d[:, 1], -1, 1)))           # olhar = −Y
    azimuth = np.arctan2(d[:, 2], d[:, 0] * sign)                      # espelhado: +u = lado de fora
    r = 0.5 * theta / CORNEA_UV_MAX_DEG
    uvs[loops, 0] = 0.5 + r * np.cos(azimuth)
    uvs[loops, 1] = 0.5 + r * np.sin(azimuth)
    uv_layer.data.foreach_set("uv", uvs.ravel())
    me.update()
    return {"cornea_loops": int(len(loops)), "cornea_theta_max_deg": round(float(theta.max()), 1)}


def cornea_texture(iris_deg: float, size: int = 256, alpha_iris: float = 0.34, alpha_sclera: float = 0.05) -> np.ndarray:
    """RGBA: preto + alfa radial (graus a partir do polo, mesma projeção das UVs)."""
    c = (np.arange(size, dtype=np.float32) + 0.5) / size - 0.5
    xx, yy = np.meshgrid(c, c)
    theta = np.hypot(xx, yy) * 2 * CORNEA_UV_MAX_DEG
    t = smoothstep(iris_deg * 1.10, iris_deg * 0.85, theta)
    alpha = alpha_sclera + (alpha_iris - alpha_sclera) * t
    rgba = np.zeros((size, size, 4), dtype=np.float32)
    rgba[..., 3] = alpha
    return rgba
