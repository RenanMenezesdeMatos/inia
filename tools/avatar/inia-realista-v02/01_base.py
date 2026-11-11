"""Etapa 01 — importa o GLB base e prepara o arquivo de trabalho.

    blender -b --python tools/avatar/inia-realista-v02/01_base.py -- out=assets/avatar/inia/realista-v02/work/01_base.blend

- Importa `frontend/public/models/inia-avatar-poc.glb` (asset base CC BY 4.0, nunca alterado).
- Remove o 'Icosphere' que o importador cria como forma de exibição de osso.
- Descarta a ação de pose estática do asset (mão na cintura): a pose base da INIA é feita no
  frontend, sobre a pose de descanso (A-pose), para que tudo seja ajustável por parâmetro.
- Renomeia os objetos para nomes estáveis (INIA_Rig/Body/Head/Eyes). Ossos e blendshapes mantêm
  os nomes originais (Mixamo e ARKit), que são o contrato com o frontend.
"""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from common import BASE_GLB, BODY, EYES, HEAD, RIG, WORK, parse_args, save_blend, write_report  # noqa: E402

args = parse_args()
out = Path(args.get("out", WORK / "01_base.blend"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(BASE_GLB))

for ob in list(bpy.data.objects):
    if ob.name.startswith("Icosphere"):
        bpy.data.objects.remove(ob, do_unlink=True)

renames = {"girl_armature": RIG, "girl_body": BODY, "girl_head": HEAD, "girl_eyes": EYES}
for old, new in renames.items():
    bpy.data.objects[old].name = new
    bpy.data.objects[new].data.name = new

armature = bpy.data.objects[RIG]
if armature.animation_data:
    armature.animation_data.action = None
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
for pose_bone in armature.pose.bones:
    pose_bone.location = (0, 0, 0)
    pose_bone.rotation_quaternion = (1, 0, 0, 0)
    pose_bone.rotation_euler = (0, 0, 0)
    pose_bone.scale = (1, 1, 1)

bpy.context.scene.render.fps = 30
save_blend(out)
write_report(out.with_suffix(".json"), {
    "objects": {ob.name: ob.type for ob in bpy.data.objects},
    "bones": len(armature.data.bones),
    "shape_keys": {name: len(bpy.data.objects[name].data.shape_keys.key_blocks) - 1 for name in (HEAD, EYES)},
})
print("OK 01_base", out)
