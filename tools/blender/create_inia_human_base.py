"""Create a clean MPFB human base for the INIA character.

Run with Blender 5.2+ after installing MPFB 2.x. The generated file is kept
separate from the earlier procedural blockout so every stage is recoverable.
"""

import os
import bpy

ROOT = "/Users/renanmenezes/Developer/Works/inia"
OUTPUT = os.path.join(ROOT, "assets", "avatar", "inia", "inia_human_base_v03.blend")
PREVIEW = os.path.join(ROOT, "assets", "avatar", "inia", "inia_human_base_v03_preview.png")

bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# Phenotype inferred from the visual reference. These are non-destructive MPFB
# macro targets and can be refined later without remodeling the topology.
scene = bpy.context.scene
scene.MPFB_NH_add_phenotype = True
scene.MPFB_NH_phenotype_gender = "female"
scene.MPFB_NH_phenotype_race = "african"
scene.MPFB_NH_phenotype_age = "young"
scene.MPFB_NH_phenotype_muscle = "averagemuscle"
scene.MPFB_NH_phenotype_weight = "averageweight"
scene.MPFB_NH_phenotype_height = "average"
scene.MPFB_NH_phenotype_proportions = "min"
scene.MPFB_NH_phenotype_influence = 0.88

result = bpy.ops.mpfb.create_human()
if "FINISHED" not in result:
    raise RuntimeError(f"MPFB did not create the human base: {result}")

human_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not human_meshes:
    raise RuntimeError("MPFB returned successfully but no human mesh was found")

for obj in human_meshes:
    obj.name = "INIA_Human_Base"
    obj["inia_stage"] = "human_base_v03"
    obj["reference_image"] = os.path.join(ROOT, "frontend", "public", "INIA.png")
    obj.color = (0.28, 0.075, 0.026, 1.0)
    material = bpy.data.materials.new("INIA_Skin_Blockout")
    material.diffuse_color = (0.28, 0.075, 0.026, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.28, 0.075, 0.026, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.68
    obj.data.materials.append(material)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle()

scene["inia_next_step"] = "face_proportions_and_features"
scene["reference_image"] = os.path.join(ROOT, "frontend", "public", "INIA.png")

def aim(obj, point):
    from mathutils import Vector
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()

# Neutral comparison stage. The camera deliberately prioritizes head and torso.
camera_data = bpy.data.cameras.new("INIA_Review_Camera")
camera = bpy.data.objects.new("INIA_Review_Camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (0, -3.0, 1.42)
camera.data.lens = 72
aim(camera, (0, 0, 1.35))
scene.camera = camera

for name, location, energy, color, size in (
    ("INIA_Key", (-2.2, -2.2, 2.7), 700, (1.0, .72, .55), 2.2),
    ("INIA_Fill", (2.0, -1.4, 2.0), 520, (.47, .30, 1.0), 2.0),
    ("INIA_Rim", (0, 1.2, 2.6), 620, (.58, .20, 1.0), 1.8),
):
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy, light_data.color, light_data.shape, light_data.size = energy, color, "DISK", size
    light = bpy.data.objects.new(name, light_data)
    light.location = location
    aim(light, (0, 0, 1.35))
    scene.collection.objects.link(light)

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 700
scene.render.resolution_y = 700
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.world.color = (.012, .006, .02)
scene.render.filepath = PREVIEW
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
bpy.ops.render.render(write_still=True)
print("INIA_HUMAN_BASE_READY", OUTPUT, PREVIEW, len(human_meshes))
