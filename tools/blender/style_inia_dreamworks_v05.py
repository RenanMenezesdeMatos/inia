"""Add the first cinematic-animation styling pass to INIA's MPFB face."""

import math
import os
import random

import bpy
from mathutils import Vector
from bl_ext.user_default.mpfb.services import TargetService

ROOT = "/Users/renanmenezes/Developer/Works/inia"
SOURCE = os.path.join(ROOT, "assets/avatar/inia/inia_face_v04.blend")
OUTPUT = os.path.join(ROOT, "assets/avatar/inia/inia_sculpt_v08.blend")
PREVIEW = os.path.join(ROOT, "assets/avatar/inia/inia_sculpt_v08_preview.png")
TARGET_ROOT = "/private/tmp/mpfb-stage.6MDp2k/makehumancommunity-mpfb2-80919fa/src/mpfb/data/targets"


def material(name, color, roughness=.45, metallic=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def uv_sphere(name, location, scale, mat, segments=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def curve_poly(name, points, bevel, mat, cyclic=False):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 2
    data.bevel_depth = bevel
    data.bevel_resolution = 3
    spline = data.splines.new("NURBS")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1)
    spline.order_u = min(3, len(points))
    spline.use_endpoint_u = not cyclic
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


bpy.ops.wm.open_mainfile(filepath=SOURCE)
scene = bpy.context.scene
human = next(o for o in scene.objects if o.type == "MESH" and o.name.startswith("INIA_Human"))

# Push the existing face a little further into cinematic animation proportions.
extra_targets = (
    ("head/head-scale-horiz-incr", .11),
    ("eyes/l-eye-scale-incr", .18), ("eyes/r-eye-scale-incr", .18),
    ("eyes/l-eye-height1-incr", .10), ("eyes/r-eye-height1-incr", .10),
    ("cheek/l-cheek-volume-incr", .10), ("cheek/r-cheek-volume-incr", .10),
    ("mouth/mouth-angles-up", .12),
)
for rel, weight in extra_targets:
    path = os.path.join(TARGET_ROOT, rel + ".target.gz")
    name = os.path.basename(rel) + "-style-v05"
    TargetService.load_target(human, path, weight=weight, name=name)

skin = material("INIA_Skin_Final_Blockout", (0.34, 0.105, 0.035, 1), .58)
white = material("INIA_Eye_White", (.93, .94, .92, 1), .24)
iris = material("INIA_Iris_Hazel", (.19, .075, .018, 1), .28)
pupil = material("INIA_Pupil", (.004, .002, .001, 1), .18)
catch = material("INIA_Eye_Catchlight", (1, 1, 1, 1), .08)
hair = material("INIA_Hair_Dark_Brown", (.006, .0015, .0008, 1), .82)
brow = material("INIA_Brows", (.025, .008, .004, 1), .68)
purple = material("INIA_Uniform_Purple", (.19, .035, .46, 1), .52)

if human.data.materials:
    human.data.materials[0] = skin
else:
    human.data.materials.append(skin)

# Expressive layered eyes. Front of the MakeHuman mesh faces negative Y.
for side, x in (("L", -.0315), ("R", .0315)):
    uv_sphere(f"INIA_Eye_{side}", (x, -.1000, 1.565), (.0245, .012, .0175), white)
    uv_sphere(f"INIA_Iris_{side}", (x, -.1115, 1.565), (.0102, .0026, .0102), iris, 40, 24)
    uv_sphere(f"INIA_Pupil_{side}", (x, -.1137, 1.565), (.0048, .0013, .0048), pupil, 32, 20)
    uv_sphere(f"INIA_Catchlight_{side}", (x-.0028, -.1148, 1.569), (.0019, .0007, .0019), catch, 24, 16)

# Soft arched brows, deliberately asymmetrical by a tiny amount.
curve_poly("INIA_Brow_L", [(-.057,-.119,1.595),(-.043,-.121,1.604),(-.026,-.119,1.600),(-.017,-.116,1.594)], .0031, brow)
curve_poly("INIA_Brow_R", [( .017,-.116,1.595),( .028,-.119,1.601),( .044,-.121,1.605),( .058,-.119,1.596)], .0031, brow)

# A layered base gives the curls root density and prevents a bald/hovering look.
hair_masses = []
for name, location, scale in (
    ("INIA_Hair_Core", (0, .034, 1.660), (.132, .092, .145)),
    ("INIA_Hair_Side_L", (-.082, .025, 1.650), (.086, .078, .118)),
    ("INIA_Hair_Side_R", ( .082, .025, 1.650), (.086, .078, .118)),
    ("INIA_Hair_Top_L", (-.047, .030, 1.745), (.085, .074, .078)),
    ("INIA_Hair_Top_R", ( .047, .030, 1.745), (.085, .074, .078)),
):
    hair_masses.append(uv_sphere(name, location, scale, hair, 48, 28))

# Fuse the overlapping masses into one sculptable mesh. Unlike the previous
# balloons, this produces one continuous silhouette that can be groomed.
bpy.ops.object.select_all(action="DESELECT")
for obj in hair_masses:
    obj.select_set(True)
bpy.context.view_layer.objects.active = hair_masses[0]
bpy.ops.object.join()
hair_sculpt = bpy.context.object
hair_sculpt.name = "INIA_Hair_Sculpt"
remesh = hair_sculpt.modifiers.new("INIA_Hair_Voxel_Remesh", "REMESH")
remesh.mode = "VOXEL"
remesh.voxel_size = .0045
remesh.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier=remesh.name)
texture = bpy.data.textures.new("INIA_Hair_MicroVolume", type="CLOUDS")
texture.noise_scale = .018
texture.noise_depth = 2
displace = hair_sculpt.modifiers.new("INIA_Hair_Surface", "DISPLACE")
displace.texture = texture
displace.strength = .006
displace.mid_level = .48
bpy.ops.object.modifier_apply(modifier=displace.name)
bpy.ops.object.shade_smooth()
hair_sculpt["sculpt_ready"] = True

# Voluminous afro silhouette made of actual curl curves over the core, not a
# single smooth helmet.
random.seed(2406)
for i in range(210):
    theta = random.uniform(.12, math.pi-.12)
    # Bias most detail toward the camera-facing half; rear curls only need to
    # carry the silhouette.
    phi = random.uniform(math.pi, math.tau) if i < 175 else random.uniform(0, math.tau)
    # Ellipsoid around the cranium, wider at the sides and slightly lifted.
    center = Vector((
        .102 * math.sin(theta) * math.cos(phi),
        .080 * math.sin(theta) * math.sin(phi) + .010,
        1.625 + .125 * math.cos(theta),
    ))
    # Keep the central face open while preserving side-framing curls.
    if center.y < -.040 and abs(center.x) < .060 and center.z < 1.665:
        continue
    radial = Vector((center.x/.102, (center.y-.010)/.080, (center.z-1.625)/.125)).normalized()
    tangent = radial.cross(Vector((0,0,1)))
    if tangent.length < .2:
        tangent = Vector((1,0,0))
    tangent.normalize()
    bitangent = radial.cross(tangent).normalized()
    radius = random.uniform(.0045, .0080)
    turns = random.uniform(1.8, 3.2)
    length = random.uniform(.014, .030)
    points = []
    for j in range(15):
        t = j/14
        a = turns*math.tau*t + random.uniform(-.08,.08)
        p = center + radial*(t-.5)*length + tangent*math.cos(a)*radius + bitangent*math.sin(a)*radius
        points.append(p)
    curve_poly(f"INIA_Curl_{i:03d}", points, random.uniform(.0016,.0023), hair)

# A simple purple bust cover keeps review renders presentation-safe. A fitted
# polo mesh will replace it in the clothing stage.
shirt = uv_sphere("INIA_Uniform_Blockout", (0, .015, 1.225), (.235, .115, .225), purple, 64, 32)
shirt["temporary_clothing_blockout"] = True

# Polo collar and INIA badge create the intended read while fitted clothing is
# still a separate modeling stage.
collar_l = curve_poly("INIA_Polo_Collar_L", [(-.092,-.108,1.405),(-.054,-.126,1.365),(-.013,-.128,1.335)], .010, purple)
collar_r = curve_poly("INIA_Polo_Collar_R", [( .092,-.108,1.405),( .054,-.126,1.365),( .013,-.128,1.335)], .010, purple)
badge = uv_sphere("INIA_Badge", (.092,-.112,1.315), (.030,.006,.030), purple, 40, 24)
badge["label"] = "INIA MENTORA"

human["inia_stage"] = "sculpt_ready_v08"
scene["inia_style_direction"] = "cinematic stylized animation"
scene["inia_next_step"] = "manual_sculpt_and_hair_groom"

camera = bpy.data.objects.get("INIA_Review_Camera")
camera.location = (0, -.78, 1.53)
camera.data.lens = 62
aim(camera, (0, 0, 1.52))

scene.render.resolution_x = 800
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = PREVIEW
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -1.35
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
bpy.ops.render.render(write_still=True)
print("INIA_STYLED_V05_READY", OUTPUT, PREVIEW)
