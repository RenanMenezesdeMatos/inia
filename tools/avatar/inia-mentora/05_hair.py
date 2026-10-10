"""Etapa 05 — afro de cachinhos definidos (volume interno + camada de cachos 3D).

    blender -b --python tools/avatar/inia-mentora/05_hair.py -- in=<entrada.blend> out=<saida.blend> [renders=<prefixo>] [curls=0] [tex_dir=<pasta>]

- Remove do INIA_Body o que restar do rabo de cavalo original (material `hair_mat`); o couro
  cabeludo por baixo é limpo.
- Mede os marcos do rosto NO MODELO (olhos, queixo, nariz, largura das bochechas, orelhas, crânio)
  e converte a silhueta medida nas referências (`lib/hair_refshape.py`, em unidades do rosto) para
  metros — o cabelo acompanha mudanças posteriores de proporção do rosto.
- `INIA_Hair` (material `M_Hair`): volume fechado por campo implícito (surface nets), decimado para
  ≤ 6k triângulos, UV em metros (projeção por caixa) com textura tileável de cachinhos
  (cor + normal) gerada em `textures/hair_volume_*.png`. A forma é ajustada ao crânio do modelo
  (`lib/hair_fit.py`): a frente nasce rente à testa no arco da linha do cabelo e sobe inclinada
  (sem faixa de couro cabeludo nem "aba" de cogumelo), o topo tem vinco central fundo (coração na
  frente e nas costas) e a base respeita todas as malhas da roupa (gola da polo incluída).
- `INIA_HairCurls` (material `M_HairCurls`): molinhas (ringlets) pequenas e fechadas — tubo de 3
  lados, eixo quase tangente à superfície, caindo a partir da risca e pela gravidade — distribuídas
  tipo Poisson sobre a superfície visível do volume (quase nenhuma no vinco do topo), menores na
  linha do cabelo, testadas contra rosto, pele e roupa e cortadas pelo orçamento (≤ 60k
  triângulos); cor por vértice (atributo `Col` → COLOR_0): raiz escura, caramelo em mechas
  (ruído coerente) na superfície externa, mais escuro perto da risca e do rosto.
- Os dois objetos: 100 % no osso `Head` (grupo "Head"), filhos do INIA_Rig com modificador
  Armature; coordenadas locais no mesmo espaço das outras malhas do rig (inversa de parent = I).
- Determinístico (seeds fixas) e reexecutável: apaga e recria o próprio resultado.
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import hair_curls as hc  # noqa: E402
import hair_fit as hf  # noqa: E402
import hair_textures as ht  # noqa: E402
import hair_volume as hv  # noqa: E402
from common import (BODY, EYES, HEAD, RIG, TEX_DIR, WORK, apply_preview_pose, clear_pose,  # noqa: E402
                    compare_sheet, hex_to_linear_rgba, obj, open_blend, parse_args, render_views, rig,
                    save_blend, write_report)

HAIR = "INIA_Hair"
CURLS = "INIA_HairCurls"
HEAD_BONE = "Head"
VOLUME_MAX_TRIS = 6000
CURLS_MAX_TRIS = 60000

# Parâmetros (em unidades do rosto U = olhos→queixo, para acompanhar a escala da cabeça).
CFG = {
    "volume": {"voxel_u": 0.052, "target_tris": 5200, "width_scale": 1.0, "height_scale": 1.02,
               "back_scale": 1.0, "inset_u": 0.055, "side_front_shift_u": 0.09, "cover_u": 0.11, "clearance": 0.012,
               "albedo": 0.34},
    # cachinhos = molinhas (ringlets) pequenas e fechadas, deitadas na superfície e caindo a partir
    # da risca (eixo ~tangente); tubo de 3 lados para caber mais cachos no orçamento
    "curls": {"target_tris": 61000, "seed": 20260924, "helix_u": 0.055, "tube_u": 0.024, "pitch_u": 0.05,
              "turns": (3.5, 5.5), "segments_per_turn": 6, "sides": 3, "tilt_deg": (84.0, 99.0), "gravity": 0.12,
              "axis_lift": 1.2, "embed_u": 0.024, "hairline_tilt": 0.08, "max_tilt_scale": 1.25,
              "flow_randomness": 0.25, "loop_contrast": 0.4, "dip_root_suppress": 0.85, "clump_wavelength": 0.07},
    "uv_tile_m": 0.15,
    # ajuste ao crânio do modelo (lib/hair_fit.py): franja preenchida rente à testa, topo em 2 lóbulos
    "fit": {"fringe_side_u": 0.12, "dip_depth_u": 0.48, "dip_hw_u": 0.22,
            "dip_reach_u": 0.70, "shoulder_round_u": 0.0, "window_drop_u": 0.07, "window_slope": 1.1,
            "arc_c2": 0.25, "arc_c4": 0.25},
}


# ---------------------------------------------------------------------------
# Limpeza / preparo
# ---------------------------------------------------------------------------

def remove_previous_result() -> None:
    for name in (HAIR, CURLS):
        ob = bpy.data.objects.get(name)
        if ob is not None:
            mesh = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if mesh is not None and mesh.users == 0:
                bpy.data.meshes.remove(mesh)
    for name in ("M_Hair", "M_HairCurls"):
        mat = bpy.data.materials.get(name)
        if mat is not None and mat.users == 0:
            bpy.data.materials.remove(mat)


def remove_body_hair() -> dict:
    """Apaga as faces com material `hair_mat*` do corpo e o slot do material."""
    body = obj(BODY)
    mesh = body.data
    slots = [i for i, m in enumerate(mesh.materials) if m is not None and m.name.startswith("hair_mat")]
    if not slots:
        return {"removed_faces": 0, "removed_slots": 0}
    bm = bmesh.new()
    bm.from_mesh(mesh)
    kill = [f for f in bm.faces if f.material_index in slots]
    removed = len(kill)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    for slot in sorted(slots, reverse=True):
        for poly in mesh.polygons:
            if poly.material_index > slot:
                poly.material_index -= 1
        mesh.materials.pop(index=slot)
    mesh.update()
    return {"removed_faces": removed, "removed_slots": len(slots)}


def to_rig_space(ob: bpy.types.Object) -> None:
    """Coordenadas locais no espaço do rig (como as malhas importadas), parent sem inversa."""
    armature = rig()
    ob.data.transform(armature.matrix_world.inverted() @ ob.matrix_world)
    ob.parent = armature
    ob.parent_type = "OBJECT"
    ob.matrix_parent_inverse.identity()
    ob.matrix_basis.identity()
    modifier = ob.modifiers.new("Armature", "ARMATURE")
    modifier.object = armature
    group = ob.vertex_groups.new(name=HEAD_BONE)
    group.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")


# ---------------------------------------------------------------------------
# Materiais
# ---------------------------------------------------------------------------

def _principled(mat: bpy.types.Material) -> tuple[bpy.types.NodeTree, bpy.types.Node]:
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    out.location = (400, 0)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return tree, bsdf


def volume_material(paths: dict) -> bpy.types.Material:
    mat = bpy.data.materials.new("M_Hair")
    tree, bsdf = _principled(mat)
    color = tree.nodes.new("ShaderNodeTexImage")
    color.image = bpy.data.images.load(str(paths["basecolor"]), check_existing=True)
    color.image.colorspace_settings.name = "sRGB"
    color.location = (-500, 200)
    normal_tex = tree.nodes.new("ShaderNodeTexImage")
    normal_tex.image = bpy.data.images.load(str(paths["normal"]), check_existing=True)
    normal_tex.image.colorspace_settings.name = "Non-Color"
    normal_tex.location = (-500, -150)
    normal_map = tree.nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 1.0
    normal_map.location = (-200, -150)
    attr = tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    attr.location = (-500, 450)
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.location = (-200, 250)
    tree.links.new(color.outputs["Color"], mix.inputs[6])
    tree.links.new(attr.outputs["Color"], mix.inputs[7])
    tree.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    tree.links.new(normal_tex.outputs["Color"], normal_map.inputs["Color"])
    tree.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.8
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.1
    bsdf.inputs["Specular Tint"].default_value = hex_to_linear_rgba("#c98a55")
    return mat


def curls_material() -> bpy.types.Material:
    mat = bpy.data.materials.new("M_HairCurls")
    tree, bsdf = _principled(mat)
    attr = tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    attr.location = (-400, 100)
    tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.04
    bsdf.inputs["Specular Tint"].default_value = hex_to_linear_rgba("#c98a55")
    bsdf.inputs["Sheen Weight"].default_value = 0.0
    bsdf.inputs["Sheen Roughness"].default_value = 0.4
    bsdf.inputs["Sheen Tint"].default_value = hex_to_linear_rgba("#c08a5a")
    return mat


def box_project_uv(ob: bpy.types.Object, tile_m: float) -> None:
    mesh = ob.data
    uv = mesh.uv_layers.new(name="UVMap")
    co = np.array([v.co[:] for v in mesh.vertices])
    for poly in mesh.polygons:
        n = np.abs(np.array(poly.normal[:]))
        axis = int(n.argmax())
        a, b = [(1, 2), (0, 2), (0, 1)][axis]
        for li in poly.loop_indices:
            p = co[mesh.loops[li].vertex_index]
            uv.data[li].uv = (p[a] / tile_m, p[b] / tile_m)


# ---------------------------------------------------------------------------
# Proteção do rosto/pele/ombros para os cachos
# ---------------------------------------------------------------------------

class CurlGuard:
    def __init__(self, lm: dict, head_dist: hv.HeadDistance, body_top, shape: hv.HairShape, clearance: float):
        self.lm = lm
        self.head_dist = head_dist
        self.body_top = body_top
        self.shape = shape
        self.clearance = clearance
        self.window = shape.face_window

    def violations(self, pts: np.ndarray, t: np.ndarray) -> np.ndarray:
        """Máscara por ponto: invade o rosto (na frente da pele do rosto, abaixo do arco da linha do
        cabelo), entra na pele (depois da raiz) ou desce até a roupa."""
        bad = np.zeros(len(pts), dtype=bool)
        x, y, z = pts[:, 0], pts[:, 1], pts[:, 2]
        # rosto: nada na frente da pele do rosto abaixo do arco da linha do cabelo (com folga)
        if self.window is not None:
            bad |= self.window.cut(pts, margin=0.014) > -0.004
        # pele: só depois do primeiro trecho (a raiz nasce enterrada no volume, rente ao couro)
        check = t > 0.18
        near = check & (np.abs(x) < 0.2) & (z > self.lm["chin_z"] - 0.12)
        if near.any():
            sd = self.head_dist(pts[near], max_dist=0.05)
            bad[np.nonzero(near)[0][sd < 0.003]] = True
        grid, x0, y0, cell = self.body_top
        gx = np.clip(((x - x0) / cell).astype(int), 0, grid.shape[0] - 1)
        gy = np.clip(((y - y0) / cell).astype(int), 0, grid.shape[1] - 1)
        top = grid[gx, gy]
        bad |= np.isfinite(top) & (z < top + self.clearance)
        return bad


# ---------------------------------------------------------------------------
# Construção
# ---------------------------------------------------------------------------

def region_factors(p: np.ndarray, nrm: np.ndarray, lm: dict, head_dist) -> dict:
    """Fatores por ponto (0..1) usados na cor: risca/topo central, face de baixo, lado do rosto e
    proximidade da linha do cabelo (0 rente à pele → 1 longe)."""
    u = lm["U"]
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    sd = head_dist(p, max_dist=0.2)
    return {
        "part": np.exp(-(x / (0.35 * u)) ** 2) * np.clip((z - (lm["crown_z"] - 0.1 * u)) / (0.5 * u), 0, 1),
        "under": np.clip(-nrm[:, 2] - 0.2, 0, 1),
        "face_side": np.clip(1 - (y - (lm["eye"][1] - 0.2 * u)) / (0.9 * u), 0, 1) * (z < lm["eye_z"] + 0.9 * u),
        "hairline": np.clip((sd - 0.004) / 0.03, 0, 1),
    }


def paint_volume_colors(ob: bpy.types.Object, lm: dict, head_dist) -> None:
    """Multiplicador de cor do volume (COLOR_0 × textura): escurece a risca, a face de baixo e a
    borda do rosto, como nas referências."""
    co, tris, _ = hc.mesh_triangles(ob)
    vn = hc.vertex_normals(co, tris)
    reg = region_factors(co, vn, lm, head_dist)
    k = np.clip(1.0 - 0.45 * reg["part"] - 0.3 * reg["under"] - 0.3 * reg["face_side"] - 0.25 * (1 - reg["hairline"]), 0.35, 1.0)
    clump = hc.smooth_noise(co, CFG["curls"]["clump_wavelength"], CFG["curls"]["seed"] + 1)
    k = CFG["volume"]["albedo"] * k * np.clip(0.7 + 0.45 * clump, 0.7, 1.1)
    rgba = np.ones((len(co), 4), dtype=np.float32)
    rgba[:, 0] = k
    rgba[:, 1] = k ** 1.08
    rgba[:, 2] = k ** 1.15
    attr = ob.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", rgba.ravel())
    ob.data.color_attributes.active_color = attr


def build_volume(lm: dict, head_dist, body_top) -> tuple[bpy.types.Object, hv.HairShape, dict]:
    cfg = CFG["volume"]
    u = lm["U"]
    fit = CFG["fit"]
    shape = hf.FittedHairShape(lm, fringe_side_u=fit["fringe_side_u"],
                               dip_depth_u=fit["dip_depth_u"], dip_hw_u=fit["dip_hw_u"], dip_reach_u=fit["dip_reach_u"],
                               shoulder_round_u=fit["shoulder_round_u"],
                               width_scale=cfg["width_scale"], height_scale=cfg["height_scale"],
                               back_scale=cfg["back_scale"], inset=cfg["inset_u"] * u, cover=cfg["cover_u"] * u,
                               clearance=cfg["clearance"],
                               face_window=hf.FittedFaceWindow(lm, center_u=0.85 - fit["window_drop_u"], slope=fit["window_slope"],
                                                                 c2=fit["arc_c2"], c4=fit["arc_c4"]),
                               side_front_shift=cfg["side_front_shift_u"] * u)
    ob, stats = hv.build_volume_object(HAIR, shape, head_dist, body_top, cfg["voxel_u"] * u,
                                       min(cfg["target_tris"], VOLUME_MAX_TRIS))
    stats["pushed_out_of_face"] = hf.push_out_of_face(ob, shape.face_window)
    return ob, shape, stats


def push_out_of_face(ob: bpy.types.Object, window: hv.FaceWindow) -> int:
    """Vértices do volume que a suavização/decimação deixou na frente do rosto (abaixo do arco)
    voltam para trás da pele: a malha continua fechada e a testa fica limpa."""
    co = hv._world_coords(ob)
    moved = 0
    for _ in range(3):
        cut = window.cut(co, margin=0.004)
        bad = cut > -0.001
        if not bad.any():
            break
        moved += int(bad.sum())
        d = window.front_depth(co[bad, 0], co[bad, 2])
        target = np.where(np.isfinite(d), d + window.margin + 0.004, co[bad, 1] + cut[bad] + 0.002)
        co[bad, 1] = np.maximum(co[bad, 1] + cut[bad] + 0.002, target)
    inv = np.array(ob.matrix_world.inverted())
    local = co @ inv[:3, :3].T + inv[:3, 3]
    ob.data.vertices.foreach_set("co", local.astype(np.float32).ravel())
    ob.data.update()
    return moved


def view_directions() -> np.ndarray:
    """Direções de câmera (da superfície para a câmera) usadas na visibilidade: anel horizontal,
    um pouco de baixo e de cima (a câmera do app fica perto da altura dos olhos)."""
    dirs = []
    for elev, count in ((-18, 8), (0, 12), (22, 10), (50, 6)):
        e = math.radians(elev)
        for k in range(count):
            a = 2 * math.pi * (k + (0.5 if elev else 0.0)) / count
            dirs.append((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))
    return np.array(dirs)


def occluder_tree(volume: bpy.types.Object, lm: dict):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    co_v, tris_v, _ = hc.mesh_triangles(volume)
    body = obj(BODY)
    co_b = hv._world_coords(body)
    polys_b = [list(poly.vertices) for poly in body.data.polygons]
    co_h = lm["skin_co"]
    polys = [list(t) for t in tris_v.tolist()]
    offset = len(co_v)
    polys += [[i + offset for i in poly] for poly in lm["skin_polys"]]
    offset += len(co_h)
    polys += [[i + offset for i in poly] for poly in polys_b]
    verts = np.concatenate([co_v, co_h, co_b])
    return BVHTree.FromPolygons([Vector(v) for v in verts], polys)


def build_curl_layer(volume: bpy.types.Object, lm: dict, shape: hv.HairShape, head_dist, body_top) -> tuple[bpy.types.Object, dict]:
    cfg = CFG["curls"]
    rng = np.random.default_rng(cfg["seed"])
    u = lm["U"]
    c = cfg
    params = hc.CurlParams(helix_radius=c["helix_u"] * u, tube_radius=c["tube_u"] * u, pitch=c["pitch_u"] * u,
                           turns=c["turns"], segments_per_turn=c["segments_per_turn"], tilt_deg=c["tilt_deg"],
                           gravity=c["gravity"], flow_randomness=c["flow_randomness"], sides=c["sides"],
                           axis_lift=c["axis_lift"], embed=c["embed_u"] * u)
    co, tris, fn = hc.mesh_triangles(volume)
    vn = hc.vertex_normals(co, tris)
    centroid = co[tris].mean(1)
    sd_c = head_dist(centroid, max_dist=0.2)
    # visibilidade: o orçamento vai para a superfície que aparece (externa), não para a face de baixo
    vis = hc.surface_visibility(co, tris, fn, occluder_tree(volume, lm), view_directions())
    vis_n = np.clip(vis / max(float(np.percentile(vis, 90)), 1e-6), 0, 1)
    allowed = (sd_c > 0.004) * (0.04 + vis_n)
    # vinco/risca do topo: quase sem cachos 3D, para o formato de coração não ser preenchido
    if hasattr(shape, "dip"):
        allowed = allowed * (1.0 - cfg["dip_root_suppress"] * np.clip(shape.dip(centroid) / shape.dip_depth, 0, 1))

    def rel_radius(p: np.ndarray, tri: np.ndarray) -> np.ndarray:
        sd = head_dist(p, max_dist=0.2)
        near_line = 0.62 + 0.38 * np.clip((sd - 0.004) / 0.03, 0, 1)
        return near_line * (1.0 + 1.6 * (1.0 - vis_n[tri]) ** 2)

    # estimativa de triângulos por cacho para mirar o orçamento
    mean_turns = np.mean(params.turns)
    seg = mean_turns * params.segments_per_turn
    tris_per = (seg - 1) * params.sides * 2 + params.sides
    target = int(cfg["target_tris"] / tris_per)
    roots, tri_idx = hc.sample_roots(co, tris, allowed, rel_radius, target, rng)
    # normal suave na raiz (interpolada pelos vértices do triângulo)
    nrm = vn[tris[tri_idx]].mean(1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    reg = region_factors(roots, nrm, lm, head_dist)
    hairline = reg["hairline"]
    # linha do cabelo e risca: cachos menores
    size = (0.6 + 0.4 * hairline) * (1.0 - 0.25 * reg["part"])
    # caimento: para fora da risca/coroa e para baixo (gravidade)
    crown = np.array([0.0, shape.center[1], shape.z_top])
    away = roots - crown
    away /= np.linalg.norm(away, axis=1, keepdims=True)
    away[:, 1] *= rng.uniform(0.25, 1.0, len(away))
    flow = away + np.array([0.0, 0.0, -0.8])
    # caramelo por região: muito na superfície externa, menos na risca, no rosto e embaixo
    base_hl = np.clip(0.72 - 0.55 * reg["part"] - 0.45 * reg["under"] - 0.3 * reg["face_side"]
                      - 0.3 * (1 - hairline), 0.05, 0.92)
    # mechas: vizinhos compartilham cor (caramelo em grupos, frestas escuras) e caimento
    clump = hc.smooth_noise(roots, cfg["clump_wavelength"], cfg["seed"] + 1)
    highlight = np.clip(base_hl * (0.1 + 1.5 * clump ** 1.5), 0.03, 0.95)

    rnd = hc.draw_curl_randoms(len(roots), params, rng)
    coherent = np.stack([hc.smooth_noise(roots, cfg["clump_wavelength"], cfg["seed"] + 2 + k) - 0.5
                         for k in range(3)], axis=1)
    rnd["rand_dir"] = 0.45 * rnd["rand_dir"] + 3.0 * coherent
    guard = CurlGuard(lm, head_dist, body_top, shape, CFG["volume"]["clearance"])
    # cachos: arco da linha do cabelo das referências (o do volume desce um pouco para compensar a
    # suavização da malha), com a mesma inclinação da franja
    guard.window = hf.FittedFaceWindow(lm, slope=CFG["fit"]["window_slope"], c2=CFG["fit"]["arc_c2"], c4=CFG["fit"]["arc_c4"])
    alive = np.ones(len(roots), dtype=bool)
    scale = np.ones(len(roots))
    # na linha do cabelo os cachos deitam mais (não apontam para o rosto)
    tilt_scale = 1.0 + cfg["hairline_tilt"] * (1 - hairline)
    shrink_log = []
    for attempt in range(4):
        geo = hc.curl_centerlines(roots, nrm, size * scale, rnd, params, flow, tilt_scale)
        center, seg_n = geo["center"], geo["segments"]
        pts = center.reshape(-1, 3)
        tt = geo["t"].reshape(-1)
        bad = guard.violations(pts, tt).reshape(center.shape[:2])
        valid_sample = np.arange(center.shape[1])[None, :] <= seg_n[:, None]
        failing = (bad & valid_sample).any(1) & alive
        shrink_log.append(int(failing.sum()))
        if not failing.any():
            break
        if attempt == 3:
            alive &= ~failing
            break
        scale[failing] *= 0.72
        tilt_scale[failing] = np.minimum(tilt_scale[failing] * 1.08, cfg["max_tilt_scale"])
    # conferência final na malha de verdade (o tubo tem espessura): quem ainda toca o rosto sai
    late_drop = 0
    budget_drop = 0
    budget = CURLS_MAX_TRIS - 600
    root_vis = vis_n[tri_idx]
    for _ in range(6):
        keep = np.nonzero(alive)[0]
        geo = hc.curl_centerlines(roots[keep], nrm[keep], (size * scale)[keep], {k: v[keep] for k, v in rnd.items()},
                                  params, flow[keep], tilt_scale[keep])
        # orçamento: se passar (entrada com proporções diferentes), saem os cachos menos visíveis
        tris_each = (geo["segments"] - 1) * params.sides * 2 + params.sides
        excess = int(tris_each.sum()) - budget
        if excess > 0:
            order = np.argsort(root_vis[keep], kind="stable")
            n_drop = int(np.searchsorted(np.cumsum(tris_each[order]), excess)) + 1
            alive[keep[order[:n_drop]]] = False
            budget_drop += n_drop
            continue
        # lado de fora de cada volta (longe do volume) mais claro: define o desenho de cada cachinho
        outer = np.einsum("nsk,nk->ns", geo["radial"], nrm[keep])
        verts, faces, owner, tv, ov = hc.tube_mesh(geo["center"], geo["tube"], geo["radial"], geo["segments"],
                                                   params.sides, values=outer)
        touching = np.unique(owner[guard.window.cut(verts, margin=0.004) > -0.001])
        if len(touching) == 0:
            break
        alive[keep[touching]] = False
        late_drop += len(touching)
    else:
        raise RuntimeError("cachos: a conferência final (rosto/orçamento) não convergiu")
    root_c, mid_c, tip_c = hc.curl_colors(len(keep), highlight[keep], rng)
    # raiz → meio → ponta; a primeira volta fica escura (raiz enterrada no volume)
    a = np.clip((tv - 0.05) / 0.25, 0, 1)[:, None]
    b = np.clip((tv - 0.2) / 0.5, 0, 1)[:, None] ** 0.8
    colors = root_c[owner] * (1 - a) + mid_c[owner] * a
    colors = colors * (1 - b) + tip_c[owner] * b
    loop = np.clip(tv / 0.2, 0, 1)[:, None]
    colors = colors * (1.0 + loop * cfg["loop_contrast"] * ov[:, None])

    mesh = bpy.data.meshes.new(CURLS)
    all_faces = np.concatenate(faces)
    quads = all_faces[all_faces[:, 3] >= 0]
    trisf = all_faces[all_faces[:, 3] < 0][:, :3]
    loops = np.concatenate([quads.ravel(), trisf.ravel()])
    loop_start = np.concatenate([np.arange(len(quads)) * 4, len(quads) * 4 + np.arange(len(trisf)) * 3])
    loop_total = np.concatenate([np.full(len(quads), 4), np.full(len(trisf), 3)])
    mesh.vertices.add(len(verts))
    mesh.vertices.foreach_set("co", verts.astype(np.float32).ravel())
    mesh.loops.add(len(loops))
    mesh.loops.foreach_set("vertex_index", loops.astype(np.int32))
    mesh.polygons.add(len(loop_start))
    mesh.polygons.foreach_set("loop_start", loop_start.astype(np.int32))
    mesh.polygons.foreach_set("loop_total", loop_total.astype(np.int32))
    mesh.update(calc_edges=True)
    mesh.validate()
    attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.ones((len(verts), 4), dtype=np.float32)
    rgba[:, :3] = colors
    attr.data.foreach_set("color", rgba.ravel())
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = 0
    mesh.shade_smooth()
    ob = bpy.data.objects.new(CURLS, mesh)
    bpy.context.scene.collection.objects.link(ob)
    area = 0.5 * np.linalg.norm(np.cross(co[tris[:, 1]] - co[tris[:, 0]], co[tris[:, 2]] - co[tris[:, 0]]), axis=1)
    stats = {
        "visible_area_m2": round(float((area * vis_n).sum()), 4),
        "curl_cover_m2": round(float((2 * params.helix_radius * geo["length"]).sum()), 4),
        "roots_sampled": int(len(roots)),
        "curls": int(len(keep)),
        "dropped": int(len(roots) - len(keep)),
        "dropped_touching_face": late_drop,
        "dropped_for_budget": budget_drop,
        "shrunk_per_attempt": shrink_log,
        "mean_turns": round(float(geo["turns"].mean()), 2),
        "mean_length_m": round(float(geo["length"].mean()), 4),
    }
    return ob, stats


def triangle_count(ob: bpy.types.Object) -> int:
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def main() -> None:
    args = parse_args()
    if "in" not in args or "out" not in args:
        raise SystemExit("uso: -- in=<entrada.blend> out=<saida.blend> [renders=<prefixo>] [curls=0]")
    started = time.time()
    if args.get("cfg"):
        # iteração: `cfg=<json>` sobrescreve chaves de CFG por seção ({"fit": {"arc_c4": 1.0}})
        for section, values in json.loads(Path(args["cfg"]).read_text()).items():
            CFG[section].update(values)
    open_blend(args["in"])
    for name in (RIG, BODY, HEAD, EYES):
        obj(name)
    if HEAD_BONE not in rig().data.bones:
        raise KeyError("osso ausente: Head")
    clear_pose()
    remove_previous_result()
    body_report = remove_body_hair()

    lm = hv.measure_landmarks()
    head_dist = hv.HeadDistance(lm["skin_co"], lm["skin_polys"])
    body_top = hf.outfit_top_heightfield(exclude=(HEAD, EYES, HAIR, CURLS))
    volume, shape, vol_stats = build_volume(lm, head_dist, body_top)
    box_project_uv(volume, CFG["uv_tile_m"])
    paint_volume_colors(volume, lm, head_dist)
    tex_paths = ht.build_volume_textures(Path(args.get("tex_dir", str(TEX_DIR))))
    volume.data.materials.append(volume_material(tex_paths))
    volume.data.shade_smooth()

    curl_stats = {}
    curls = None
    if args.get("curls", "1") != "0":
        curls, curl_stats = build_curl_layer(volume, lm, shape, head_dist, body_top)
        curls.data.materials.append(curls_material())

    # medidas da silhueta (antes de mudar de espaço)
    parts = [volume] + ([curls] if curls else [])
    pts = np.concatenate([hv._world_coords(ob) for ob in parts])
    face_w = 2 * lm["face_hw"]
    silhouette = {
        "width_m": round(float(np.ptp(pts[:, 0])), 4),
        "width_over_face": round(float(np.ptp(pts[:, 0]) / face_w), 3),
        "top_above_scalp_m": round(float(pts[:, 2].max() - lm["crown_z"]), 4),
        "back_y_m": round(float(pts[:, 1].max()), 4),
        "bottom_z_m": round(float(pts[:, 2].min()), 4),
        "front_y_m": round(float(pts[:, 1].min()), 4),
    }
    for ob in parts:
        to_rig_space(ob)
    report = {
        "stage": "05_hair",
        "in": args["in"],
        "out": args["out"],
        "body": body_report,
        "landmarks": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in lm.items()
                      if k in ("eye_z", "chin_z", "nose_y", "U", "face_hw", "skull_hw", "crown_z", "skull_back_y")},
        "volume": {**vol_stats, "tris": triangle_count(volume)},
        "curls": {**curl_stats, "tris": triangle_count(curls) if curls else 0},
        "silhouette": silhouette,
        "textures": {k: str(v) for k, v in tex_paths.items()},
        "seconds": round(time.time() - started, 1),
    }
    if report["volume"]["tris"] > VOLUME_MAX_TRIS:
        raise RuntimeError(f"INIA_Hair acima do orçamento: {report['volume']['tris']}")
    if curls and report["curls"]["tris"] > CURLS_MAX_TRIS:
        raise RuntimeError(f"INIA_HairCurls acima do orçamento: {report['curls']['tris']}")
    save_blend(args["out"])
    write_report(Path(args["out"]).with_suffix(".json"), report)
    if args.get("renders"):
        apply_preview_pose()
        render_views(args["renders"], framing=args.get("framing", "reference"))
        report["compare"] = str(compare_sheet(args["renders"]))
        clear_pose()
    print("REPORT " + json.dumps(report, ensure_ascii=False))


main()
