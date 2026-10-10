"""Etapa 02 — corpo da polo derivado da jaqueta do asset (já modelada como roupa e com pesos).

Tudo em coordenadas de MUNDO (Z para cima, a personagem olha para −Y). Passos:
1. `prepare_jacket`: solda as duplicatas de costura, apaga as dobras internas (barra, punhos, gola) e
   fica só com a casca externa.
2. `cut_sleeves`: corta cada manga num plano perpendicular ao osso do braço (manga curta) e cria o
   anel da barra canelada (segundo plano, 2,2 cm antes).
3. `cut_hem`: corta a barra curta da jaqueta (z fixo); a polo é estendida depois até dentro do cinto.
4. `close_front` (outfit_polo_front): fecha a abertura da frente com uma faixa de quads e abre o
   decote em V curto acima dos botões.
5. `extend_hem`, `fit_to_body` (outfit_polo_fit): barra enfiada no cinto, folga e colisão com o corpo.
"""
from __future__ import annotations

import math

import bmesh
import numpy as np
from mathutils import Vector

from common import bone_world_head

TORSO_AXIS_Y = 0.012  # linha central aproximada do tronco (entre peito y≈−0,10 e costas y≈+0,12)


def arm_frame(side: str) -> tuple[Vector, Vector]:
    shoulder = bone_world_head(f"{side}Arm")
    elbow = bone_world_head(f"{side}ForeArm")
    return shoulder, (elbow - shoulder).normalized()


def radial_dir(p: Vector) -> Vector:
    """Direção "para fora" do corpo: do eixo do braço (mangas) ou do eixo vertical do tronco."""
    for side, sign in (("Left", 1.0), ("Right", -1.0)):
        if sign * p.x > 0.16:
            a, d = arm_frame(side)
            t = (p - a).dot(d)
            if t > 0.02:
                r = p - (a + d * t)
                return r.normalized() if r.length > 1e-6 else Vector((sign, 0, 0))
    r = Vector((p.x, p.y - TORSO_AXIS_Y, 0.0))
    return r.normalized() if r.length > 1e-6 else Vector((0, -1, 0))


def prepare_jacket(bm: bmesh.types.BMesh) -> dict:
    """Solda, apaga faces voltadas para dentro e mantém só o maior componente."""
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=2e-5)
    bm.normal_update()
    inward = [f for f in bm.faces if f.normal.dot(radial_dir(f.calc_center_median())) < -0.15]
    bmesh.ops.delete(bm, geom=inward, context="FACES")
    # maior componente por faces
    seen: set = set()
    comps = []
    for f in bm.faces:
        if f in seen:
            continue
        stack, comp = [f], []
        seen.add(f)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.edges:
                for g in e.link_faces:
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    small = [f for c in comps[1:] for f in c]
    if small:
        bmesh.ops.delete(bm, geom=small, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    return {"inward_removed": len(inward), "small_components_removed": len(comps) - 1, "faces": len(bm.faces)}


def _geom_of(faces) -> list:
    faces = list(faces)
    return list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces


def cut_sleeves(bm: bmesh.types.BMesh, sleeve_len: float, band: float) -> dict:
    """Manga curta: corta em `sleeve_len` (m) ao longo do osso Arm; anel extra `band` antes da barra.
    Devolve {lado: (plano_barra, plano_faixa)} com (ponto, direção)."""
    out = {}
    for side, sign in (("Left", 1.0), ("Right", -1.0)):
        a, d = arm_frame(side)

        def along(f):
            c = f.calc_center_median()
            return (c - a).dot(d) if sign * c.x > 0.13 else -1.0

        region = [f for f in bm.faces if along(f) > sleeve_len - 0.06]
        p_hem = a + d * sleeve_len
        bmesh.ops.bisect_plane(bm, geom=_geom_of(region), dist=1e-6, plane_co=p_hem, plane_no=d, clear_outer=True)
        region = [f for f in bm.faces if along(f) > sleeve_len - band - 0.04]
        p_band = a + d * (sleeve_len - band)
        bmesh.ops.bisect_plane(bm, geom=_geom_of(region), dist=1e-6, plane_co=p_band, plane_no=d)
        out[side] = (p_hem, p_band, d)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    return out


def cut_hem(bm: bmesh.types.BMesh, z_cut: float) -> None:
    region = [f for f in bm.faces if abs(f.calc_center_median().x) < 0.2 and f.calc_center_median().z < z_cut + 0.06]
    bmesh.ops.bisect_plane(bm, geom=_geom_of(region), dist=1e-6, plane_co=Vector((0, 0, z_cut)), plane_no=Vector((0, 0, -1)), clear_outer=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")


def boundary_loops(bm: bmesh.types.BMesh) -> list[list]:
    """Laços de borda como listas ordenadas de vértices."""
    edges = {e for e in bm.edges if e.is_boundary}
    loops = []
    while edges:
        e = edges.pop()
        chain = [e.verts[0], e.verts[1]]
        closed = False
        while True:
            v = chain[-1]
            nxt = [x for x in v.link_edges if x in edges]
            if not nxt:
                break
            x = nxt[0]
            edges.discard(x)
            o = x.other_vert(v)
            if o is chain[0]:
                closed = True
                break
            chain.append(o)
        # tenta estender para trás (laço aberto)
        if not closed:
            while True:
                v = chain[0]
                nxt = [x for x in v.link_edges if x in edges]
                if not nxt:
                    break
                x = nxt[0]
                edges.discard(x)
                chain.insert(0, x.other_vert(v))
        loops.append(chain)
    loops.sort(key=len, reverse=True)
    return loops


def sleeve_band_faces(bm: bmesh.types.BMesh, planes: dict) -> list:
    out = []
    for side, (p_hem, p_band, d) in planes.items():
        for f in bm.faces:
            c = f.calc_center_median()
            t = (c - p_band).dot(d)
            if 0 < t < (p_hem - p_band).length and (c - p_band - d * t).length < 0.12:
                out.append(f)
    return out


def ring_by_plane(loops: list[list], p: Vector, d: Vector, tol: float = 2e-3) -> list:
    for lp in loops:
        if all(abs((v.co - p).dot(d)) < tol for v in lp):
            return lp
    raise RuntimeError("anel da manga não encontrado")


def mirror_partner(verts: list, v) -> object:
    best, bd = None, 1e9
    target = Vector((-v.co.x, v.co.y, v.co.z))
    for w in verts:
        dd = (w.co - target).length
        if dd < bd:
            best, bd = w, dd
    return best, bd


def angle_about(p: Vector, center: Vector, u: Vector, w: Vector) -> float:
    r = p - center
    return math.atan2(r.dot(w), r.dot(u))


def np_co(verts) -> np.ndarray:
    return np.array([v.co[:] for v in verts])
