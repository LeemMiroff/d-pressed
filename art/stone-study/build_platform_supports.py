"""Build three cliff supports around a common mounting plane at y=0."""

from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.dont_write_bytecode = True
from build_stone_study import ART, DRAFT, MODELS, export_asset, faceted_mesh, instance, stone_platform, studio


PALETTE = [('Rock | Cool ridge', '72768F'), ('Rock | Violet slate', '60647F'),
           ('Rock | Slate shadow', '505670'), ('Rock | Deep fault', '424962'),
           ('Rock | Terrace', '8C899D')]

# Each profile runs from foot to crown. Coordinates are lateral position,
# height and depth towards the player, in game units.
SUPPORTS = [
    ('Low Spur', 'support-low-spur.glb', 21, 1.8, [
        [(-9, 6, 0), (-13, 11, .15), (-11, 16, .25), (-15, 24, .18), (-12, 29, 0)],
        [(-6, 3, .75), (-8, 10, 1.45), (-8, 18, .8), (-10, 24, 1.9), (-7, 29, 1.1)],
        [(-2, 0, 1.35), (-4, 9, 2.35), (-2, 16, 2.9), (-4, 25, 3), (-3, 32, 2.1)],
        [(5, 2, 1.25), (4, 12, 1.9), (5, 19, 2.2), (6, 25, 2.7), (4, 32, 2.7)],
        [(8, 6, 0), (12, 13, .18), (10, 18, .55), (14, 23, .6), (10, 27, 0)],
    ], [
        '32211201', '21212201', '12210111', '23212012',
    ], {(0, 2): 1.55, (1, 1): 2.65, (2, 2): 1.15, (3, 0): 1.85}),
    ('Split Pillar', 'support-split-pillar.glb', 40, 2.3, [
        [(-7, 9, 0), (-12, 17, .3), (-10, 26, .1), (-15, 34, .24), (-13, 43, .5), (-11, 49, 0)],
        [(-4, 6, .65), (-7, 16, 1.55), (-7, 27, .7), (-11, 37, 1.9), (-8, 44, 2.3), (-7, 49, 1.2)],
        [(1, 0, 1.35), (-2, 14, 2.9), (-4, 25, 2.5), (-5, 34, 2.8), (-3, 46, 3), (-2, 54, 2.75)],
        [(6, 3, 1.25), (5, 13, 1.35), (3, 23, 2.45), (2, 32, 1.3), (5, 42, 1.55), (4, 54, 1.45)],
        [(8, 9, .7), (9, 16, 1.9), (9, 27, 1.35), (8, 35, 2.15), (10, 40, 2.5), (9, 46, 1.5)],
        [(10, 13, 0), (12, 18, .18), (11, 26, .1), (12, 35, .45), (14, 40, .3), (12, 46, 0)],
    ], [
        '3231212101', '2112010121', '2331220121', '3221120131', '3322131223',
    ], {(0, 2): 1.45, (1, 1): 2.6, (1, 3): 1.5, (2, 2): 1.15, (3, 3): 2.82, (4, 1): 1.4}),
    ('Broken Terrace', 'support-broken-terrace.glb', 24, 2.2, [
        [(-14, 8, 0), (-18, 13, .15), (-16, 19, .45), (-19, 25, .1), (-16, 30, 0)],
        [(-11, 3, .7), (-13, 12, 1.35), (-10, 20, 2), (-14, 27, 2.4), (-11, 30, 1.8)],
        [(-6, 0, 1.3), (-7, 10, 2.3), (-5, 19, 1.95), (-7, 29, 3), (-4, 36, 2.8)],
        [(5, 1, 1.1), (3, 11, 1.3), (5, 18, 2.45), (4, 27, 2.75), (7, 36, 2.8)],
        [(11, 5, .65), (9, 13, 1.45), (12, 21, 2.55), (13, 26, 1.65), (14, 31, 1.75)],
        [(13, 9, 0), (16, 14, .2), (15, 20, .45), (19, 24, .5), (18, 31, 0)],
    ], [
        '32122201', '21102201', '22310121', '32211012', '33231321',
    ], {(0, 2): .85, (1, 1): 2.8, (2, 1): 1.5, (2, 2): 2.2, (3, 2): 1.15, (4, 1): 1.52}),
]


def support_mesh(name, mount, backing_depth, profiles, face_shades, fractures):
    height_count = len(profiles[0])
    vertices = [(x, -relief, z - mount) for profile in profiles for x, z, relief in profile]
    faces = []
    for column in range(len(profiles) - 1):
        for course in range(height_count - 1):
            index = column * height_count + course
            next_column = index + height_count
            corners = [index, next_column, next_column + 1, index + 1]
            shade_a, shade_b = map(int, face_shades[column][course * 2:course * 2 + 2])
            fracture = fractures.get((column, course))
            if fracture is not None:
                # A few raised or recessed facets break up the main strata.
                a, b, c, d = (vertices[i] for i in corners)
                center = len(vertices)
                vertices.append((.32 * a[0] + .17 * b[0] + .32 * c[0] + .19 * d[0], -fracture,
                                 .23 * a[2] + .13 * b[2] + .44 * c[2] + .20 * d[2]))
                for edge, shade in enumerate((shade_a, shade_b, shade_b, shade_a)):
                    faces.append(((corners[edge], corners[(edge + 1) % 4], center), shade))
            elif shade_a == shade_b:
                faces.append((tuple(corners), shade_a))
            else:
                if (column + course * 2) % 3 == 1:
                    corners = corners[1:] + corners[:1]
                a, b, c, d = corners
                faces.extend([((a, b, c), shade_a), ((a, c, d), shade_b)])

    last_column = (len(profiles) - 1) * height_count
    perimeter = [*range(height_count),
                 *range(2 * height_count - 1, last_column + height_count, height_count),
                 *range(last_column + height_count - 2, last_column - 1, -1),
                 *range(last_column - height_count, 0, -height_count)]
    offset = len(vertices)
    assert all(-3 <= y <= 0 for _, y, _ in vertices)
    vertices += [(vertices[index][0], backing_depth, vertices[index][2]) for index in perimeter]
    for i, front_a in enumerate(perimeter):
        j = (i + 1) % len(perimeter)
        front_b = perimeter[j]
        same_terrace = front_a % height_count == front_b % height_count == height_count - 1
        shade = 4 if same_terrace and vertices[front_a][2] == vertices[front_b][2] else 3
        faces.append(((front_a, front_b, offset + j, offset + i), shade))
    faces.append((tuple(range(offset, len(vertices))), 3))
    return faceted_mesh(name, vertices, faces, PALETTE)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    props = studio(scene, 'Platform support study', (0, 0, 24),
                   (24, -145, 31), 154, (1450, 700))
    scene.objects['Studio Floor'].scale = (4, 4, 1)
    # Large game units need larger fill and rim sources for this presentation.
    for light in (obj for obj in scene.objects if obj.type == 'LIGHT' and obj.data.type == 'AREA'):
        light.location *= 7
        light.data.size *= 7
        light.data.energy *= 49
    platform_mesh = stone_platform()
    for x, (name, filename, mount, backing, profiles, shades, fractures) in zip((-46, 0, 45), SUPPORTS):
        obj = instance(support_mesh(name, mount, backing, profiles, shades, fractures), props, (x, 0, mount))
        platform = instance(platform_mesh, props, (x, -6.75, mount))
        platform.scale = (31 / 5.8, 13.5 / 2.43, 8 / 1.24)
        if not DRAFT:
            MODELS.mkdir(parents=True, exist_ok=True)
            export_asset(scene, obj, filename)

    scene.render.filepath = '//platform-supports.png'
    if not DRAFT:
        bpy.context.preferences.filepaths.save_version = 0
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    area.spaces.active.region_3d.view_perspective = 'CAMERA'
                    area.spaces.active.shading.color_type = 'MATERIAL'
                    area.spaces.active.overlay.show_overlays = False
        bpy.ops.wm.save_as_mainfile(filepath=str(ART / 'platform-supports.blend'))
    scene.render.filepath = str(ART / ('draft-platform-supports.png' if DRAFT else 'platform-supports.png'))
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
