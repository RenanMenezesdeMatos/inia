"""Diagnóstico da etapa 05: sobreposição da silhueta do cabelo × imagens de referência.

    blender -b --python tools/avatar/inia-mentora/lib/hair_diag.py -- in=<arquivo.blend> prefix=<nome>

Renderiza (Workbench, câmera ortográfica) frente, perfil e costas na MESMA escala e no mesmo
alinhamento das referências — 1 U (olhos→queixo) = 117 px, centro dos olhos no pixel medido em
`hair_refshape` — e grava `work/renders/<prefix>_diag.png`: em cima a referência com o contorno do
render (ciano), embaixo o render (cabelo vermelho, cabeça bege, corpo azul) com o contorno da
referência (amarelo). Só diagnóstico: não altera o .blend.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hair_volume as hv  # noqa: E402
from common import BODY, EYES, HEAD, REFS, WORK, clear_pose, open_blend, parse_args  # noqa: E402

W, H = 518, 758
# vista: (arquivo, px por U, pixel (x, y) da âncora, âncora, direção da câmera)
VIEWS = {
    "front": ("ref_front_v01.png", 117.0, (311.0, 220.0), "eye", (0.0, 1.0, 0.0)),
    "profile": ("ref_profile_v01.png", 116.0, (104.0, 217.0), "nose", (-1.0, 0.0, 0.0)),
    "back": ("ref_back_v01.png", 117.0 / 1.05, (None, 379.0 + (220.0 - 379.0) / 1.05), "eye", (0.0, -1.0, 0.0)),
}
COLORS = {"hair": (0.9, 0.02, 0.02), "head": (0.9, 0.75, 0.6), "body": (0.3, 0.4, 0.8)}


def _load_pixels(path: Path) -> np.ndarray:
    img = bpy.data.images.load(str(path), check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]
    bpy.data.images.remove(img)
    return px


def _mask_ref(px: np.ndarray) -> np.ndarray:
    corners = np.concatenate([px[:20, :20, :3].reshape(-1, 3), px[:20, -20:, :3].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    dist = np.linalg.norm(px[..., :3] - bg, axis=-1)
    return dist > 0.06


def _outline(mask: np.ndarray) -> np.ndarray:
    m = mask
    edge = np.zeros_like(m)
    edge[1:-1, 1:-1] = m[1:-1, 1:-1] & ~(m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:])
    thick = edge.copy()
    thick[1:] |= edge[:-1]
    thick[:, 1:] |= edge[:, :-1]
    return thick


def _setup_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "OBJECT"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        if ob.name.startswith("INIA_Hair"):
            ob.color = (*COLORS["hair"], 1)
        elif ob.name in (HEAD, EYES):
            ob.color = (*COLORS["head"], 1)
        else:
            ob.color = (*COLORS["body"], 1)


def _render_view(view: str, lm: dict, back_center_px: float | None) -> np.ndarray:
    _, px_per_u, (ax, ay), anchor, direction = VIEWS[view]
    u = lm["U"]
    scale = u / px_per_u                      # metros por pixel
    d = Vector(direction)
    if anchor == "eye":
        a = Vector(lm["eye"])
    else:
        a = Vector((0.0, lm["nose_y"], lm["eye_z"]))
    if ax is None:
        ax = back_center_px
    up = Vector((0, 0, 1))
    right = d.cross(up)          # direita da imagem = forward × up
    # centro da imagem em mundo
    center = a + right * ((W / 2 - ax) * scale) + up * ((ay - H / 2) * scale)
    cam_data = bpy.data.cameras.new("_diag_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(W, H) * scale
    cam = bpy.data.objects.new("_diag_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center - d * 3.0
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    path = WORK / "renders" / f"_diag_{view}.png"
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    return _load_pixels(path)


def main() -> None:
    args = parse_args()
    open_blend(args["in"])
    clear_pose()
    lm = hv.measure_landmarks()
    _setup_scene()
    back_ref = _load_pixels(REFS / VIEWS["back"][0])
    back_mask = _mask_ref(back_ref)
    rows = back_mask[100:300]
    cols = np.nonzero(rows.any(0))[0]
    back_center = 0.5 * (cols.min() + cols.max()) if len(cols) else W / 2
    tops, bottoms = [], []
    for view in VIEWS:
        ref = _load_pixels(REFS / VIEWS[view][0])[:H, :W]
        rmask = _mask_ref(ref)
        render = _render_view(view, lm, back_center)
        alpha = render[..., 3] > 0.5
        hair = alpha & (render[..., 0] > 0.6) & (render[..., 1] < 0.3)
        top = ref[..., :3].copy()
        top[_outline(alpha)] = (0.0, 1.0, 1.0)
        top[_outline(hair)] = (0.0, 1.0, 0.3)
        bottom = np.where(alpha[..., None], render[..., :3], 0.35)
        bottom[_outline(rmask)] = (1.0, 1.0, 0.0)
        tops.append(top)
        bottoms.append(bottom)
    sheet = np.concatenate([np.concatenate(tops, 1), np.concatenate(bottoms, 1)], 0)
    h, w = sheet.shape[:2]
    out = bpy.data.images.new("_diag_sheet", w, h, alpha=True)
    rgba = np.concatenate([sheet, np.ones((h, w, 1), dtype=np.float32)], -1)[::-1]
    out.pixels.foreach_set(rgba.ravel())
    path = WORK / "renders" / f"{args.get('prefix', '05_hair')}_diag.png"
    out.filepath_raw = str(path)
    out.file_format = "PNG"
    out.save()
    print("DIAG", path)


main()
