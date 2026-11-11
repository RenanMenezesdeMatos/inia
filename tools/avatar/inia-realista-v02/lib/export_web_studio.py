"""Etapas 07/08 — réplica no Blender da iluminação do app (visualizador three.js).

`frontend/src/lib/avatar/animation/studio-lighting.ts`: HemisphereLight(#fbf6f2 / #6b5a7c, 0,6),
4 DirectionalLight SEM sombra (key #fff0e4 2,2 · fill #e2dcff 0,55 · rim #d3c4ff 1,4 · rim #ffd8c0 0,9),
RoomEnvironment pré-filtrado com intensidade 0,42 e tone mapping Khronos PBR Neutral, exposição 1.

Equivalências (three.js ≥ r155, luzes físicas; Blender, radiância de cena):
- DirectionalLight intensidade I ≡ Sun strength I (os dois dão albedo·I·cosθ/π).
- HemisphereLight I, cores g/s: radiância difusa albedo·I/π·mix(g, s, ½ + ½·n.y). Um mundo com
  L(ω) = I/π·[(g+s)/2 + ¾·(s−g)·ω_z] dá a mesma irradiância (harmônico de 1ª ordem).
- RoomEnvironment: radiância difusa medida no navegador (plano branco, roughness 1, sem tone mapping)
  por direção, ajustada como a + b·ω — ver `ENV_DIFFUSE`.
- Coordenadas: three (x, y, z) → Blender (x, −z, y). A personagem olha para +Z no three (−Y aqui).
"""
from __future__ import annotations

import bpy
from mathutils import Vector

from common import hex_to_linear_rgba

HEMI = {"sky": "#fbf6f2", "ground": "#6b5a7c", "intensity": 0.6}
# (cor, intensidade, posição no three) — a posição é só a direção (alvo na origem).
SUNS = {
    "key": ("#fff0e4", 2.2, (-2.1, 2.0, 3.2)),
    "fill": ("#e2dcff", 0.55, (2.8, 0.8, 2.4)),
    "rim_left": ("#d3c4ff", 1.4, (-2.4, 2.2, -2.6)),
    "rim_right": ("#ffd8c0", 0.9, (2.4, 1.6, -2.4)),
}
ENV_INTENSITY = 0.42
# Radiância difusa do RoomEnvironment (intensidade 1) medida no three.js por normal:
# +Z(frente) 1,88 · −Z 0,70 · +Y(cima) 1,61 · −Y 0,61 · +X 1,00 · −X 0,80  →  a + b·ω (irradiância
# de um mundo L = a + b·ω vale π·(a + ⅔·b·n)).
ENV_DIFFUSE = {"a": 1.10, "front": 0.885, "up": 0.75, "x": 0.15}
BACKGROUND = "#8a8a8a"  # sai ≈ #7f7f7f depois do PBR Neutral (cinza das referências)


def three_to_blender(v) -> Vector:
    x, y, z = v
    return Vector((x, -z, y))


def _world() -> None:
    scene = bpy.context.scene
    world = bpy.data.worlds.new("_web_world")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    coords = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coords.outputs["Generated"], sep.inputs[0])

    def math(op, a, b=None):
        node = nt.nodes.new("ShaderNodeMath")
        node.operation = op
        for index, value in enumerate((a, b)):
            if value is None:
                continue
            if isinstance(value, (int, float)):
                node.inputs[index].default_value = value
            else:
                nt.links.new(value, node.inputs[index])
        return node.outputs[0]

    # ambiente (cinza): k·(a + bx·x + bfront·(−y) + bup·z)
    e = ENV_DIFFUSE
    env = math("ADD", math("MULTIPLY", sep.outputs["X"], e["x"]), e["a"])
    env = math("ADD", env, math("MULTIPLY", sep.outputs["Y"], -e["front"]))
    env = math("ADD", env, math("MULTIPLY", sep.outputs["Z"], e["up"]))
    env = math("MULTIPLY", env, ENV_INTENSITY)
    # hemisfério (colorido): I/π·mix(g, s, ½ + ¾·z)
    fac = math("ADD", math("MULTIPLY", sep.outputs["Z"], 0.75), 0.5)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.clamp_factor = True
    sockets = {s.identifier: s for s in mix.inputs}
    nt.links.new(fac, sockets["Factor_Float"])
    sockets["A_Color"].default_value = hex_to_linear_rgba(HEMI["ground"])
    sockets["B_Color"].default_value = hex_to_linear_rgba(HEMI["sky"])
    hemi = nt.nodes.new("ShaderNodeVectorMath")
    hemi.operation = "SCALE"
    nt.links.new(next(s for s in mix.outputs if s.identifier == "Result_Color"), hemi.inputs[0])
    hemi.inputs["Scale"].default_value = HEMI["intensity"] / 3.141592653589793
    total = nt.nodes.new("ShaderNodeVectorMath")
    total.operation = "ADD"
    nt.links.new(hemi.outputs[0], total.inputs[0])
    gray = nt.nodes.new("ShaderNodeCombineXYZ")
    for axis in "XYZ":
        nt.links.new(env, gray.inputs[axis])
    nt.links.new(gray.outputs[0], total.inputs[1])
    # a câmera vê um fundo liso (como o app), a iluminação vem do termo acima
    light_path = nt.nodes.new("ShaderNodeLightPath")
    bg_light = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(total.outputs[0], bg_light.inputs["Color"])
    bg_camera = nt.nodes.new("ShaderNodeBackground")
    bg_camera.inputs["Color"].default_value = hex_to_linear_rgba(BACKGROUND)
    switch = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(light_path.outputs["Is Camera Ray"], switch.inputs[0])
    nt.links.new(bg_light.outputs[0], switch.inputs[1])
    nt.links.new(bg_camera.outputs[0], switch.inputs[2])
    nt.links.new(switch.outputs[0], out.inputs["Surface"])


def setup_web_studio(samples: int = 32) -> None:
    """Cena com as luzes do app, sem sombras, e view transform Khronos PBR Neutral."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = samples
    scene.view_settings.view_transform = "Khronos PBR Neutral"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    for ob in list(bpy.data.objects):
        if ob.name.startswith("_web_"):
            bpy.data.objects.remove(ob, do_unlink=True)
    _world()
    for name, (color, strength, position) in SUNS.items():
        data = bpy.data.lights.new(f"_web_{name}", type="SUN")
        data.energy = strength
        data.color = hex_to_linear_rgba(color)[:3]
        data.use_shadow = False
        data.angle = 0.0
        ob = bpy.data.objects.new(f"_web_{name}", data)
        scene.collection.objects.link(ob)
        direction = three_to_blender(position).normalized()
        ob.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
