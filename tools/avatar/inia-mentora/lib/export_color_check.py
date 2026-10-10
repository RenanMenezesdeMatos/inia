"""Etapa 08 — cor exibida × referências, na réplica da iluminação do app.

Renderiza máscaras de material (emissão com uma cor por material, mesmo enquadramento dos renders
"reference"), mede a mediana de cada grupo (`export_web_color.TARGETS`) nos renders do estúdio web e
compara com a mediana das mesmas regiões nas referências. Sugere novos ganhos para
`export_web_color.CALIBRATION` (L e C do OKLab escalam juntos com a luminância, daí o ajuste de gC).
DESTRUTIVO para os materiais da cena: rode por último.
"""
from __future__ import annotations

from pathlib import Path

import bpy
import numpy as np

import export_renders as ER
import export_web_color as WC
from common import WORK

GROUP_VIEWS = {g: ("front", "threequarter", "profile", "back") for g in ("hair_volume", "hair_curls")}
DEFAULT_VIEWS = ("front", "threequarter")


def _pixels(path: Path) -> np.ndarray:
    image = bpy.data.images.load(str(path), check_existing=False)
    width, height = image.size
    data = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    bpy.data.images.remove(image)
    return data.reshape(height, width, 4)[..., :3]


def _mask_studio(_studio: str) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 1
    scene.view_settings.view_transform = "Standard"
    scene.render.dither_intensity = 0.0
    scene.render.filter_size = 0.01
    world = bpy.data.worlds.new("_mask_world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)


def render_masks(prefix: str, views: list[str]) -> dict[str, float]:
    """Troca TODOS os materiais por emissão (um tom de vermelho por material). Devolve {material: r}."""
    names = sorted(m.name for m in bpy.data.materials if m.users)
    codes = {}
    for index, name in enumerate(names):
        mat = bpy.data.materials[name]
        tree = mat.node_tree
        tree.nodes.clear()
        out = tree.nodes.new("ShaderNodeOutputMaterial")
        emission = tree.nodes.new("ShaderNodeEmission")
        codes[name] = (index + 1) / (len(names) + 1)
        emission.inputs["Color"].default_value = (codes[name], 0.0, 0.0, 1.0)
        tree.links.new(emission.outputs[0], out.inputs[0])
        mat.surface_render_method = "DITHERED"
    original = ER._studio
    ER._studio = _mask_studio
    try:
        ER.render_reference(prefix, views, studio="mask")
    finally:
        ER._studio = original
    return codes


def _mask_ids(path: Path, codes: dict[str, float]) -> np.ndarray:
    rgb = _pixels(path)
    red = WC.srgb_to_linear(rgb[..., 0])  # "Standard" grava em sRGB
    ids = np.full(red.shape, -1)
    for index, value in enumerate(codes.values()):
        ids[(np.abs(red - value) < 0.01) & (rgb[..., 1] < 0.02)] = index
    eroded = ids.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            eroded[np.roll(np.roll(ids, dy, 0), dx, 1) != ids] = -1
    return eroded


def measure(render_prefix: str, mask_prefix: str, codes: dict[str, float]) -> dict:
    names = list(codes)
    views = sorted({v for vs in GROUP_VIEWS.values() for v in vs} | set(DEFAULT_VIEWS))
    ids = {v: _mask_ids(WORK / "renders" / f"{mask_prefix}_{v}.png", codes) for v in views}
    shots = {v: _pixels(WORK / "renders" / f"{render_prefix}_{v}.png") for v in views}
    report = {}
    for group, target in WC.TARGETS.items():
        entry = WC.CALIBRATION.get(group, {"materials": [], "gL": 1.0, "gC": 1.0, "dh": 0.0})
        index = [names.index(m) for m in entry["materials"] if m in names]
        pixels = np.concatenate([shots[v][np.isin(ids[v], index)] for v in GROUP_VIEWS.get(group, DEFAULT_VIEWS)])
        if len(pixels) == 0:
            continue
        median = np.median(pixels, axis=0)
        t_rgb = np.array([int(target[i:i + 2], 16) / 255 for i in (1, 3, 5)])
        L, C, h = (float(v) for v in WC.lch(WC.srgb_to_linear(median)))
        tL, tC, th = (float(v) for v in WC.lch(WC.srgb_to_linear(t_rgb)))
        ratio = tL / L
        dh = ((th - h + 180) % 360) - 180
        report[group] = {
            "pixels": int(len(pixels)),
            "displayed": "#%02x%02x%02x" % tuple((median * 255).round().astype(int)),
            "target": target,
            "delta_L": round(L - tL, 3),
            "delta_C": round(C - tC, 3),
            "delta_h": round(-dh, 1),
            "suggested": {"gL": round(entry["gL"] * ratio, 3), "gC": round(entry["gC"] * (tC / C) / ratio, 3),
                          "dh": round(entry["dh"] + dh, 1)},
        }
    return report
