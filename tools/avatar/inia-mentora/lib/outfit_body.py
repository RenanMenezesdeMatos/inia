"""Etapa 02 — edição do INIA_Body: fontes da roupa, pele dos braços, remoções e calça.

O INIA_Body vem do GLB com normais customizadas (por canto). Para não perder o sombreamento da pele
original, as normais de canto são guardadas num atributo antes das edições e regravadas no fim; os
cantos novos (tubos dos braços) recebem normais suaves da própria geometria, exceto no anel de solda,
onde herdam a normal da mão (sombreamento contínuo).
"""
from __future__ import annotations

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from common import BODY, hex_to_linear_rgba, obj
import outfit_arms as arms
from outfit_util import island_bbox, material_slot, welded_islands

KEEP_N = "_outfit_keep_normal"


def store_corner_normals(me: bpy.types.Mesh) -> None:
    arr = np.zeros(len(me.loops) * 3, dtype=np.float32)
    me.corner_normals.foreach_get("vector", arr)
    if me.attributes.get(KEEP_N):
        me.attributes.remove(me.attributes[KEEP_N])
    attr = me.attributes.new(KEEP_N, "FLOAT_VECTOR", "CORNER")
    attr.data.foreach_set("vector", arr)


def restore_corner_normals(me: bpy.types.Mesh, weld_positions: set, matrix) -> None:
    """Regrava as normais: cantos antigos = guardadas; novos = suaves da geometria nova;
    cantos novos em vértices de solda (posição em `weld_positions`) = média das normais antigas ali."""
    n_loops = len(me.loops)
    kept = np.zeros(n_loops * 3, dtype=np.float32)
    me.attributes[KEEP_N].data.foreach_get("vector", kept)
    kept = kept.reshape(-1, 3)
    loop_vert = np.zeros(n_loops, dtype=np.int64)
    me.loops.foreach_get("vertex_index", loop_vert)
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    m = np.array(matrix)
    co = co @ m[:3, :3].T + m[:3, 3]
    pos_key = [tuple(k) for k in np.round(co, 5)]
    is_new = np.linalg.norm(kept, axis=1) < 1e-6

    # normais suaves das faces novas (área), por posição
    acc: dict = {}
    for poly in me.polygons:
        loops = range(poly.loop_start, poly.loop_start + poly.loop_total)
        if not all(is_new[l] for l in loops):
            continue
        fn = np.array(poly.normal[:]) * poly.area
        for l in loops:
            k = pos_key[loop_vert[l]]
            acc[k] = acc.get(k, 0) + fn
    old_acc: dict = {}
    for l in np.nonzero(~is_new)[0]:
        k = pos_key[loop_vert[l]]
        if k in weld_positions:
            old_acc[k] = old_acc.get(k, 0) + kept[l]
    out = kept.copy()
    for l in np.nonzero(is_new)[0]:
        k = pos_key[loop_vert[l]]
        v = old_acc.get(k)
        if v is None:
            v = acc.get(k, np.array([0.0, 0.0, 1.0]))
        out[l] = v / (np.linalg.norm(v) + 1e-12)
    me.normals_split_custom_set([tuple(v) for v in out])
    me.attributes.remove(me.attributes[KEEP_N])


def find_sources(bm: bmesh.types.BMesh, mats: dict[str, int]) -> dict[str, list]:
    """Ilhas do asset (mundo): jaqueta principal, top tomara-que-caia, golas da jaqueta, peito/pescoço,
    passadores e botão da calça."""
    jk = welded_islands(bm, mats["jacket"])
    if len(jk) != 3:
        raise RuntimeError(f"jacket_mat: esperado 3 ilhas, achei {len(jk)}")
    out = {"jacket": jk[0]}
    for isl in jk[1:]:
        lo, hi = island_bbox(isl)
        if lo.z < 1.06:
            out["tank"] = isl
        elif lo.z > 1.39:
            out["collar_strips"] = isl
    if "tank" not in out or "collar_strips" not in out:
        raise RuntimeError("não achei o top ou as golas da jaqueta")
    skin = welded_islands(bm, mats["skin"])
    chest = [isl for isl in skin if (lambda b: b[0].z > 1.3 and b[1].z < 1.48 and b[0].x < -0.09)(island_bbox(isl))]
    if len(chest) != 1:
        raise RuntimeError("não achei a peça de pele do peito/pescoço")
    out["chest"] = chest[0]
    pants = welded_islands(bm, mats["pants"])
    loops, button = [], []
    for isl in pants:
        lo, hi = island_bbox(isl)
        if lo.z > 1.0 and (hi - lo).length < 0.05:
            (button if (hi.x - lo.x) > 0.01 and abs(lo.x + hi.x) < 0.002 and hi.z - lo.z < 0.015 else loops).append(isl)
    out["pants"] = pants[0]
    out["belt_loops"] = loops
    out["pants_button"] = button
    if len(loops) != 9 or len(button) != 1:
        raise RuntimeError(f"calça: esperado 9 passadores + 1 botão, achei {len(loops)} + {len(button)}")
    return out


def subset_bmesh(bm: bmesh.types.BMesh, faces) -> bmesh.types.BMesh:
    """Cópia do bmesh só com `faces` (preserva camadas de peso/UV)."""
    keep = {f.index for f in faces}
    sub = bm.copy()
    sub.faces.ensure_lookup_table()
    bmesh.ops.delete(sub, geom=[f for f in sub.faces if f.index not in keep], context="FACES")
    sub.verts.ensure_lookup_table()
    sub.faces.ensure_lookup_table()
    sub.normal_update()
    return sub


def bm_to_object(name: str, bm: bmesh.types.BMesh, vgroup_names: list[str]) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for n in vgroup_names:
        ob.vertex_groups.new(name=n)
    return ob


def recolor_pants(mat: bpy.types.Material, base_hex: str = "#121111", normal_strength: float = 0.5) -> None:
    mat.name = "M_Pants"
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    for link in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(link)
    bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(base_hex)
    # sarja preta fosca: sem mapa metal/rugosidade do jeans (o canal metálico deixava a calça cinza)
    for sock in ("Metallic", "Roughness"):
        for link in list(bsdf.inputs[sock].links):
            nt.links.remove(link)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.82
    for n in [n for n in nt.nodes if n.type == "SEPARATE_COLOR" and not any(o.links for o in n.outputs)]:
        nt.nodes.remove(n)
    for n in list(nt.nodes):
        if n.type == "TEX_IMAGE" and not n.outputs["Color"].links and not n.outputs["Alpha"].links:
            nt.nodes.remove(n)
        elif n.type == "NORMAL_MAP":
            n.inputs["Strength"].default_value = normal_strength
    bsdf.inputs["Specular IOR Level"].default_value = 0.12


def remove_material_slots(ob: bpy.types.Object, names: list[str]) -> None:
    me = ob.data
    mats = list(me.materials)
    drop = [i for i, m in enumerate(mats) if m is not None and any(m.name.startswith(n) for n in names)]
    keep = [i for i in range(len(mats)) if i not in drop]
    remap = {old: new for new, old in enumerate(keep)}
    idx = np.zeros(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("material_index", idx)
    if np.isin(idx, drop).any():
        raise RuntimeError("ainda há faces usando material a remover")
    idx = np.array([remap[i] for i in idx], dtype=np.int32)
    me.materials.clear()
    for i in keep:
        me.materials.append(mats[i])
    me.polygons.foreach_set("material_index", idx)
