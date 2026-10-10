"""Secondary-form sculpt pass for the reference-driven INIA head."""

import os
import bpy

ROOT = "/Users/renanmenezes/Developer/Works/inia"
ASSETS = os.path.join(ROOT, "assets/avatar/inia")
SOURCE = os.path.join(ASSETS, "inia_sculpt_workspace_v09.blend")
OUTPUT = os.path.join(ASSETS, "inia_sculpt_features_v10.blend")
PREVIEW = os.path.join(ASSETS, "inia_sculpt_features_v10_preview.png")


def material(name, color, roughness=.5):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def curve(name, points, bevel, mat):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = bevel
    data.bevel_resolution = 4
    data.resolution_u = 12
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


bpy.ops.wm.open_mainfile(filepath=SOURCE)
scene = bpy.context.scene
head = bpy.data.objects["INIA_Head_Sculpt"]

# Commit the soft primary pass before shaping secondary forms.
bpy.context.view_layer.objects.active = head
head.select_set(True)
if head.modifiers.get("INIA_Sculpt_Soften"):
    bpy.ops.object.modifier_apply(modifier="INIA_Sculpt_Soften")

# Reference-driven silhouette correction: round cheeks, then taper toward the
# chin. Nose vertices are excluded by their forward depth.
for vertex in head.data.vertices:
    z = vertex.co.z
    if vertex.co.y > -.085:
        if z < 1.575:
            t = max(0.0, min(1.0, (1.575-z)/.115))
            vertex.co.x *= 1.0 - .19*t
        elif 1.575 <= z <= 1.635:
            cheek = 1.0 - abs(z-1.603)/.032
            vertex.co.x *= 1.0 + .045*max(0, cheek)

skin = bpy.data.materials.get("INIA_Skin_Sculpt")
dark = material("INIA_Lashes_Brows", (.008,.0015,.0006,1), .7)
lip = material("INIA_Lips", (.24,.035,.018,1), .46)
hair = bpy.data.materials.get("INIA_Hair_Sculpt")

# Correct the eye scale and settle them deeper into the sockets.
for side in ("L", "R"):
    eye = bpy.data.objects[f"Eye_{side}"]
    iris = bpy.data.objects[f"Iris_{side}"]
    pupil = bpy.data.objects[f"Pupil_{side}"]
    eye.scale *= .82
    iris.scale *= .86
    pupil.scale *= .86
    eye.location.y += .007
    iris.location.y += .007
    pupil.location.y += .007

# Upper/lower eyelid and lash rhythm follows the large rounded reference eyes.
for side, s in (("L",-1),("R",1)):
    x0 = .037*s
    curve(f"UpperLid_{side}", [
        (x0-.024*s,-.112,1.610), (x0,-.121,1.629), (x0+.024*s,-.112,1.610)
    ], .0023, dark)
    curve(f"LowerLid_{side}", [
        (x0-.022*s,-.111,1.608), (x0,-.116,1.594), (x0+.022*s,-.111,1.608)
    ], .00115, dark)
    # Three restrained outer lashes.
    outer = x0-.024*s
    for i, dz in enumerate((.004,.010,.016)):
        curve(f"Lash_{side}_{i}", [(outer,-.113,1.612+dz*.18),(outer-.008*s,-.116,1.616+dz)], .00105, dark)

curve("Brow_L", [(-.068,-.105,1.660),(-.044,-.116,1.674),(-.014,-.108,1.665)], .0042, dark)
curve("Brow_R", [( .014,-.108,1.665),( .044,-.116,1.674),( .068,-.105,1.660)], .0042, dark)

# Closed friendly smile: distinct upper/lower lips and lifted corners.
curve("UpperLip", [(-.047,-.113,1.535),(-.024,-.121,1.541),(0,-.116,1.536),(.024,-.121,1.541),(.047,-.113,1.535)], .0042, lip)
curve("LowerLip", [(-.044,-.111,1.532),(-.022,-.119,1.520),(0,-.121,1.518),(.022,-.119,1.520),(.044,-.111,1.532)], .0050, lip)
curve("SmileSeam", [(-.044,-.119,1.534),(0,-.124,1.530),(.044,-.119,1.534)], .00125, dark)

# A low, heart-shaped hairline makes the forehead read like the reference.
curve("INIA_Hairline", [(-.086,-.091,1.695),(-.050,-.108,1.718),(-.014,-.113,1.702),(0,-.115,1.695),(.014,-.113,1.702),(.050,-.108,1.718),(.086,-.091,1.695)], .009, hair)

head["inia_stage"] = "secondary_features_v10"
scene["inia_next_step"] = "sculpt_eyelids_lips_and_hairline_into_head"

scene.render.filepath = PREVIEW
scene.render.resolution_x = 800
scene.render.resolution_y = 800
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
bpy.ops.render.render(write_still=True)
print("INIA_FEATURES_V10_READY", OUTPUT, PREVIEW)
