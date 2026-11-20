"""Run with Blender in background mode to rebuild the stone study."""

from pathlib import Path
from math import radians, tan
import sys

import bmesh
import bpy
from mathutils import Vector


ART = Path(__file__).resolve().parent
MODELS = ART.parents[1] / 'public' / 'models' / 'stone-study'
DRAFT = '--draft' in sys.argv
PLATFORM_ONLY = '--platform-only' in sys.argv


def linear(value):
    value /= 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rgb(hex_color):
    return tuple(linear(int(hex_color[index:index + 2], 16)) for index in (0, 2, 4))


def matte(name, hex_color):
    color = (*rgb(hex_color), 1)
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.roughness = 0.88
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Roughness'].default_value = 0.88
    return material


def faceted_mesh(name, vertices, faces, palette):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], [ids for ids, material in faces])
    if mesh.validate(verbose=True):
        raise ValueError(f'{name}: invalid source geometry')
    for label, color in palette:
        mesh.materials.append(matte(label, color))
    for polygon, (_, material_index) in zip(mesh.polygons, faces):
        polygon.material_index = material_index
        polygon.use_smooth = False

    topology = bmesh.new()
    topology.from_mesh(mesh)
    if any(not edge.is_manifold for edge in topology.edges):
        raise ValueError(f'{name}: open or non-manifold shell')
    # Retain the broad planar faces. Cut warped quads before export so the
    # source and glTF agree on the crease and both sides of it stay flat.
    warped = []
    for face in topology.faces:
        if len(face.verts) != 4:
            continue
        points = [vert.co for vert in face.verts]
        corner_normals = [(points[(i + 1) % 4] - point).cross(points[i - 1] - point)
                          for i, point in enumerate(points)]
        # Angle catches warped bevels even when their displacement is small.
        if any(normal.length_squared > 1e-12 and normal.normalized().dot(face.normal) < 0.993
               for normal in corner_normals):
            warped.append(face)
    bmesh.ops.triangulate(topology, faces=warped, quad_method='BEAUTY')
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    assert topology.calc_volume(signed=True) > 0
    topology.to_mesh(mesh)
    topology.free()
    mesh.update()
    mesh.calc_loop_triangles()
    print(f'{name}: {len(mesh.vertices)} vertices, {len(mesh.loop_triangles)} triangles', flush=True)
    return mesh


def stone_platform():
    # A generous flat tread, a narrow upper bevel and a heavier bevel below.
    # The front and rear can chip independently of the two gameplay ends.
    crown = [(-2.90, -.80, 0), (-2.56, -1.14, 0), (-1.47, -1.17, 0),
             (-.51, -1.15, 0), (.61, -1.18, 0), (1.69, -1.13, 0),
             (2.55, -1.12, 0), (2.90, -.76, 0), (2.90, .74, 0),
             (2.50, 1.09, 0), (-1.40, 1.17, 0), (-2.90, .81, 0)]
    lip = [(-2.90, -.84, -.10), (-2.59, -1.19, -.11), (-1.49, -1.22, -.09),
           (-.56, -1.20, -.12), (.58, -1.23, -.09), (1.75, -1.17, -.13),
           (2.60, -1.16, -.09), (2.90, -.81, -.10), (2.90, .77, -.10),
           (2.51, 1.15, -.14), (-1.45, 1.20, -.10), (-2.90, .84, -.13)]
    fracture = [(-2.90, -.78, -.77), (-2.47, -1.08, -.79), (-1.69, -1.18, -.87),
                (-.82, -1.12, -.70), (.34, -1.20, -.82), (1.44, -1.16, -.73),
                (2.40, -1.07, -.81), (2.90, -.72, -.80), (2.90, .73, -.74),
                (2.31, 1.04, -.82), (-1.52, 1.13, -.77), (-2.90, .78, -.68)]
    root = [(-2.53, -.57, -1.12), (-2.31, -.87, -1.16), (-1.57, -.86, -1.19),
            (-.70, -.89, -1.13), (.38, -.95, -1.24), (1.32, -.94, -1.14),
            (2.23, -.84, -1.19), (2.50, -.51, -1.12), (2.49, .56, -1.16),
            (2.20, .85, -1.15), (-1.46, .92, -1.21), (-2.51, .66, -1.13)]
    # The end profiles stay in two continuous planes through both upper bands.
    for ring in (lip, fracture):
        for indices, angle in (((0, 11), 7), ((7, 8), 10)):
            for index in indices:
                x, y, z = ring[index]
                direction = 1 if x > 0 else -1
                ring[index] = (x + direction * z * tan(radians(angle)), y, z)
    palette = [('Limestone | Cream rose', 'EFD9C9'), ('Limestone | Apricot fracture', 'D8AFA2'),
               ('Limestone | Pink quartz', 'E3BEAE'), ('Limestone | Cool mauve', 'C0ACB5'),
               ('Stone | Lilac slate', '737995'), ('Stone | Dusk slate', '535D79'),
               ('Stone | Violet charcoal', '46516D'), ('Limestone | Sunlit bevel', 'FFF1E8')]
    bands = [(7, 7, 7, 7, 7, 7, 7, 2, 7, 7, 7, 3),
             (1, 2, 1, 1, 2, 2, 1, 2, 3, 2, 1, 3),
             (5, 5, 4, 6, 5, 4, 5, 5, 6, 5, 6, 6)]
    faces = [(tuple(range(len(crown))), 0)]
    stride = len(crown)
    for row, shades in enumerate(bands):
        for index, shade in enumerate(shades):
            a = row * stride + index
            b = row * stride + (index + 1) % stride
            if index in (7, 11) and row == 0:
                faces.append(((a, b, b + stride, b + 2 * stride, a + 2 * stride, a + stride), shade))
            elif index not in (7, 11) or row != 1:
                faces.append(((a, b, b + stride, a + stride), shade))
    # Keep the foot irregular, with a closed fan hidden underneath.
    foot_center = stride * 4
    for index in range(stride):
        faces.append(((3 * stride + index, 3 * stride + (index + 1) % stride, foot_center), 6))
    return faceted_mesh('Stone Platform', crown + lip + fracture + root + [(.12, .04, -1.19)],
                        faces, palette)


def cliff_mass():
    # A broad upper shelf feeds into a diagonal fault and draws down to a
    # narrow, offset foot. Keep the relief shallow relative to the height.
    outline = [(-1.78, .00, .05), (-2.15, -.13, 1.28), (-2.37, -.27, 2.70),
               (-2.94, -.29, 4.30), (-3.37, -.36, 5.69), (-3.62, -.28, 6.98),
               (-3.45, -.16, 7.72), (-2.36, .00, 8.13), (-.77, -.10, 7.93),
               (.42, -.04, 7.57), (.60, -.06, 6.87), (2.18, -.05, 6.91),
               (3.33, -.20, 6.31), (3.61, -.22, 5.37), (2.89, -.22, 4.58),
               (2.07, -.20, 3.36), (1.26, -.45, 2.67), (.74, -.31, 1.55),
               (-.19, -.13, .40), (-.86, -.04, 0)]
    spine = [(-1.43, -.52, .55), (-1.58, -.82, 2.50), (-1.16, -.99, 4.33),
             (-.30, -.93, 6.05), (.26, -.57, 7.12)]
    shoulder = [(1.24, -.63, 4.78), (2.04, -.52, 6.09)]
    front = outline + spine + shoulder
    faces = [((0, 1, 20, 19), 3), ((1, 2, 21, 20), 2), ((2, 3, 22, 21), 2),
             ((3, 4, 22), 1), ((4, 5, 23, 22), 1), ((5, 6, 7, 23), 0),
             ((7, 8, 24, 23), 1), ((8, 9, 24), 0),
             ((19, 20, 18), 4), ((20, 21, 17, 18), 4), ((21, 22, 16, 17), 3),
             ((22, 23, 25, 16), 3), ((23, 24, 26, 25), 2), ((24, 9, 10), 3),
             ((24, 10, 11, 26), 4), ((16, 25, 15), 2), ((25, 14, 15), 3),
             ((25, 26, 13, 14), 2), ((26, 12, 13), 1), ((26, 11, 12), 0)]
    back_offsets = [(.06, .47, .02), (.18, .67, -.05), (.07, .71, -.10),
                    (.02, .77, .05), (.17, .86, .15), (.09, .91, -.05),
                    (.06, .73, -.04), (.17, .72, -.19), (.10, .84, -.23),
                    (.22, .82, -.16), (.14, .91, -.06), (-.05, .88, -.20),
                    (-.16, .78, -.21), (-.21, .76, -.10), (-.17, .71, -.20),
                    (-.16, .65, -.11), (.02, .59, -.04), (-.07, .52, -.09),
                    (-.08, .47, -.04), (.05, .46, .01)]
    back = [(x * .98 + dx, -.12 * y + dy, z + dz)
            for (x, y, z), (dx, dy, dz) in zip(outline, back_offsets)]
    back += [(x * .96 - .03, -.35 * y + .70, z - .05) for x, y, z in spine + shoulder]
    offset = len(front)
    back_shades = (1, 2, 2, 4, 3)
    faces += [(tuple(index + offset for index in ids), back_shades[shade])
              for ids, shade in list(faces)]
    side_shades = (4, 3, 3, 3, 2, 2, 1, 0, 1, 4, 1, 0, 3, 4, 3, 3, 4, 4, 4, 4)
    for index, shade in enumerate(side_shades):
        next_index = (index + 1) % len(outline)
        faces.append(((index, next_index, next_index + offset, index + offset), shade))
    palette = [('Cliff | Mist lavender', '7D7B99'), ('Cliff | Worn blue slate', '6D708F'),
               ('Cliff | Indigo slate', '596785'), ('Cliff | Violet fault', '585573'),
               ('Cliff | Deep shale', '464B68')]
    return faceted_mesh('Cliff Mass', front + back, faces, palette)


def instance(mesh, collection, location=(0, 0, 0)):
    obj = bpy.data.objects.new(mesh.name, mesh)
    collection.objects.link(obj)
    obj.location = location
    return obj


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def light(collection, name, kind, location, target, power, color, size):
    data = bpy.data.lights.new(name, kind)
    data.energy = power
    data.color = color
    if kind == 'SUN':
        data.angle = radians(size)
    else:
        data.shape = 'DISK'
        data.size = size
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    aim(obj, target)


def studio(scene, name, target, offset, ortho_scale, resolution):
    scene.name = name
    assets = bpy.data.collections.new('Stone assets')
    scene.collection.children.link(assets)
    rig = bpy.data.collections.new('Studio (renders only)')
    scene.collection.children.link(rig)
    camera_data = bpy.data.cameras.new('Orthographic')
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = ortho_scale
    camera = bpy.data.objects.new('Orthographic', camera_data)
    rig.objects.link(camera)
    camera.location = Vector(target) + Vector(offset)
    aim(camera, target)
    scene.camera = camera

    light(rig, 'Sun | Warm key', 'SUN', (-7, -6, 13), (0, 0, 1), 1.95, (1, .86, .74), 16)
    light(rig, 'Area | Blue fill', 'AREA', (6, -5, 7), (0, 0, 2), 430, (.71, .82, 1), 8)
    light(rig, 'Area | Rim', 'AREA', (1, 6, 11), (0, 0, 3), 490, (.84, .88, 1), 7)
    scene.world = bpy.data.worlds.get('Studio World') or bpy.data.worlds.new('Studio World')
    scene.world.use_nodes = True
    ambient = scene.world.node_tree.nodes.get('Background')
    ambient.inputs['Color'].default_value = (.48, .57, .75, 1)
    ambient.inputs['Strength'].default_value = .44

    ground = bpy.data.meshes.get('Studio Floor')
    if ground is None:
        ground = bpy.data.meshes.new('Studio Floor')
        ground.from_pydata([(-200, -200, 0), (200, -200, 0), (200, 200, 0), (-200, 200, 0)],
                           [], [(0, 1, 2, 3)])
        ground.materials.append(matte('Studio | Powder blue', 'A8B7D2'))
    instance(ground, rig, (0, 0, -.018))

    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 5
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = .30
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 50 if DRAFT else 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    return assets


def export_asset(scene, obj, filename):
    bpy.context.window.scene = scene
    original_location = obj.location.copy()
    obj.location = (0, 0, 0)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.export_scene.gltf(filepath=str(MODELS / filename), export_format='GLB',
                                  use_selection=True, export_cameras=False, export_lights=False,
                                  export_texcoords=False, export_normals=True, export_animations=False)
    finally:
        obj.select_set(False)
        obj.location = original_location


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    platform_mesh = stone_platform()
    cliff_mesh = cliff_mass()

    composition = bpy.context.scene
    assets = studio(composition, '01 | Platform in front of cliff', (.42, .4, 4.02),
                    (3.9, -19, 4.7), 12.8, (1050, 1140))
    instance(platform_mesh, assets, (-1.34, -2.00, 2.98))
    instance(cliff_mesh, assets, (1.79, 2.08, 0))

    platform_scene = bpy.data.scenes.new('02 | Stone platform')
    assets = studio(platform_scene, '02 | Stone platform', (0, 0, .81),
                    (3.35, -14, 4.65), 7.65, (1200, 760))
    platform = instance(platform_mesh, assets, (0, 0, 1.24))

    cliff_scene = bpy.data.scenes.new('03 | Cliff mass')
    assets = studio(cliff_scene, '03 | Cliff mass', (.02, .05, 4.04),
                    (5.9, -18, 4.2), 10.55, (940, 1080))
    cliff = instance(cliff_mesh, assets)

    shots = ((composition, 'stone-study.png'), (platform_scene, 'stone-platform.png'),
             (cliff_scene, 'cliff-mass.png'))
    for scene, filename in shots:
        scene.render.filepath = f'//{filename}'

    if not DRAFT:
        MODELS.mkdir(parents=True, exist_ok=True)
        export_asset(platform_scene, platform, 'stone-platform.glb')
        if not PLATFORM_ONLY:
            export_asset(cliff_scene, cliff, 'cliff-mass.glb')
        bpy.context.window.scene = composition
        bpy.context.preferences.filepaths.save_version = 0
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    area.spaces.active.region_3d.view_perspective = 'CAMERA'
                    area.spaces.active.shading.color_type = 'MATERIAL'
                    area.spaces.active.overlay.show_overlays = False
        bpy.ops.wm.save_as_mainfile(filepath=str(ART / 'stone-study.blend'))

    for scene, filename in shots:
        if PLATFORM_ONLY and scene == cliff_scene:
            continue
        scene.render.filepath = str(ART / (f'draft-{filename}' if DRAFT else filename))
        bpy.ops.render.render(scene=scene.name, write_still=True)


if __name__ == '__main__':
    main()
