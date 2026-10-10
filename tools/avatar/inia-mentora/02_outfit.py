"""Etapa 02 — roupa da INIA Mentora (polo roxa, logos "vivo", broche INIA/MENTORA, calça escura e cinto).

    blender -b --python tools/avatar/inia-mentora/02_outfit.py -- in=assets/avatar/inia/mentora/work/01_base.blend \
        out=assets/avatar/inia/mentora/work/02_outfit.blend [renders=02_outfit] [until=body|polo]

O que faz (sempre a partir do .blend de entrada; falha se algo esperado não existir):
1. INIA_Body: guarda as normais do GLB; cria a pele dos braços (tubo soldado ao anel aberto do antebraço,
   pesos interpolados da manga da jaqueta, UV no retângulo uniforme de pele); apaga rabo de cavalo
   (hair_mat), jaqueta, top e golas da jaqueta (jacket_mat), botão e passadores da calça (ficam sob o cinto).
2. INIA_Polo (M_Polo / M_PoloRib / M_PoloButton): derivada da casca externa da jaqueta (já com pesos):
   manga curta com barra canelada dobrada, frente fechada com decote em V curto, barra prolongada até
   dentro do cinto, folga/busto/caimento e colisão com o corpo; gola polo (pé + colarinho com pontas),
   carcela com 3 botões; UV com densidade uniforme (piquet tileável).
3. INIA_Logos (M_Logo, alpha MASK): "vivo" no peito direito (horizontal) e nas duas mangas (empilhado).
4. INIA_Badge (M_Badge): broche redondo no peito esquerdo.
5. Calça: pants_mat → M_Pants (grafite); INIA_Belt (M_Belt, M_Buckle) com fivela.
Texturas procedurais em textures/ (polo_*, logo_*, badge_*, belt_*). Imprime um relatório JSON no fim.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import bmesh
import bpy
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from common import BODY, HEAD, RIG, WORK, compare_sheet, clear_pose, apply_preview_pose, obj, open_blend, parse_args, render_views, save_blend  # noqa: E402
import outfit_arms as arms  # noqa: E402
import outfit_body as body_ops  # noqa: E402
import outfit_build as build  # noqa: E402
from outfit_util import remove_object, world_bmesh  # noqa: E402

args = parse_args()
src = Path(args.get("in", WORK / "01_base.blend"))
dst = Path(args.get("out", WORK / "02_outfit.blend"))
until = args.get("until", "all")
t0 = time.time()
report: dict = {"stage": "02_outfit", "in": str(src), "out": str(dst)}

open_blend(src)
for name in (BODY, RIG, HEAD, "INIA_Eyes"):
    obj(name)
for leftover in ("INIA_Polo", "INIA_Logos", "INIA_Badge", "INIA_Belt"):
    if bpy.data.objects.get(leftover) is not None:
        raise RuntimeError(f"{leftover} já existe na entrada — rode a etapa 02 sobre a saída da 01")
clear_pose()

# ---------------------------------------------------------------------------
# 1. INIA_Body
# ---------------------------------------------------------------------------
body = obj(BODY)
me = body.data
mats = {k: body_ops.material_slot(body, n) for k, n in (("skin", "girl_mat"), ("jacket", "jacket_mat"), ("pants", "pants_mat"), ("hair", "hair_mat"))}
body_ops.store_corner_normals(me)
mw = body.matrix_world.copy()
bm = bmesh.new()
bm.from_mesh(me)
bm.transform(mw)
bm.normal_update()
bm.faces.ensure_lookup_table()
bm.verts.ensure_lookup_table()
sources = body_ops.find_sources(bm, mats)
deform = bm.verts.layers.deform.verify()
uv_layer = bm.loops.layers.uv.active
vg_names = [vg.name for vg in body.vertex_groups]

# Cópias (mundo, com pesos) usadas pela polo antes de apagar a jaqueta
jacket_bm = body_ops.subset_bmesh(bm, sources["jacket"])
tank_chest_bm = body_ops.subset_bmesh(bm, sources["tank"] + sources["chest"])
waist_bm = body_ops.subset_bmesh(bm, sources["tank"] + sources["pants"])
pants_bm = body_ops.subset_bmesh(bm, sources["pants"])
cloth_src_bm = body_ops.subset_bmesh(bm, sources["jacket"] + sources["tank"])

# Pele dos braços (pesos pela manga da jaqueta)
sleeve_tree = BVHTree.FromBMesh(cloth_src_bm)
cloth_deform = cloth_src_bm.verts.layers.deform.verify()
weld_positions: set = set()
arm_faces = []
for side in ("Left", "Right"):
    new_verts, ring_verts, faces = arms.build_arm(bm, mats["skin"], side, build.P["sleeve_len"], uv_layer, report)
    arms.interpolate_weights_from(bm, new_verts, cloth_src_bm, sleeve_tree, deform, cloth_deform)
    weld_positions |= {(round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)) for v in ring_verts}
    arm_faces += faces
bm.faces.index_update()
skin_bm = body_ops.subset_bmesh(bm, arm_faces + sources["chest"])

# Remoções: rabo de cavalo, jaqueta inteira (principal, top e golas), botão e passadores da calça
drop = [f for f in bm.faces if f.material_index in (mats["hair"], mats["jacket"])]
drop += sources["pants_button"][0] + [f for isl in sources["belt_loops"] for f in isl]
bmesh.ops.delete(bm, geom=list(set(drop)), context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.transform(mw.inverted())
bm.to_mesh(me)
bm.free()
me.update()
body_ops.restore_corner_normals(me, weld_positions, mw)
body_ops.remove_material_slots(body, ["hair_mat", "jacket_mat"])
body_ops.recolor_pants(me.materials[body_ops.material_slot(body, "pants_mat")])
report["body"] = {"verts": len(me.vertices), "tris": sum(len(p.vertices) - 2 for p in me.polygons), "materials": [m.name for m in me.materials]}

if until == "body":
    save_blend(dst)
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(0)

# ---------------------------------------------------------------------------
# 2. INIA_Polo
# ---------------------------------------------------------------------------
head_bm = world_bmesh(obj(HEAD))
collide_bm = skin_bm.copy()
for extra in (head_bm, pants_bm):
    tmp = bpy.data.meshes.new("_tmp")
    extra.to_mesh(tmp)
    collide_bm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
collide_bm.normal_update()
trees = {"tank_chest": BVHTree.FromBMesh(tank_chest_bm), "waist": BVHTree.FromBMesh(waist_bm), "body": BVHTree.FromBMesh(collide_bm)}
skin_head = skin_bm.copy()
tmp = bpy.data.meshes.new("_tmp")
head_bm.to_mesh(tmp)
skin_head.from_mesh(tmp)
bpy.data.meshes.remove(tmp)
skin_tree = BVHTree.FromBMesh(skin_head)

polo_mats = build.polo_materials()
build.build_polo_shell(jacket_bm, trees, waist_bm, report)
part = jacket_bm.faces.layers.int.new(build.PART_ATTR)
for f in jacket_bm.faces:
    f[part] = 1  # corpo da polo (faces novas da gola/carcela/botões ficam 0)
build.add_collar_placket(jacket_bm, skin_tree, report)
polo = build.polo_object(jacket_bm, vg_names, polo_mats)
report["polo"] = {"tris": sum(len(p.vertices) - 2 for p in polo.data.polygons), "verts": len(polo.data.vertices), "uv": polo["uv_report"],
                  "groups": len(polo.vertex_groups)}
for b in (jacket_bm, tank_chest_bm, waist_bm, cloth_src_bm, collide_bm, skin_head, head_bm):
    b.free()

if until == "polo":
    save_blend(dst)
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(0)

# ---------------------------------------------------------------------------
# 3–5. Logos, broche e cinto
# ---------------------------------------------------------------------------
import outfit_accessories as acc  # noqa: E402

acc.build_logos(polo, report)
acc.build_badge(polo, report)
acc.build_belt(body, polo, pants_bm, report)
pants_bm.free()
skin_bm.free()
for attr in (build.PART_ATTR, body_ops.KEEP_N):
    if polo.data.attributes.get(attr) is not None:
        polo.data.attributes.remove(polo.data.attributes[attr])
for img in [i for i in bpy.data.images if i.name.startswith("jacket_")]:
    bpy.data.images.remove(img)  # texturas da jaqueta removida

save_blend(dst)
report["seconds"] = round(time.time() - t0, 1)
print(json.dumps(report, ensure_ascii=False))

prefix = args.get("renders")
if prefix:
    apply_preview_pose()
    bpy.context.scene.eevee.taa_render_samples = 16
    render_views(prefix)
    print("compare:", compare_sheet(prefix))
