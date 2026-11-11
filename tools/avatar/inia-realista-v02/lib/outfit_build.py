"""Etapa 02 — montagem dos objetos da roupa (INIA_Polo, INIA_Logos, INIA_Badge, INIA_Belt) e materiais."""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import outfit_arms as arms
import outfit_badge as badge
import outfit_belt as belt
import outfit_collar as collar
import outfit_decals as decals
import outfit_polo as polo
import outfit_polo_fit as fit
import outfit_polo_front as front
import outfit_textures as tex
from outfit_util import load_image, principled_material, smooth_weights, transfer_weights, rigid_weights_from
from common import TEX_DIR, bone_world_head, hex_to_linear_rgba, parent_to_rig

PART_ATTR = "outfit_part"  # 1 = corpo da polo; 0 = gola, carcela, botões (removido no fim da etapa)

P = {
    "sleeve_len": 0.135, "band": 0.022, "z_hem": 1.118, "z_v": 1.372, "v_slope": 0.55, "w0": 0.008,
    "polo_hex": "#280444", "tile_m": 0.05,
    "hem_levels": [(1.100, 0.008), (1.082, 0.010), (1.068, 0.007), (1.056, 0.0022), (1.044, 0.0015), (1.032, 0.0012)],
    "placket_w": 0.026, "placket_len": 0.092, "buttons_dz": (0.009, 0.037, 0.065),
    "logo_center": (-0.080, 1.300), "logo_w": 0.090, "badge_center": (0.080, 1.300), "badge_r": 0.028,
    "sleeve_logo_t": 0.066, "sleeve_logo_w": 0.058,
    # folga da manga (m): base + extra que cresce até a barra; folga mínima sobre a pele do braço
    # (dentro da manga → nos últimos 2,5 cm antes da barra). Manga justa como nas referências (a barra
    # quase encosta no braço, sem "sino"); dentro, mais folga — perto do ombro a etapa 03 empurra a
    # pele mais que o tecido.
    "sleeve_ease": (0.003, 0.003), "sleeve_clearance": (0.0065, 0.0045),
    "belt_z": (1.018, 1.056),
}


def polo_materials() -> list:
    t = tex.make_polo_textures(P["polo_hex"])
    m_polo = principled_material("M_Polo", roughness=0.86, base_image=t["basecolor"], normal_image=t["normal"], normal_strength=0.42, specular=0.3)
    # v02: piquet mais legível (0,25 → 0,42). O brilho de penugem (KHR_materials_sheen) foi testado e
    # RETIRADO: no three.js, com a luz do app, até 0,08 lavava o roxo da polo para lilás (captura no navegador).
    m_rib = principled_material("M_PoloRib", roughness=0.88, base_image=t["basecolor"], normal_image=t["rib_normal"], normal_strength=0.35, specular=0.3)
    m_btn = principled_material("M_PoloButton", base_hex="#2c0a4c", roughness=0.32, specular=0.5)
    return [m_polo, m_rib, m_btn]


def _interp_from(bm_target, verts, src_bm):
    tree = BVHTree.FromBMesh(src_bm)
    arms.interpolate_weights_from(bm_target, verts, src_bm, tree, bm_target.verts.layers.deform.verify(), src_bm.verts.layers.deform.verify())


def build_polo_shell(jb: bmesh.types.BMesh, trees: dict, waist_bm, report: dict) -> dict:
    """Casca da polo (jaqueta → polo). `trees`: tank_chest, waist, body (colisão)."""
    report["prepare"] = polo.prepare_jacket(jb)
    for f in jb.faces:
        f.material_index = 0  # índice herdado do INIA_Body (jacket_mat) → M_Polo
    planes = polo.cut_sleeves(jb, P["sleeve_len"], P["band"])
    polo.cut_hem(jb, P["z_hem"])
    report["holes_filled"] = front.fill_small_holes(jb)
    fr = front.close_front(jb, P["z_hem"], P["z_v"], P["v_slope"], P["w0"], trees["tank_chest"])
    front.smooth_region(jb, fr["new_verts"], 4, 0.4)
    report["front"] = {"rows": fr["rows"], "faces": fr["faces"], "v_open_z": fr["v_bottom_z"]}
    hem_new = front.extend_hem(jb, P["z_hem"], P["hem_levels"], trees["waist"], lambda vs: _interp_from(jb, vs, waist_bm))
    hem_set = set(hem_new)
    fit.relax(jb, set(), P["sleeve_len"], P["band"], ((-0.085, 0.085), (-0.2, -0.035), (1.06, 1.375)))

    def ease(v):
        side, t = fit.sleeve_param(v.co)
        if side and t > 0.03:
            return P["sleeve_ease"][0] + P["sleeve_ease"][1] * min(1.0, max(0.0, (t - 0.03) / 0.09))
        if v.co.z > 1.41 and abs(v.co.x) < 0.1:
            return 0.0015
        return 0.0045

    fit.inflate(jb, ease, hem_set)
    breasts = [bone_world_head(b) + Vector((0, -0.055, -0.01)) for b in ("breast_left_ph", "breast_right_ph")]
    fit.bust_bump(jb, breasts, 0.005, 0.045)
    report["drape_moved"] = fit.drape_underbust(jb, 1.245, 1.10, set())
    fit.taubin([v for v in jb.verts if not v.is_boundary and 1.06 < v.co.z < 1.30 and v.co.y < -0.02], 3)

    def clearance(v):
        side, t = fit.sleeve_param(v.co)
        if side and t > 0.02:
            c_in, c_hem = P["sleeve_clearance"]
            k = min(1.0, max(0.0, (t - (P["sleeve_len"] - 0.025)) / 0.02))
            return c_in + (c_hem - c_in) * k
        return 0.0015 if v.co.z < 1.07 else 0.003

    report["collide_pushed"] = fit.collide(jb, trees["body"], clearance)
    fit.taubin([v for v in jb.verts if not v.is_boundary], 2)
    fit.collide(jb, trees["body"], clearance)
    # barra da manga: faixa canelada + dobra interna
    band = polo.sleeve_band_faces(jb, planes)
    fit.sleeve_band(jb, planes, band, 1)
    loops = polo.boundary_loops(jb)
    for side, (p_hem, p_band, d) in planes.items():
        ring = polo.ring_by_plane(loops, p_hem, d, tol=4e-3)
        ring = fit.ordered_ring(ring, p_hem, d)
        fit.sleeve_fold(jb, ring, d, 1)
    for f in jb.faces:
        f.smooth = True
    report["polo_body_faces"] = len(jb.faces)
    return {"planes": planes}


def _surface_hit(tree: BVHTree, x: float, z: float) -> tuple[Vector, Vector]:
    hit = tree.ray_cast(Vector((x, -0.4, z)), Vector((0, 1, 0)), 0.6)
    if hit[0] is None:
        raise RuntimeError(f"polo: sem superfície em x={x} z={z}")
    n = hit[1] if hit[1].y < 0 else -hit[1]
    return hit[0], n


def add_collar_placket(jb: bmesh.types.BMesh, skin_tree: BVHTree, report: dict) -> None:
    uv = jb.loops.layers.uv.verify()
    snapshot = jb.copy()
    body_tree = BVHTree.FromBMesh(snapshot)
    before = set(jb.verts)
    neck = max(polo.boundary_loops(jb), key=lambda lp: sum(v.co.z for v in lp) / len(lp))
    apex = min((v for v in neck if abs(v.co.x) < 0.006 and v.co.y < 0), key=lambda v: v.co.z)
    ordered = neck[neck.index(apex):] + neck[:neck.index(apex)]
    if ordered[1].co.x > 0:
        ordered = [ordered[0]] + ordered[1:][::-1]
    curve = [v.co.copy() for v in ordered] + [apex.co.copy()]
    c = collar.build_collar(jb, uv, curve, body_tree, skin_tree, 1)
    report["collar"] = {"cols": c["cols"], "faces": len(c["stand_faces"]) + len(c["fall_faces"]), "apex_z": round(apex.co.z, 4)}
    # carcela
    top = apex.co.z + 0.006
    zc = top - P["placket_len"] / 2
    center, nrm = _surface_hit(body_tree, 0.0, zc)
    rows, cols = 7, 4
    S = collar.surface_strip(body_tree, center, nrm, Vector((0, 0, 1)), P["placket_w"], P["placket_len"], rows, cols, 0.0019)
    tile = P["tile_m"]
    pf = collar.thick_grid(jb, S, 0.0015, None, uv, lambda i, j: (j * P["placket_w"] / (cols - 1) / tile, i * P["placket_len"] / (rows - 1) / tile), 0)
    btn_faces = 0
    for dz in P["buttons_dz"]:
        z = apex.co.z - dz
        p, n = _surface_hit(body_tree, 0.0, z)
        btn_faces += len(collar.build_button(jb, uv, p + n * 0.0021, n, mat=2))
    report["placket"] = {"faces": len(pf), "button_faces": btn_faces, "top_z": round(top, 4)}
    extras = [v for v in jb.verts if v not in before]  # o bmesh reaproveita posições livres: nunca por índice
    _interp_from(jb, extras, snapshot)
    snapshot.free()


def polo_object(jb: bmesh.types.BMesh, vg_names: list[str], mats: list) -> bpy.types.Object:
    me = bpy.data.meshes.new("INIA_Polo")
    jb.to_mesh(me)
    ob = bpy.data.objects.new("INIA_Polo", me)
    bpy.context.scene.collection.objects.link(ob)
    for n in vg_names:
        ob.vertex_groups.new(name=n)
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    if me.attributes.get("custom_normal") is not None:  # normais do GLB herdadas da jaqueta: descartar
        me.attributes.remove(me.attributes["custom_normal"])
    uvrep = fit.smart_uv(ob, P["tile_m"], lambda f, bm: f[bm.faces.layers.int[PART_ATTR]] == 1)
    ob["uv_report"] = str(uvrep)
    parent_to_rig(ob)
    _prune_groups(ob)
    smooth_weights(ob, iterations=2, factor=0.45)
    return ob


def _prune_groups(ob: bpy.types.Object) -> None:
    used = set()
    for v in ob.data.vertices:
        for g in v.groups:
            if g.weight > 1e-4:
                used.add(g.group)
    for name in [vg.name for vg in ob.vertex_groups if vg.index not in used]:
        ob.vertex_groups.remove(ob.vertex_groups[name])
