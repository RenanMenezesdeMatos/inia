"""Utilitários compartilhados do pipeline da INIA Mentora (Blender 5.2, modo background).

Todas as etapas (`NN_*.py`) seguem o mesmo contrato:

    blender -b --python tools/avatar/inia-realista-v02/NN_etapa.py -- in=<entrada.blend> out=<saida.blend> [renders=<prefixo>]

- Leem o .blend da etapa anterior (ou o GLB base na etapa 01) e gravam o próximo em `work/`.
- Nunca editam o GLB original: `frontend/public/models/inia-avatar-poc.glb` continua sendo a cópia
  recuperável do asset base ("Pixar style girl (rigging)", Black vizual, CC BY 4.0).
- Coordenadas (Blender, Z para cima): a personagem olha para −Y. O objeto armature tem +90° em X
  (herdado do glTF); as malhas são filhas dele com coordenadas locais Y-up. Para criar geometria nova,
  trabalhe em coordenadas de MUNDO e depois parente com `parent_to_rig(obj)`.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

REPO = Path(__file__).resolve().parents[4]
PIPELINE = REPO / "tools/avatar/inia-realista-v02"
BASE_GLB = REPO / "frontend/public/models/inia-avatar-poc.glb"
REFS = REPO / "assets/avatar/inia"
OUT_DIR = REPO / "assets/avatar/inia/realista-v02"
WORK = OUT_DIR / "work"
TEX_DIR = OUT_DIR / "textures"
FINAL_BLEND = OUT_DIR / "inia-mentora-v02.blend"
FINAL_GLB = REPO / "frontend/public/models/inia-mentora-v02.glb"
FFMPEG = "/opt/homebrew/bin/ffmpeg"

for directory in (WORK, TEX_DIR, WORK / "renders"):
    directory.mkdir(parents=True, exist_ok=True)

# Nomes estáveis depois da etapa 01 (o frontend depende deles).
RIG = "INIA_Rig"
BODY = "INIA_Body"
HEAD = "INIA_Head"
EYES = "INIA_Eyes"

REFERENCE_VIEWS = {
    # vista: (ângulo em graus em torno de Z, arquivo de referência)
    "front": (0.0, "ref_front_v01.png"),
    "threequarter": (-35.0, "ref_threequarter_v01.png"),  # a personagem gira para a direita dela (câmera à esquerda da tela)
    "profile": (90.0, "ref_profile_v01.png"),             # perfil olhando para a esquerda da imagem
    "back": (180.0, "ref_back_v01.png"),
}


def parse_args() -> dict[str, str]:
    if "--" not in sys.argv:
        return {}
    return dict(item.split("=", 1) for item in sys.argv[sys.argv.index("--") + 1:] if "=" in item)


def open_blend(path: str | Path) -> None:
    bpy.ops.wm.open_mainfile(filepath=str(path))


def save_blend(path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)


def obj(name: str) -> bpy.types.Object:
    found = bpy.data.objects.get(name)
    if found is None:
        raise KeyError(f"objeto ausente: {name}")
    return found


def rig() -> bpy.types.Object:
    return obj(RIG)


def bone_world_head(bone_name: str) -> Vector:
    armature = rig()
    return armature.matrix_world @ armature.data.bones[bone_name].head_local


def bone_world_tail(bone_name: str) -> Vector:
    armature = rig()
    return armature.matrix_world @ armature.data.bones[bone_name].tail_local


def world_vertices(ob: bpy.types.Object) -> list[Vector]:
    matrix = ob.matrix_world
    return [matrix @ vertex.co for vertex in ob.data.vertices]


def world_bbox(obs: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [p for ob in obs if ob.type == "MESH" for p in world_vertices(ob)]
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return lo, hi


def parent_to_rig(ob: bpy.types.Object, with_armature_modifier: bool = True) -> None:
    """Parenta um objeto criado em coordenadas de mundo ao rig, preservando a posição."""
    armature = rig()
    world = ob.matrix_world.copy()
    ob.parent = armature
    ob.parent_type = "OBJECT"
    ob.matrix_parent_inverse = armature.matrix_world.inverted()
    ob.matrix_world = world
    if with_armature_modifier and not any(m.type == "ARMATURE" for m in ob.modifiers):
        modifier = ob.modifiers.new("Armature", "ARMATURE")
        modifier.object = armature


def srgb_to_linear(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.removeprefix("#")
    rgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[srgb_to_linear(c) for c in rgb], alpha)


# ---------------------------------------------------------------------------
# Renderização para comparação com as referências
# ---------------------------------------------------------------------------

def _look_at(ob: bpy.types.Object, target: Vector) -> None:
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()


def _clear_render_helpers() -> None:
    for ob in list(bpy.data.objects):
        if ob.name.startswith("_render_"):
            bpy.data.objects.remove(ob, do_unlink=True)


def setup_studio(background: tuple[float, float, float] = (0.19, 0.19, 0.19), samples: int = 32) -> None:
    """Estúdio neutro parecido com o das referências: fundo cinza médio, luz principal suave e quente."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.eevee.taa_render_samples = samples
    except AttributeError:
        pass
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    background_node = scene.world.node_tree.nodes.get("Background")
    background_node.inputs[0].default_value = (*background, 1)
    background_node.inputs[1].default_value = 1.0


def _add_light(name: str, location: Vector, target: Vector, energy: float, size: float, color=(1, 1, 1)) -> None:
    data = bpy.data.lights.new(f"_render_{name}", type="AREA")
    data.energy = energy
    data.size = size
    data.color = color
    ob = bpy.data.objects.new(f"_render_{name}", data)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = location
    _look_at(ob, target)


def render_views(prefix: str, views: list[str] | None = None, framing: str = "reference", res: tuple[int, int] = (518, 760)) -> list[Path]:
    """Renderiza as vistas de referência. `framing`:
    - reference: do topo do cabelo até a cintura (como as imagens de referência)
    - head: rosto e cabelo
    - full: corpo inteiro
    """
    _clear_render_helpers()
    setup_studio()
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False

    meshes = [ob for ob in bpy.data.objects if ob.type == "MESH" and ob.visible_get()]
    lo, hi = world_bbox(meshes)
    head = bone_world_head("Head")
    if framing == "head":
        top, bottom = hi.z + 0.02, head.z - 0.08
    elif framing == "full":
        top, bottom = hi.z + 0.03, lo.z - 0.02
    else:
        top, bottom = hi.z + 0.03, bone_world_head("Hips").z - 0.06
    center = Vector((0.0, head.y, (top + bottom) / 2))
    height = top - bottom

    camera_data = bpy.data.cameras.new("_render_camera")
    camera_data.lens = 85
    camera_data.sensor_fit = "VERTICAL"
    camera_data.sensor_height = 24
    distance = (height / 2) / math.tan(math.atan(12 / 85)) * 1.02
    camera = bpy.data.objects.new("_render_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    written = []
    for view in views or list(REFERENCE_VIEWS):
        angle = math.radians(REFERENCE_VIEWS[view][0])
        direction = Vector((math.sin(angle), -math.cos(angle), 0))
        camera.location = center + direction * distance
        _look_at(camera, center)
        side = Vector((math.cos(angle), math.sin(angle), 0))
        for ob in list(bpy.data.objects):
            if ob.name.startswith("_render_") and ob.type == "LIGHT":
                bpy.data.objects.remove(ob, do_unlink=True)
        _add_light("key", center + direction * 2.2 - side * 1.6 + Vector((0, 0, 1.4)), center, 520, 2.4, (1.0, 0.95, 0.9))
        _add_light("fill", center + direction * 2.4 + side * 1.8 + Vector((0, 0, 0.3)), center, 220, 3.0, (0.95, 0.97, 1.0))
        _add_light("rim", center - direction * 2.0 + side * 0.8 + Vector((0, 0, 1.2)), center, 320, 1.6)
        path = WORK / "renders" / f"{prefix}_{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        written.append(path)
    _clear_render_helpers()
    return written


def compare_sheet(prefix: str, views: list[str] | None = None) -> Path:
    """Folha lado a lado: referência (em cima) × render (embaixo) para cada vista."""
    views = views or list(REFERENCE_VIEWS)
    inputs: list[str] = []
    for view in views:
        inputs += ["-i", str(REFS / REFERENCE_VIEWS[view][1])]
    for view in views:
        inputs += ["-i", str(WORK / "renders" / f"{prefix}_{view}.png")]
    count = len(views)
    scale = ";".join(f"[{i}:v]scale=518:760,setsar=1[v{i}]" for i in range(2 * count))
    top = "".join(f"[v{i}]" for i in range(count)) + f"hstack=inputs={count}[top]"
    bottom = "".join(f"[v{i}]" for i in range(count, 2 * count)) + f"hstack=inputs={count}[bottom]"
    out = WORK / "renders" / f"{prefix}_compare.png"
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", *inputs, "-filter_complex", f"{scale};{top};{bottom};[top][bottom]vstack=inputs=2", str(out)], check=True)
    return out


def write_report(path: str | Path, data: dict) -> None:
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False))


def apply_preview_pose(arms_down_deg: float = 45.0, elbow_deg: float = 12.0) -> None:
    """Pose de conferência (NÃO salva no arquivo): braços relaxados ao lado do corpo, como nas
    referências. A pose de repouso do rig é um A-pose com os braços 39° abaixo da horizontal; a
    pose idle real do avatar é aplicada no frontend (camada base do AnimationMixer)."""
    from mathutils import Quaternion

    armature = rig()

    def rotate_world(bone_name: str, axis: Vector, degrees: float) -> None:
        pose_bone = armature.pose.bones[bone_name]
        world = armature.matrix_world @ pose_bone.matrix
        pivot = world.to_translation()
        rotation = Quaternion(axis, math.radians(degrees)).to_matrix().to_4x4()
        from mathutils import Matrix
        new = Matrix.Translation(pivot) @ rotation @ Matrix.Translation(-pivot) @ world
        pose_bone.matrix = armature.matrix_world.inverted() @ new
        bpy.context.view_layer.update()

    rotate_world("LeftArm", Vector((0, 1, 0)), arms_down_deg)
    rotate_world("RightArm", Vector((0, 1, 0)), -arms_down_deg)
    rotate_world("LeftForeArm", Vector((1, 0, 0)), -elbow_deg)
    rotate_world("RightForeArm", Vector((1, 0, 0)), -elbow_deg)


def clear_pose() -> None:
    for pose_bone in rig().pose.bones:
        pose_bone.location = (0, 0, 0)
        pose_bone.rotation_quaternion = (1, 0, 0, 0)
        pose_bone.rotation_euler = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()
