"""Etapa 02 — polo: relaxamento do tecido, folga, colisão com o corpo, barra da manga e UVs.

Coordenadas de MUNDO. O corpo do asset não tem pele sob a roupa; o que pode atravessar a polo é só:
pele dos braços (tubos novos), peça de pele do peito/pescoço, pescoço da cabeça e a calça (cintura).
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from outfit_polo import arm_frame, radial_dir


def _neighbors(v):
    return [e.other_vert(v) for e in v.link_edges]


def taubin(verts: list, iterations: int, lam: float = 0.5, mu: float = -0.53) -> None:
    vs = [v for v in verts if len(v.link_edges) >= 3]
    for _ in range(iterations):
        for f in (lam, mu):
            new = []
            for v in vs:
                nb = _neighbors(v)
                avg = sum((n.co for n in nb), Vector()) / len(nb)
                new.append(v.co + (avg - v.co) * f)
            for v, co in zip(vs, new):
                v.co = co


def sleeve_param(p: Vector) -> tuple[str | None, float]:
    for side, sign in (("Left", 1.0), ("Right", -1.0)):
        if sign * p.x > 0.14:
            a, d = arm_frame(side)
            return side, (p - a).dot(d)
    return None, -1.0


def relax(bm: bmesh.types.BMesh, pinned: set, sleeve_len: float, band: float, front_box, iters: int = 10, front_iters: int = 18) -> None:
    free = []
    for v in bm.verts:
        if v in pinned or v.is_boundary:
            continue
        side, t = sleeve_param(v.co)
        if side and t > sleeve_len - band - 0.012:
            continue
        free.append(v)
    taubin(free, iters)
    (x0, x1), (y0, y1), (z0, z1) = front_box
    fr = [v for v in free if x0 < v.co.x < x1 and y0 < v.co.y < y1 and z0 < v.co.z < z1]
    taubin(fr, front_iters)


def inflate(bm: bmesh.types.BMesh, ease_of, skip: set) -> None:
    bm.normal_update()
    moves = [(v, v.normal * ease_of(v)) for v in bm.verts if v not in skip]
    for v, m in moves:
        v.co += m


def bust_bump(bm: bmesh.types.BMesh, centers: list[Vector], amp: float, sigma: float) -> None:
    """Volume extra suave no busto (a etapa de proporções alarga o corpo inteiro depois)."""
    bm.normal_update()
    for v in bm.verts:
        if v.co.y > -0.02:
            continue
        g = sum(math.exp(-((v.co - c).length / sigma) ** 2) for c in centers)
        if g > 1e-3:
            v.co += v.normal * amp * min(g, 1.0)


def drape_underbust(bm: bmesh.types.BMesh, z_bust: float, z_low: float, skip: set) -> int:
    """Tecido cai reto do busto: na frente, entre z_low e z_bust, y não fica atrás da reta
    ligando o ponto mais à frente do busto (por faixa de x) ao ponto da cintura."""
    bins: dict[int, list] = {}
    for v in bm.verts:
        if v.co.y < -0.03 and abs(v.co.x) < 0.11 and z_low - 0.01 < v.co.z < z_bust + 0.04:
            bins.setdefault(int(round(v.co.x / 0.012)), []).append(v)
    moved = 0
    for vs in bins.values():
        apex = min((v for v in vs if v.co.z > z_bust - 0.03), key=lambda v: v.co.y, default=None)
        low = min((v for v in vs if abs(v.co.z - z_low) < 0.012), key=lambda v: v.co.y, default=None)
        if apex is None or low is None or apex.co.z <= low.co.z:
            continue
        for v in vs:
            if v in skip or not (low.co.z < v.co.z < apex.co.z):
                continue
            t = (v.co.z - low.co.z) / (apex.co.z - low.co.z)
            line_y = low.co.y + (apex.co.y - low.co.y) * t
            if v.co.y > line_y:
                v.co.y = v.co.y + (line_y - v.co.y) * 0.85
                moved += 1
    return moved


def collide(bm: bmesh.types.BMesh, tree: BVHTree, clearance_of, max_dist: float = 0.05) -> int:
    """Empurra para fora os vértices a menos de `clearance` da superfície do corpo (lado de fora)."""
    pushed = 0
    for v in bm.verts:
        c = clearance_of(v)
        loc, nrm, _i, dist = tree.find_nearest(v.co, max_dist)
        if loc is None:
            continue
        rel = v.co - loc
        out = rel.dot(nrm)
        if out < c:
            v.co = v.co + nrm * (c - out)
            pushed += 1
    return pushed


def sleeve_band(bm: bmesh.types.BMesh, planes: dict, band_faces: list, rib_index: int, push: float = 0.0015) -> None:
    band_verts = {v for f in band_faces for v in f.verts}
    for f in band_faces:
        f.material_index = rib_index
    for v in band_verts:
        v.co += radial_dir(v.co) * push


def sleeve_fold(bm: bmesh.types.BMesh, ring: list, d: Vector, rib_index: int, depth: float = 0.018, rim: float = 0.0025) -> list:
    """Barra dobrada para dentro: aro + forro interno (dá espessura à manga vista de baixo)."""
    dl = bm.verts.layers.deform.verify()
    a_ring, b_ring = [], []
    for v in ring:
        r = radial_dir(v.co)
        a = bm.verts.new(v.co - r * rim + d * 0.001)
        b = bm.verts.new(v.co - r * (rim + 0.001) - d * depth)
        for nv in (a, b):
            dv = nv[dl]
            for g, w in v[dl].items():
                dv[g] = w
        a_ring.append(a)
        b_ring.append(b)
    faces = []
    n = len(ring)
    for k in range(n):
        j = (k + 1) % n
        for quad, want in (([ring[k], ring[j], a_ring[j], a_ring[k]], d), ([a_ring[k], a_ring[j], b_ring[j], b_ring[k]], None)):
            f = bm.faces.new(quad)
            f.material_index = rib_index
            f.smooth = True
            f.normal_update()
            c = f.calc_center_median()
            ref = want if want is not None else -radial_dir(c)
            if f.normal.dot(ref) < 0:
                f.normal_flip()
            faces.append(f)
    return faces


def ordered_ring(verts: list, center: Vector, d: Vector) -> list:
    u = (Vector((0, 0, 1)) - d * d.z).normalized()
    w = d.cross(u)
    return sorted(verts, key=lambda v: math.atan2((v.co - center).dot(w), (v.co - center).dot(u)))


def smart_uv(ob: bpy.types.Object, tile_m: float, face_filter=None) -> dict:
    """Smart UV Project + escala para que 1 unidade de UV = `tile_m` metros (densidade uniforme)."""
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bm = bmesh.from_edit_mesh(ob.data)
    for f in bm.faces:
        f.select = face_filter(f, bm) if face_filter else True
    bmesh.update_edit_mesh(ob.data)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    me = ob.data
    uv = me.uv_layers.active.data
    a3 = auv = 0.0
    sel = [p for p in me.polygons if p.select]
    for p in sel:
        pts = [Vector((*uv[l].uv, 0)) for l in p.loop_indices]
        for i in range(1, len(pts) - 1):
            auv += ((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])).length / 2
        a3 += p.area
    scale = math.sqrt(a3 / max(auv, 1e-12)) / tile_m
    for p in sel:
        for l in p.loop_indices:
            uv[l].uv = uv[l].uv * scale
    return {"faces": len(sel), "uv_scale": round(scale, 3)}
