"""Renderiza as 4 vistas de um .blend (pose de conferência) e monta a folha referência × render.

    blender -b --python tools/avatar/inia-mentora/render_compare.py -- in=<arquivo.blend> prefix=<nome> [framing=reference|head|full]
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from common import *
a = parse_args()
open_blend(a["in"])
apply_preview_pose(); render_views(a["prefix"], framing=a.get("framing","reference"))
print("SHEET", compare_sheet(a["prefix"]))
