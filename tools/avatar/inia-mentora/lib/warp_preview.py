"""Prévias da etapa 03: close-ups do rosto lado a lado com recortes das referências, na MESMA escala
(normalizada por U = olhos→queixo). Só para iteração visual; não altera o arquivo salvo.

Os recortes das referências usam marcos medidos à mão nas imagens (pixels da imagem original):
olho (centro entre as íris; no perfil, centro do globo), e U em pixels.
"""
from __future__ import annotations

import math
import subprocess

import bmesh
import bpy
from mathutils import Vector

from common import BODY, FFMPEG, REFS, REFERENCE_VIEWS, WORK, _add_light, _clear_render_helpers, setup_studio

# vista: (x_px do centro dos olhos, y_px da linha dos olhos, U em px)
REF_FACE = {"front": (310.0, 218.0, 120.0), "threequarter": (322.0, 220.0, 117.0), "profile": (187.0, 218.0, 115.0)}
BOX_U = (2.4, 2.8)      # largura × altura do recorte, em U
ABOVE_U = 1.3           # o recorte começa 1.3 U acima da linha dos olhos
TILE = (420, 490)


def hide_hair_faces() -> None:
    """Remove (só nesta sessão) as faces de cabelo do asset base para ver a forma da cabeça."""
    body = bpy.data.objects.get(BODY)
    if body is None:
        return
    mats = [i for i, m in enumerate(body.data.materials) if m and m.name == "hair_mat"]
    if not mats:
        return
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in mats], context="FACES")
    bm.to_mesh(body.data)
    bm.free()


def render_head_views(prefix: str, eye: Vector, U: float, views=("front", "threequarter", "profile"), samples: int = 16) -> list:
    _clear_render_helpers()
    setup_studio(samples=samples)
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = TILE
    cd = bpy.data.cameras.new("_render_cam_head")
    cd.type = "ORTHO"
    cd.sensor_fit = "VERTICAL"
    cd.ortho_scale = BOX_U[1] * U
    cam = bpy.data.objects.new("_render_cam_head", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    center = Vector((0.0, eye.y, eye.z + (ABOVE_U - BOX_U[1] / 2) * U))
    paths = []
    for view in views:
        ang = math.radians(REFERENCE_VIEWS[view][0])
        direction = Vector((math.sin(ang), -math.cos(ang), 0.0))
        side = Vector((math.cos(ang), math.sin(ang), 0.0))
        cam.location = center + direction * 1.5
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        for ob in list(bpy.data.objects):
            if ob.name.startswith("_render_") and ob.type == "LIGHT":
                bpy.data.objects.remove(ob, do_unlink=True)
        _add_light("key", center + direction * 2.2 - side * 1.6 + Vector((0, 0, 1.4)), center, 520, 2.4, (1.0, 0.95, 0.9))
        _add_light("fill", center + direction * 2.4 + side * 1.8 + Vector((0, 0, 0.3)), center, 220, 3.0, (0.95, 0.97, 1.0))
        _add_light("rim", center - direction * 2.0 + side * 0.8 + Vector((0, 0, 1.2)), center, 320, 1.6)
        path = WORK / "renders" / f"{prefix}_head_{view}.png"
        sc.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    _clear_render_helpers()
    return paths


def head_compare_sheet(prefix: str, views=("front", "threequarter", "profile"), extra_rows: list[str] | None = None) -> str:
    """Linha de cima: recortes das referências; linhas de baixo: renders `<prefixo>_head_<vista>.png`
    (a própria e, opcionalmente, outras linhas com prefixos em `extra_rows`, ex. o modelo base)."""
    rows = [prefix] + list(extra_rows or [])
    inputs, filters = [], []
    n = 0
    for view in views:
        cx, cy, u = REF_FACE[view]
        w, h = BOX_U[0] * u, BOX_U[1] * u
        x0, y0 = cx - w / 2, cy - ABOVE_U * u
        inputs += ["-i", str(REFS / REFERENCE_VIEWS[view][1])]
        filters.append(f"[{n}:v]crop={w:.0f}:{h:.0f}:{x0:.0f}:{y0:.0f},scale={TILE[0]}:{TILE[1]},setsar=1[r{n}]")
        n += 1
    labels = [f"[r{i}]" for i in range(len(views))]
    stacks = ["".join(labels) + f"hstack=inputs={len(views)}[row0]"]
    for k, row in enumerate(rows, start=1):
        names = []
        for view in views:
            inputs += ["-i", str(WORK / "renders" / f"{row}_head_{view}.png")]
            filters.append(f"[{n}:v]scale={TILE[0]}:{TILE[1]},setsar=1,format=rgb24[m{n}]")
            names.append(f"[m{n}]")
            n += 1
        stacks.append("".join(names) + f"hstack=inputs={len(views)}[row{k}]")
    graph = ";".join(filters + stacks) + ";" + "".join(f"[row{i}]" for i in range(len(rows) + 1)) + f"vstack=inputs={len(rows) + 1}"
    out = WORK / "renders" / f"{prefix}_head_compare.png"
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", *inputs, "-filter_complex", graph, str(out)], check=True)
    return str(out)


EXPRESSIONS = [
    ("neutral", {}),
    ("jawOpen07", {"jawOpen": 0.7}),
    ("smile_jaw", {"mouthSmileLeft": 0.7, "mouthSmileRight": 0.7, "jawOpen": 0.35}),
    ("jaw_close", {"jawOpen": 0.6, "mouthClose": 0.6}),
    ("funnel", {"mouthFunnel": 1.0}),
    ("pucker", {"mouthPucker": 1.0}),
    ("blink", {"eyeBlinkLeft": 1.0, "eyeBlinkRight": 1.0}),
]


def expression_sheet(prefix: str, eye: Vector, U: float, view: str = "threequarter") -> str:
    """Uma linha de close-ups (mesma câmera) com expressões ARKit, para ver a boca/pálpebras funcionando."""
    from common import EYES, HEAD
    names = []
    for name, values in EXPRESSIONS:
        for ob_name in (HEAD, EYES):
            keys = bpy.data.objects[ob_name].data.shape_keys
            for kb in keys.key_blocks[1:]:
                kb.value = values.get(kb.name, 0.0)
        render_head_views(f"{prefix}_x{name}", eye, U, views=(view,))
        names.append(str(WORK / "renders" / f"{prefix}_x{name}_head_{view}.png"))
    for ob_name in (HEAD, EYES):
        for kb in bpy.data.objects[ob_name].data.shape_keys.key_blocks[1:]:
            kb.value = 0.0
    out = WORK / "renders" / f"{prefix}_expressions.png"
    inputs = sum((["-i", n] for n in names), [])
    graph = "".join(f"[{i}:v]" for i in range(len(names))) + f"hstack=inputs={len(names)}"
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", *inputs, "-filter_complex", graph, str(out)], check=True)
    return str(out)
