# Turns every .glb in one folder into an .fbx in another, set up for Unity:
# Y up, -Z forward, scale 1, the axis change baked into the vertices so
# nothing comes in rotated -90 or scaled 100.
#
#   blender --background --factory-startup --python blender-fbx.py -- <glb-dir> <fbx-dir>

import os
import sys

import bpy

glb_dir, fbx_dir = sys.argv[sys.argv.index("--") + 1:][:2]
os.makedirs(fbx_dir, exist_ok=True)

for name in sorted(os.listdir(glb_dir)):
    if not name.endswith(".glb"):
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(glb_dir, name))
    out = os.path.join(fbx_dir, name[:-4] + ".fbx")
    bpy.ops.export_scene.fbx(
        filepath=out,
        object_types={"EMPTY", "MESH"},
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        bake_space_transform=True,
        mesh_smooth_type="OFF",
        use_mesh_modifiers=False,
        add_leaf_bones=False,
        bake_anim=False,
        path_mode="STRIP",
    )
    print("wrote", out)
