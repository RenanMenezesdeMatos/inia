"""Etapa 04 — pele, maquiagem estilizada e olhos (texturas + materiais).

    blender -b --python tools/avatar/inia-realista-v02/04_skin_eyes.py -- in=<entrada.blend> out=<saida.blend> [renders=<prefixo>]

Entrada: qualquer .blend do pipeline que ainda tenha a pele do asset base (`girl_mat` ou, se já
passou por aqui, `M_Skin`), a córnea (`glass_eye_mat`/`M_Cornea`) e os objetos INIA_Head/INIA_Eyes.
Funciona sobre `01_base.blend` e sobre `03_proportions.blend` (pele nova dos braços mapeada no
retângulo uniforme do colo, u 0.69–1.0 × v 0.02–0.27).

O que faz (sempre a partir do atlas PRISTINO embutido no GLB base, então é idempotente):
1. Rasteriza no espaço UV todas as faces que usam a pele (rótulo por ilha + posição/normal de mundo).
2. Pinta o atlas `skin_basecolor.png` (2048², sRGB): pele marrom quente por transferência de razão
   (preserva o sombreamento original), pescoço→colo contínuo e retângulo uniforme, sobrancelhas novas,
   delineado, blush, lábios, íris castanha, esclera quente e interior da boca escurecido para o
   three.js (sem oclusão ambiente).
3. Gera `skin_metal_rough.png` (canal G = rugosidade, B = metálico = 0) no formato do glTF.
4. Córnea: UVs regeradas pela geometria + `eye_cornea.png` (alfa radial, alto sobre a íris).
5. Renomeia `girl_mat` → `M_Skin` e `glass_eye_mat` → `M_Cornea` e reconstrói os nós como Principled
   BSDF + Image Texture (o exportador glTF entende tudo).

As texturas vão para `assets/avatar/inia/realista-v02/textures/` (fonte versionável); o .blend as referencia
por caminho relativo. Imprime um relatório JSON curto no fim.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from common import EYES, HEAD, TEX_DIR, WORK, apply_preview_pose, clear_pose, compare_sheet, obj, parse_args, render_views, save_blend  # noqa: E402
import skin_atlas as A  # noqa: E402
import skin_eyes as E  # noqa: E402
import skin_paint as P  # noqa: E402
import v02_skin as V2  # noqa: E402
from skin_png import write_png  # noqa: E402

SKIN_NAMES = ("M_Skin", "girl_mat")
CORNEA_NAMES = ("M_Cornea", "glass_eye_mat")
TEX_COLOR = TEX_DIR / "skin_basecolor.png"
TEX_MR = TEX_DIR / "skin_metal_rough.png"
TEX_CORNEA = TEX_DIR / "eye_cornea.png"
TEX_NORMAL = TEX_DIR / "skin_normal.png"   # v02
SKIN_NORMAL_STRENGTH = 0.5
SKIN_SPECULAR_LEVEL = 0.10


def find_material(names: tuple[str, ...]) -> bpy.types.Material:
    for name in names:
        material = bpy.data.materials.get(name)
        if material is not None:
            return material
    raise KeyError(f"material ausente: {' / '.join(names)}")


def load_image(path: Path, name: str, colorspace: str) -> bpy.types.Image:
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    image = bpy.data.images.load(str(path), check_existing=False)
    image.name = name
    image.colorspace_settings.name = colorspace
    image.alpha_mode = "CHANNEL_PACKED" if colorspace == "Non-Color" else "STRAIGHT"
    try:
        image.filepath = bpy.path.relpath(str(path))
    except ValueError:
        pass
    return image


def rebuild_nodes(material: bpy.types.Material) -> tuple[bpy.types.NodeTree, bpy.types.Node]:
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (400, 0)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return tree, bsdf


def setup_skin(material: bpy.types.Material, color: bpy.types.Image, metal_rough: bpy.types.Image, skin_hex: str,
               normal: bpy.types.Image | None = None) -> None:
    material.name = "M_Skin"
    tree, bsdf = rebuild_nodes(material)
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.name = tex.label = "BASE COLOR"
    tex.image = color
    tex.location = (-400, 150)
    mr = tree.nodes.new("ShaderNodeTexImage")
    mr.name = mr.label = "METALLIC ROUGHNESS"
    mr.image = metal_rough
    mr.location = (-400, -150)
    sep = tree.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-120, -150)
    tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(mr.outputs["Color"], sep.inputs["Color"])
    tree.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    tree.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    if normal is not None:  # v02: relevo de poros e vincos
        nt = tree.nodes.new("ShaderNodeTexImage")
        nt.name = nt.label = "NORMAL"
        nt.image = normal
        nt.location = (-400, -450)
        nm = tree.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = SKIN_NORMAL_STRENGTH
        nm.location = (-120, -450)
        tree.links.new(nt.outputs["Color"], nm.inputs["Color"])
        tree.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["IOR"].default_value = 1.45
    # Especular dielétrico mais baixo que o padrão (0,5): sobre um albedo escuro e saturado o F0 de 4 %
    # vira um véu acinzentado (sobrancelha cinza, pele rosada). Exporta como KHR_materials_specular.
    bsdf.inputs["Specular IOR Level"].default_value = SKIN_SPECULAR_LEVEL
    material.surface_render_method = "DITHERED"
    material.use_backface_culling = False
    material.diffuse_color = (*P.hex_lin(skin_hex), 1.0)


def setup_cornea(material: bpy.types.Material, image: bpy.types.Image) -> None:
    material.name = "M_Cornea"
    tree, bsdf = rebuild_nodes(material)
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.name = tex.label = "BASE COLOR"
    tex.image = image
    tex.location = (-400, 0)
    tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.05
    bsdf.inputs["IOR"].default_value = 1.376  # córnea humana
    bsdf.inputs["Specular IOR Level"].default_value = 0.5
    material.surface_render_method = "BLENDED"
    material.use_backface_culling = True
    try:
        material.use_transparency_overlap = False
    except AttributeError:
        pass
    material.diffuse_color = (0.0, 0.0, 0.0, 0.2)


def main() -> None:
    args = parse_args()
    if "in" not in args or "out" not in args:
        raise SystemExit("uso: -- in=<entrada.blend> out=<saida.blend> [renders=<prefixo>] [params=<json>]")
    t0 = time.time()
    bpy.ops.wm.open_mainfile(filepath=str(Path(args["in"]).resolve()))
    obj(HEAD)
    eyes = obj(EYES)
    skin = find_material(SKIN_NAMES)
    cornea = find_material(CORNEA_NAMES)
    params = P.Params()
    if args.get("params"):  # iteração: sobrescreve campos de Params (JSON {campo: valor})
        for key, value in json.loads(Path(args["params"]).read_text()).items():
            if not hasattr(params, key):
                raise KeyError(f"parâmetro desconhecido: {key}")
            setattr(params, key, tuple(value) if isinstance(value, list) else value)

    src = A.load_source_image("girl_color")
    maps = A.rasterize(skin, src.shape[:2])
    geometry = E.eyeball_geometry(eyes, skin)
    debug = {} if args.get("debug") == "1" else None
    extras: dict = {}
    color, metal_rough, paint_report = P.build(src, maps, geometry["center"], geometry["radius"], params, debug=debug, extras=extras)
    color, metal_rough, normal, paint_report["v02_skin"] = V2.enhance(color, metal_rough, maps, extras,
                                                                      strength=float(args.get("skin_detail", "1")))
    if debug is not None:
        np.savez_compressed(WORK / "04_debug.npz", **debug)
    iris_deg = E.iris_angle_deg(maps, geometry["center"], params.iris_radius_px)
    cornea_report = E.regenerate_cornea_uvs(eyes, cornea, geometry)
    cornea_rgba = E.cornea_texture(iris_deg)

    write_png(TEX_COLOR, color)
    write_png(TEX_MR, metal_rough)
    write_png(TEX_CORNEA, cornea_rgba)
    write_png(TEX_NORMAL, normal)

    old_images = {n.image.name for m in (skin, cornea) if m.node_tree for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}
    setup_skin(skin, load_image(TEX_COLOR, "skin_basecolor", "sRGB"), load_image(TEX_MR, "skin_metal_rough", "Non-Color"), params.skin,
               load_image(TEX_NORMAL, "skin_normal", "Non-Color"))
    setup_cornea(cornea, load_image(TEX_CORNEA, "eye_cornea", "sRGB"))
    for name in old_images - {"skin_basecolor", "skin_metal_rough", "eye_cornea", "skin_normal"}:
        image = bpy.data.images.get(name)
        if image is not None and image.users == 0:
            bpy.data.images.remove(image)

    out = Path(args["out"]).resolve()
    save_blend(out)
    report = {
        "stage": "04_skin_eyes",
        "in": str(Path(args["in"]).resolve()),
        "out": str(out),
        "materials": {"skin": skin.name, "cornea": cornea.name},
        "skin_objects": maps.objects,
        "texels": {k: v for k, v in maps.counts.items() if v},
        "eye": {"center": [round(float(v), 4) for v in geometry["center"]], "radius": round(geometry["radius"], 4),
                "asymmetry_mm": round(geometry["asymmetry_mm"], 2), "iris_deg": round(iris_deg, 1), **cornea_report},
        "paint": paint_report,
        "textures": [str(p.relative_to(TEX_DIR.parents[3])) for p in (TEX_COLOR, TEX_MR, TEX_CORNEA)],
        "seconds": round(time.time() - t0, 1),
    }
    prefix = args.get("renders")
    if prefix:
        import skin_preview as R
        if args.get("compare", "1") == "1":
            apply_preview_pose()
            render_views(prefix)
            report["compare_sheet"] = str(compare_sheet(prefix))
            clear_pose()
        R.hide_hair_faces()
        sheet, samples = R.render_head(prefix, args.get("views", "front,threequarter,profile,jaw").split(","))
        report["render_samples"] = samples
        report["head_sheet"] = str(sheet)
    print("REPORT " + json.dumps(report, ensure_ascii=False))


main()
