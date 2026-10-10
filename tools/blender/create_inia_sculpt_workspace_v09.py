"""Create a clean, reference-driven Blender sculpt workspace for INIA."""

import math
import os
import bpy
from mathutils import Vector

ROOT = "/Users/renanmenezes/Developer/Works/inia"
ASSETS = os.path.join(ROOT, "assets/avatar/inia")
OUTPUT = os.path.join(ASSETS, "inia_sculpt_workspace_v09.blend")
PREVIEW = os.path.join(ASSETS, "inia_sculpt_workspace_v09_preview.png")


def mat(name, rgba, roughness=.55):
    m = bpy.data.materials.new(name)
    m.diffuse_color = rgba
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    return m


def sphere(name, loc, scale, material, segments=64, rings=40):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def join_remesh(objects, name, voxel=.0032):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    modifier = result.modifiers.new(name + "_Voxel", "REMESH")
    modifier.mode = "VOXEL"
    modifier.voxel_size = voxel
    modifier.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.shade_smooth()
    return result


def reference_empty(name, image_path, location, rotation, scale):
    image = bpy.data.images.load(image_path, check_existing=True)
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "IMAGE"
    obj.data = image
    obj.location = location
    obj.rotation_euler = rotation
    obj.scale = (scale, scale, scale)
    obj.color[3] = .42
    obj.empty_image_depth = "BACK"
    obj.show_in_front = False
    obj.hide_render = True
    bpy.context.scene.collection.objects.link(obj)
    obj["inia_reference_view"] = True
    return obj


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

skin = mat("INIA_Skin_Sculpt", (.115, .025, .0075, 1), .62)
hair_mat = mat("INIA_Hair_Sculpt", (.006, .0012, .0005, 1), .82)
purple = mat("INIA_Uniform_Blockout", (.105, .012, .30, 1), .62)
eye_white = mat("INIA_Sclera", (.82, .74, .64, 1), .32)
iris = mat("INIA_Iris", (.13, .038, .006, 1), .28)
pupil = mat("INIA_Pupil", (.001, .0005, .0003, 1), .2)

# Primary facial volumes built from the new turnaround rather than MPFB.
head_parts = [
    sphere("Cranium", (0, .018, 1.630), (.112, .101, .137), skin),
    sphere("CheekMass", (0, -.025, 1.580), (.101, .089, .094), skin),
    sphere("JawMass", (0, -.010, 1.522), (.075, .075, .068), skin),
    sphere("NoseMass", (0, -.099, 1.580), (.023, .031, .025), skin, 48, 30),
    sphere("NoseTip", (0, -.121, 1.570), (.026, .017, .017), skin, 48, 30),
    sphere("EarL", (-.106, .005, 1.580), (.016, .012, .033), skin, 40, 28),
    sphere("EarR", ( .106, .005, 1.580), (.016, .012, .033), skin, 40, 28),
]
head = join_remesh(head_parts, "INIA_Head_Sculpt", .0028)
head["sculpt_role"] = "primary_head"
head["reference"] = "inia_character_turnaround_v01.png"

# Smooth modifier stays unapplied so the sculpt can be evaluated non-destructively.
smooth = head.modifiers.new("INIA_Sculpt_Soften", "SMOOTH")
smooth.factor = .32
smooth.iterations = 3

# Separate eyeballs provide reliable eyelid targets during sculpting.
for side, x in (("L", -.039), ("R", .039)):
    sphere(f"Eye_{side}", (x, -.095, 1.610), (.029, .023, .027), eye_white, 64, 40)
    sphere(f"Iris_{side}", (x, -.118, 1.610), (.012, .0032, .012), iris, 48, 32)
    sphere(f"Pupil_{side}", (x, -.121, 1.610), (.0054, .0017, .0054), pupil, 40, 28)

# Heart-shaped afro proxy: only a silhouette guide for the later curve groom.
hair_parts = [
    sphere("HairCore", (0, .030, 1.675), (.145, .105, .145), hair_mat),
    sphere("HairLeft", (-.105, .012, 1.660), (.090, .087, .125), hair_mat),
    sphere("HairRight", (.105, .012, 1.660), (.090, .087, .125), hair_mat),
    sphere("HairTopL", (-.055, .016, 1.775), (.090, .080, .085), hair_mat),
    sphere("HairTopR", (.055, .016, 1.775), (.090, .080, .085), hair_mat),
]
hair = join_remesh(hair_parts, "INIA_Hair_Silhouette", .004)
hair["sculpt_role"] = "hair_silhouette_only"

# Bust and neck are proportion blocks, not final clothing topology.
neck = sphere("INIA_Neck_Blockout", (0, .018, 1.405), (.060, .060, .145), skin)
torso = sphere("INIA_Uniform_Silhouette", (0, .040, 1.195), (.245, .145, .245), purple)
neck["blockout"] = True
torso["blockout"] = True

# Orthographic reference planes. Front view looks along -Y; profile along -X.
front = reference_empty("REF_INIA_FRONT", os.path.join(ASSETS, "ref_front_v01.png"),
                        (0, .34, 1.30), (math.pi/2, 0, 0), .58)
profile = reference_empty("REF_INIA_PROFILE", os.path.join(ASSETS, "ref_profile_v01.png"),
                          (.42, 0, 1.30), (math.pi/2, 0, math.pi/2), .58)
front.hide_viewport = True
profile.hide_viewport = True

scene = bpy.context.scene
scene["inia_stage"] = "reference_driven_primary_sculpt_v09"
scene["workflow_note"] = "Enable REF_INIA_FRONT/PROFILE per orthographic viewport"

# Sculpt-friendly viewport state.
bpy.context.view_layer.objects.active = head
head.select_set(True)
for other in bpy.context.selected_objects:
    if other != head:
        other.select_set(False)
scene.tool_settings.use_mesh_automerge = False

camera_data = bpy.data.cameras.new("INIA_Sculpt_Review_Camera")
camera = bpy.data.objects.new("INIA_Sculpt_Review_Camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (0, -.92, 1.57)
camera.data.lens = 66
aim(camera, (0, 0, 1.55))
scene.camera = camera

for name, loc, energy, color, size in (
    ("Key", (-1.2,-1.2,2.2), 250, (1,.66,.48), 1.2),
    ("Fill", (1.0,-.8,1.9), 170, (.45,.28,1), 1.1),
    ("Rim", (0,.5,2.1), 220, (.55,.22,1), .9),
):
    data = bpy.data.lights.new("INIA_" + name, "AREA")
    data.energy, data.color, data.shape, data.size = energy, color, "DISK", size
    obj = bpy.data.objects.new("INIA_" + name, data)
    obj.location = loc
    aim(obj, (0,0,1.55))
    scene.collection.objects.link(obj)

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = PREVIEW
scene.view_settings.look = "AgX - Medium High Contrast"
scene.world.color = (.008,.005,.012)

bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
bpy.ops.render.render(write_still=True)
print("INIA_SCULPT_WORKSPACE_READY", OUTPUT, PREVIEW)
