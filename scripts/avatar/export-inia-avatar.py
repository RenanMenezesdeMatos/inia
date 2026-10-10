"""Export the locally licensed INIA source model to a web-ready GLB.

Run with Blender, not the system Python:
blender --background assets/avatar/inia/inia-avatar-source.blend \
  --python scripts/avatar/export-inia-avatar.py
"""

from pathlib import Path
from math import radians

import bpy


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT = PROJECT_ROOT / "frontend/public/models/inia-avatar.glb"


def is_exportable(obj: bpy.types.Object) -> bool:
    return obj.visible_get() and obj.type in {"MESH", "ARMATURE"}


def srgb_channel_to_linear(value: float) -> float:
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def srgb(hex_color: str) -> tuple[float, float, float, float]:
    value = hex_color.removeprefix("#")
    channels = [int(value[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    return (*[srgb_channel_to_linear(channel) for channel in channels], 1.0)


def make_material_web_safe(name: str, color: str, metallic: float = 0.0) -> None:
    material = bpy.data.materials.get(name)
    if material is None or material.node_tree is None:
        return

    principled = next(
        (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )
    if principled is None:
        return

    base_color = principled.inputs.get("Base Color")
    if base_color is not None:
        for link in list(base_color.links):
            material.node_tree.links.remove(link)
        base_color.default_value = srgb(color)

    roughness = principled.inputs.get("Roughness")
    if roughness is not None:
        roughness.default_value = 0.48
    metallic_input = principled.inputs.get("Metallic")
    if metallic_input is not None:
        metallic_input.default_value = metallic


def apply_conversation_pose() -> None:
    rig = bpy.data.objects.get("BlenderChan Rig_rig")
    if rig is None or rig.type != "ARMATURE":
        return

    # Bring both upper arms down and closer to the torso. The source file uses
    # Auto-Rig Pro FK controls, so posing the controllers keeps deformation sane.
    for side in ("l", "r"):
        upper_arm = rig.pose.bones.get(f"c_arm_fk.{side}")
        if upper_arm is not None:
            upper_arm.rotation_mode = "XYZ"
            upper_arm.rotation_euler.x = radians(-29)

        forearm = rig.pose.bones.get(f"c_forearm_fk.{side}")
        if forearm is not None:
            forearm.rotation_mode = "XYZ"
            forearm.rotation_euler.y = radians(4 if side == "l" else -4)

    bpy.context.view_layer.update()


OUTPUT.parent.mkdir(parents=True, exist_ok=True)

apply_conversation_pose()

# Convert the visible costume to predictable glTF/PBR materials. Skin, face,
# eyes and hair retain the source textures and vertex colors.
for material_name in (
    "Cloth Shiny",
    "Cloth Shiny Blendress Blue",
    "Cloth Shiny Blendress Orange",
    "Cloth Dull",
):
    make_material_web_safe(material_name, "#660099")
make_material_web_safe("Glasses", "#3B1458", metallic=0.12)
make_material_web_safe("Metal Gold", "#D5A928", metallic=0.72)

bpy.ops.object.select_all(action="DESELECT")
exported = []
for obj in bpy.context.scene.objects:
    if not is_exportable(obj):
        continue
    obj.select_set(True)
    exported.append(obj.name)

bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT),
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_animations=False,
    export_morph=True,
    export_morph_normal=True,
    export_skins=True,
    export_yup=True,
    export_materials="EXPORT",
)

print(f"INIA avatar exported to {OUTPUT}")
print(f"Exported {len(exported)} objects")
