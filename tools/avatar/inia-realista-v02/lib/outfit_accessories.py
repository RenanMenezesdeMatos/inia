"""Etapa 02 — objetos da roupa além da polo: INIA_Logos, INIA_Badge e INIA_Belt (mundo → rig)."""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import outfit_badge as badge
import outfit_belt as belt
import outfit_decals as decals
import outfit_textures as tex
from common import bone_world_head, parent_to_rig
from outfit_build import P, PART_ATTR, _prune_groups
from outfit_polo import arm_frame
from outfit_util import principled_material, rigid_weights_from, smooth_weights, transfer_weights

Z = Vector((0, 0, 1))


def _object(name: str, bm: bmesh.types.BMesh, mats: list) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in mats:
        me.materials.append(m)
    return ob


def _chest_hit(tree: BVHTree, x: float, z: float) -> tuple[Vector, Vector]:
    hit = tree.ray_cast(Vector((x, -0.4, z)), Vector((0, 1, 0)), 0.6)
    if hit[0] is None:
        raise RuntimeError(f"sem polo em x={x} z={z}")
    return hit[0], (hit[1] if hit[1].y < 0 else -hit[1])


def _polo_body_tree(polo: bpy.types.Object) -> BVHTree:
    """BVH só do corpo da polo (material 0/1 = tecido), sem gola/carcela/botões."""
    bm = bmesh.new()
    bm.from_mesh(polo.data)
    bm.transform(polo.matrix_world)
    layer = bm.faces.layers.int[PART_ATTR]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer] != 1], context="FACES")
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def build_logos(polo: bpy.types.Object, report: dict) -> bpy.types.Object:
    img, info = decals.make_logo_atlas()
    mat = principled_material("M_Logo", base_hex="#ffffff", roughness=0.55, base_image=img, alpha_image=True, specular=0.4)
    tree = _polo_body_tree(polo)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    # peito direito de quem veste = x negativo
    x, z = P["logo_center"]
    c, n = _chest_hit(tree, x, z)
    w = P["logo_w"]
    decals.planar_decal(bm, tree, c, n, Z, w, w / info["horizontal_aspect"], decals.REGION_H, uv, cols=14, rows=5)
    for side in ("Left", "Right"):
        a, d = arm_frame(side)
        up_perp = (Z - d * Z.dot(d)).normalized()
        facing = (up_perp + Vector((0, -0.28, 0))).normalized()
        t0 = P["sleeve_logo_t"]
        hit = tree.ray_cast(a + d * t0 + facing * 0.2, -facing, 0.3)
        if hit[0] is None:
            raise RuntimeError("manga sem superfície para o logo")
        radius = (hit[0] - (a + d * t0)).length
        sw = P["sleeve_logo_w"]
        decals.cylinder_decal(bm, tree, a, d, facing, t0, radius, sw, sw, decals.REGION_S, uv, cols=10, rows=9)
    ob = _object("INIA_Logos", bm, [mat])
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    transfer_weights(ob, polo)
    smooth_weights(ob, iterations=0)  # normaliza e limita a 4 influências
    parent_to_rig(ob)
    _prune_groups(ob)
    report["logos"] = {"tris": sum(len(p.vertices) - 2 for p in ob.data.polygons), "chest_w_m": w, "sleeve_w_m": P["sleeve_logo_w"], **{k: round(v, 3) for k, v in info.items()}}
    return ob


def build_badge(polo: bpy.types.Object, report: dict) -> bpy.types.Object:
    img = badge.make_badge_texture()
    mat = principled_material("M_Badge", base_image=img, roughness=0.18, specular=0.6)
    mat.node_tree.nodes["Principled BSDF"].inputs["Coat Weight"].default_value = 0.6
    tree = _polo_body_tree(polo)
    x, z = P["badge_center"]
    c, n = _chest_hit(tree, x, z)
    n = (n + Vector((0, 0, 0.12))).normalized()
    r = P["badge_r"]
    off = badge.seat_offset(tree, c, n, Z, r)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    badge.build_badge(bm, uv, c + n * (off + 0.004), n, Z, r, 0.004)
    ob = _object("INIA_Badge", bm, [mat])
    bm.free()
    rigid_weights_from(ob, polo, c)
    parent_to_rig(ob)
    report["badge"] = {"tris": sum(len(p.vertices) - 2 for p in ob.data.polygons), "diameter_m": 2 * r, "seat_offset_mm": round(off * 1000, 1),
                       "groups": [g.name for g in ob.vertex_groups]}
    return ob


def build_belt(body: bpy.types.Object, polo: bpy.types.Object, pants_bm: bmesh.types.BMesh, report: dict) -> bpy.types.Object:
    m_belt = principled_material("M_Belt", base_hex="#0c0a0a", roughness=0.45, normal_image=tex.make_belt_normal(), normal_strength=0.08, specular=0.22)
    m_buckle = principled_material("M_Buckle", base_hex="#4a4745", roughness=0.3, metallic=0.9)
    pants_tree = BVHTree.FromBMesh(pants_bm)
    polo_tree = _polo_body_tree(polo)
    z0, z1 = P["belt_z"]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    res = belt.build_belt(bm, uv, [pants_tree, polo_tree], z0, z1, thick=0.0036, gap=0.0009, belt_mat=0)
    buckle = belt.build_buckle(bm, uv, res["front"] + Vector((0, -0.0006, 0)), mat=1)
    ob = _object("INIA_Belt", bm, [m_belt, m_buckle])
    bm.free()
    # pesos: da calça (cintura) — objeto temporário com os pesos do corpo
    src_me = bpy.data.meshes.new("_pants_src")
    pants_bm.to_mesh(src_me)
    src = bpy.data.objects.new("_pants_src", src_me)
    bpy.context.scene.collection.objects.link(src)
    for vg in body.vertex_groups:
        src.vertex_groups.new(name=vg.name)
    transfer_weights(ob, src)
    bpy.data.objects.remove(src, do_unlink=True)
    bpy.data.meshes.remove(src_me)
    parent_to_rig(ob)
    _prune_groups(ob)
    report["belt"] = {"tris": sum(len(p.vertices) - 2 for p in ob.data.polygons), "buckle_faces": len(buckle), "z": [z0, z1]}
    return ob
