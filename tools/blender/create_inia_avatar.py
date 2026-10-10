import bpy
import math
import os
from mathutils import Vector

ROOT = "/Users/renanmenezes/Developer/Works/inia"
OUT_DIR = os.path.join(ROOT, "assets", "avatar", "inia")
os.makedirs(OUT_DIR, exist_ok=True)

def mat(name, color, metallic=0.0, roughness=0.5):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return material

SKIN = mat("INIA_Skin", (0.34, 0.105, 0.035), 0, 0.72)
SKIN_SOFT = mat("INIA_SkinSoft", (0.48, 0.17, 0.07), 0, 0.65)
HAIR = mat("INIA_Hair", (0.018, 0.006, 0.003), 0, 0.9)
HAIR_HIGHLIGHT = mat("INIA_HairHighlight", (0.12, 0.035, 0.012), 0, 0.82)
PURPLE = mat("INIA_Purple", (0.19, 0.0, 0.38), 0, 0.55)
PURPLE_LIGHT = mat("INIA_PurpleLight", (0.45, 0.04, 0.7), 0, 0.45)
WHITE = mat("INIA_White", (0.94, 0.94, 0.96), 0, 0.34)
BROWN = mat("INIA_Iris", (0.16, 0.045, 0.015), 0, 0.35)
BLACK = mat("INIA_Black", (0.005, 0.003, 0.004), 0, 0.5)
LIP = mat("INIA_Lip", (0.38, 0.025, 0.035), 0, 0.46)
GOLD = mat("INIA_Gold", (0.83, 0.42, 0.04), .5, .28)

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

def collection(name):
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    return coll

def move_to(obj, coll):
    for old in list(obj.users_collection): old.objects.unlink(obj)
    coll.objects.link(obj)

def uv(name, location, scale, material, segments=48, rings=32, coll=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object; obj.name = name; obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth(); obj.data.materials.append(material)
    if coll: move_to(obj, coll)
    return obj

def cube(name, location, scale, material, bevel=.08, coll=None):
    bpy.ops.mesh.primitive_cube_add(location=location); obj=bpy.context.object; obj.name=name; obj.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel: mod=obj.modifiers.new("Soft edges","BEVEL"); mod.width=bevel; mod.segments=4
    obj.data.materials.append(material)
    if coll: move_to(obj, coll)
    return obj

def curve_tube(name, points, bevel, material, coll=None):
    data=bpy.data.curves.new(name,"CURVE"); data.dimensions="3D"; data.bevel_depth=bevel; data.bevel_resolution=4
    spline=data.splines.new("BEZIER"); spline.bezier_points.add(len(points)-1)
    for bp,co in zip(spline.bezier_points,points): bp.co=co; bp.handle_left_type="AUTO"; bp.handle_right_type="AUTO"
    obj=bpy.data.objects.new(name,data); (coll or bpy.context.scene.collection).objects.link(obj); data.materials.append(material); return obj

BODY=collection("01_INIA_BODY"); FACE=collection("02_INIA_FACE"); HAIR_COLL=collection("03_INIA_HAIR"); DETAILS=collection("04_INIA_DETAILS"); RIG=collection("05_INIA_CONTROLS"); STAGE=collection("06_STAGE")

# Torso and uniform
torso=uv("Body_Torso",(0,0,0.15),(1.35,.72,1.55),PURPLE,coll=BODY)
torso.scale.z=.83
neck=uv("Body_Neck",(0,0,1.62),(.42,.38,.55),SKIN,coll=BODY)
curve_tube("Collar_Left",[(-.58,-.56,1.42),(-.28,-.72,1.17),(0,-.73,1.05)],.11,PURPLE_LIGHT,BODY)
curve_tube("Collar_Right",[(.58,-.56,1.42),(.28,-.72,1.17),(0,-.73,1.05)],.11,PURPLE_LIGHT,BODY)

# Head with intentionally stylized proportions matching the reference
head=uv("Face_Head",(0,-.02,2.65),(1.0,.82,1.15),SKIN_SOFT,64,48,FACE)
for x in (-.37,.37):
    eye=uv("Eye_L" if x<0 else "Eye_R",(x,-.765,2.83),(.23,.085,.17),WHITE,32,20,FACE)
    iris=uv("Iris_L" if x<0 else "Iris_R",(x,-.846,2.83),(.105,.025,.105),BROWN,24,16,FACE)
    pupil=uv("Pupil_L" if x<0 else "Pupil_R",(x,-.872,2.83),(.045,.014,.045),BLACK,20,12,FACE)
    uv("EyeCatch_L" if x<0 else "EyeCatch_R",(x-.025,-.887,2.875),(.018,.008,.018),WHITE,16,8,FACE)
    curve_tube("Brow_L" if x<0 else "Brow_R",[(x-.18,-.82,3.12),(x,-.87,3.17),(x+.18,-.82,3.12)],.035,HAIR,FACE)
nose=uv("Face_Nose",(0,-.85,2.55),(.16,.15,.24),SKIN,32,20,FACE)
mouth=uv("Face_Mouth",(0,-.86,2.25),(.34,.055,.12),LIP,40,20,FACE)
for key in ("A","E","I","O","U","M","F","S"):
    mouth.shape_key_add(name=key)
mouth.shape_key_add(name="Basis") if not mouth.data.shape_keys else None
mouth["viseme_order"]="A,E,I,O,U,M,F,S"

# Volumetric coils: layered curls rather than a single helmet
curl_centers=[]
for ring,(radius,count,z) in enumerate(((1.03,22,3.08),(1.19,26,2.78),(1.14,24,2.48))):
    for i in range(count):
        angle=2*math.pi*i/count
        x=math.cos(angle)*radius; depth=.12+math.sin(angle)*.30; zz=z+math.sin(angle*2+ring)*.11
        if zz < 2.2 and abs(x)<.65: continue
        curl_centers.append((x,depth,zz,.20+(i%3)*.025))
for i,(x,y,z,s) in enumerate(curl_centers):
    curl=uv(f"Hair_Curl_{i:03}",(x,y,z),(s,s*.78,s),HAIR_HIGHLIGHT if i%7==0 else HAIR,20,14,HAIR_COLL)
    curl.rotation_euler=(i*.31,i*.17,i*.41)

# Arms and hands in a welcoming resting pose
for side in (-1,1):
    label="L" if side<0 else "R"
    curve_tube(f"Arm_{label}",[(side*1.05,0,1.1),(side*1.38,-.15,.55),(side*.95,-.55,.18)],.24,SKIN,BODY)
    uv(f"Hand_{label}",(side*.88,-.61,.16),(.32,.18,.4),SKIN_SOFT,32,20,BODY)

# Lanyard and badge
curve_tube("Lanyard_L",[(-.26,-.7,1.52),(-.18,-.86,.84),(0,-.87,.49)],.025,PURPLE_LIGHT,DETAILS)
curve_tube("Lanyard_R",[(.26,-.7,1.52),(.18,-.86,.84),(0,-.87,.49)],.025,PURPLE_LIGHT,DETAILS)
badge=cube("Badge_INIA",(0,-.91,.38),(.28,.035,.34),WHITE,.04,DETAILS)
cube("Badge_Purple",(0,-.95,.42),(.19,.018,.10),PURPLE,.025,DETAILS)

# Control empties used later by React/GLB animation clips
for name,loc in (("CTRL_Head",(0,0,2.65)),("CTRL_Hand_L",(-.88,-.61,.16)),("CTRL_Hand_R",(.88,-.61,.16)),("CTRL_Gaze",(0,-3,2.8))):
    bpy.ops.object.empty_add(type="CIRCLE",location=loc); ctrl=bpy.context.object; ctrl.name=name; ctrl.empty_display_size=.22; move_to(ctrl,RIG)

# Ground, lights, camera and reference image path metadata
bpy.ops.mesh.primitive_plane_add(size=20,location=(0,1,-1.02)); ground=bpy.context.object; ground.name="Stage_Ground"; ground.data.materials.append(mat("Stage",(.028,.012,.045),0,.78)); move_to(ground,STAGE)
world=bpy.context.scene.world or bpy.data.worlds.new("INIA_World"); bpy.context.scene.world=world; world.color=(.018,.008,.025)
for name,loc,energy,color,size in (("Key",(-4,-5,6),1300,(1,.72,.56),4),("Fill",(4,-3,4),900,(.46,.2,1),3),("Rim",(0,3,5),1100,(.5,1,.2),3)):
    data=bpy.data.lights.new(name,"AREA"); data.energy=energy; data.color=color; data.shape="DISK"; data.size=size; obj=bpy.data.objects.new(name,data); obj.location=loc; STAGE.objects.link(obj); obj.rotation_euler=(math.radians(25),0,math.radians(180 if loc[1]>0 else 0))
camera_data=bpy.data.cameras.new("Camera_INIA"); camera=bpy.data.objects.new("Camera_INIA",camera_data); STAGE.objects.link(camera); camera.location=(0,-8,2.25); camera.data.lens=62; bpy.context.scene.camera=camera
def track(obj,point): obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
track(camera,(0,0,1.65))
for obj in STAGE.objects:
    if obj.type=="LIGHT": track(obj,(0,0,1.7))

scene=bpy.context.scene; scene.render.engine="BLENDER_EEVEE"; scene.render.resolution_x=700; scene.render.resolution_y=700; scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"; scene.render.filepath=os.path.join(OUT_DIR,"inia_avatar_v01_preview.png")
scene["reference_image"]=os.path.join(ROOT,"frontend","public","INIA.png")
scene["project_note"]="INIA v01 blockout: editable base for facial sculpt, curls, rig and visemes"
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR,"inia_avatar_v01.blend"))
bpy.ops.render.render(write_still=True)
print("INIA_READY", bpy.data.filepath, scene.render.filepath)
