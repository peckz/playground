"""
Rebuilds the glow icon from the path tracer (tracer.ts, scene.ts, settings.ts) as a Cycles
scene, in its own scene called "Glow Icon", so the rest of the file is left alone.

World axes match the tracer: x right, y up the icon, z towards the camera. The camera looks
straight down -z. 1 world unit is 100px on the 1024 Figma frame.

Run inside Blender:  exec(open(path).read())
Or headless:         Blender -b -P build_scene.py
"""

import math
import os

import bmesh
import bpy
import numpy
from mathutils import Matrix, Vector

HERE = (
    os.path.dirname(os.path.abspath(__file__))
    if "__file__" in globals()
    else os.getcwd()
)
BLEND_PATH = os.path.join(HERE, "frosted.blend")
SCENE_NAME = "Glow Icon"

# The approved dark look, copied from settings.ts
SETTINGS = {
    "glowCorner": 0.5,
    "glowFillet": 0.13,
    "glowThickness": 1.5,
    "frost": 0.42,
    "polish": 0.16,
    "milkiness": 0.3,
    "density": 0.9,
    "glowCore": "#ff8a2e",
    "glowMid": "#ff3f8a",
    "glowEdge": "#8a5cff",
    "glowStrength": 1.3,
    "edgeLight": 0.131,  # set in Blender: a soft white sheen
    "edgeColor": "#fdfaff",
    "edgeShade": 0.5,  # set in Blender
    "glowSpill": 0.15,
    "spillReach": 0.8,
    "ior": 1.49,
    "gap": 1.05,
    "clearCorner": 0.62,
    "clearFillet": 0.2,
    "clearThickness": 1.6,
    "clearFrost": 0.3,
    "clearHaze": 0.02,
    "clearTint": "#eef1f6",
    "clearDensity": 0.4,
    "clearEdgeShade": 0.5,  # set in Blender
    "slabFillet": 0.2,
    "baseColor": "#17151d",
    "baseRoughness": 0.3,
    "baseSunSpread": 8,
    "baseShadowSoftness": 6,
    "sunStrength": 3,
    "sunSoftness": 1.5,
    "sunAzimuth": -140,
    "sunElevation": 50,
    "ambient": 0.06,
    "accentColor": "#8b5cf6",
    "accentStrength": 0.6,
    "exposure": 0.6,
    "contrast": 1.2,
    "floorColor": "#07050b",
    "shadowSoftness": 8,
    "loopApart": 0.6,
    "loopTogether": 0.19,
    "slant": 14,
    "bounces": 12,
}

# Where Cycles needs different numbers to give the tracer's picture. The tracer adds each
# straight run's glow without absorbing it along the way, and takes its colour at the run's
# midpoint, so its blocks glow brighter and warmer than exact integration of the same field.
BLENDER_GLOW = {"absorption": 0.5, "flatten": 1.0}
# The clear block's frost from inside. None matches the outer frost, which keeps the
# strongest contrast through it. 0.48 was tried and read milkier.
BLENDER_CLEAR = {"insideFrost": None}
# The glowing block's walls keep the tracer's white sheen. A faint black over the whole
# side was tried instead; set overlay above 0 to bring it back.
BLENDER_WALL = {"overlay": 0.0}

FRAME = 1024
PIXELS_PER_UNIT = 100
GLOW_OUTLINE = [(302, 314), (662, 314), (532, 762), (302, 762)]
CLEAR_OUTLINE = [(502, 262), (762, 262), (762, 710), (372, 710)]
SLAB_HALF_SIZE = 4.12
SLAB_THICKNESS = 0.8
PAGE_GAP = 0.32
FLOOR_Z = -(SLAB_THICKNESS + PAGE_GAP)
GLOW_LIFT = 0.25
ICON_WORLD_SIZE = 8.24
LENS_FOV = 5
PANEL_DISTANCE = 500
LOOP_FRAMES = 120  # 4 seconds at 30 fps

SLANT_TAN = math.tan(math.radians(SETTINGS["slant"]))
GLOW_FRONT = GLOW_LIFT + SETTINGS["glowThickness"]
CLEAR_FRONT = GLOW_FRONT + SETTINGS["gap"] + SETTINGS["clearThickness"]


def linear(hex_color):
    """sRGB hex to linear RGB, like THREE.Color does"""
    channels = [int(hex_color[index : index + 2], 16) / 255 for index in (1, 3, 5)]
    return tuple(
        channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4
        for channel in channels
    )


def scaled(color, factor):
    return tuple(channel * factor for channel in color)


def blender_roughness(tracer_roughness):
    """
    The tracer tilts its microfacets by a random vector of length roughness² · 1.6, so the
    typical slope is about 0.8 of that. GGX's alpha is the typical slope, and Blender's
    roughness is the square root of alpha.
    """
    return math.sqrt(tracer_roughness * tracer_roughness * 1.6 * 0.4)


# ---------------------------------------------------------------------------------------
# Shapes: the same signed distance functions as the tracer, in numpy


def to_world(point):
    return ((point[0] - FRAME / 2) / PIXELS_PER_UNIT, (FRAME / 2 - point[1]) / PIXELS_PER_UNIT)


def edge_planes(polygon):
    corners = [to_world(point) for point in polygon]
    center_x = sum(corner[0] for corner in corners) / len(corners)
    center_y = sum(corner[1] for corner in corners) / len(corners)
    planes = []
    for index, corner in enumerate(corners):
        following = corners[(index + 1) % len(corners)]
        length = math.hypot(following[0] - corner[0], following[1] - corner[1])
        normal_x = (following[1] - corner[1]) / length
        normal_y = -(following[0] - corner[0]) / length
        if normal_x * (corner[0] - center_x) + normal_y * (corner[1] - center_y) < 0:
            normal_x = -normal_x
            normal_y = -normal_y
        planes.append((normal_x, normal_y, normal_x * corner[0] + normal_y * corner[1]))
    return planes, (center_x, center_y)


def soft_combine(values):
    """p-norm with p = 3 of the positive parts, plus the deepest value when all are inside"""
    deepest = numpy.max(values, axis=0)
    cubes = numpy.sum(numpy.maximum(values, 0.0) ** 3, axis=0)
    return numpy.cbrt(cubes) + numpy.minimum(deepest, 0.0)


def block_outline(planes, corner, x_values, y_values):
    distances = numpy.stack(
        [normal_x * x_values + normal_y * y_values - offset + corner for normal_x, normal_y, offset in planes]
    )
    return soft_combine(distances) - corner


def block_distance(block, points):
    local_z = points[:, 2] - block["front"]
    local_x = points[:, 0] - local_z * SLANT_TAN
    outline = block_outline(block["planes"], block["corner"], local_x, points[:, 1])
    half = block["thickness"] / 2
    height = numpy.abs(local_z + half) - half
    fillet = block["fillet"]
    return soft_combine(numpy.stack([outline + fillet, height + fillet])) - fillet


def slab_outline(x_values, y_values):
    return (numpy.abs(x_values) ** 5 + numpy.abs(y_values) ** 5) ** 0.2 - SLAB_HALF_SIZE


def slab_distance(slab, points):
    outline = slab_outline(points[:, 0], points[:, 1])
    half = SLAB_THICKNESS / 2
    height = numpy.abs(points[:, 2] + half) - half
    fillet = slab["fillet"]
    return soft_combine(numpy.stack([outline + fillet, height + fillet])) - fillet


def gradient(distance_function, shape, points):
    step = 1e-4
    columns = []
    for axis in range(3):
        offset = numpy.zeros(3)
        offset[axis] = step
        columns.append(distance_function(shape, points + offset) - distance_function(shape, points - offset))
    normals = numpy.stack(columns, axis=1)
    return normals / numpy.linalg.norm(normals, axis=1, keepdims=True)


def block_contour(block, level, angles):
    """Where the outline field crosses a level, found along rays from the block's centre"""
    center_x, center_y = block["center"]
    direction_x = numpy.cos(angles)
    direction_y = numpy.sin(angles)
    inner = numpy.zeros_like(angles)
    outer = numpy.full_like(angles, 10.0)
    for _ in range(60):
        middle = (inner + outer) / 2
        value = block_outline(
            block["planes"], block["corner"], center_x + direction_x * middle, center_y + direction_y * middle
        )
        inside = value < level
        inner = numpy.where(inside, middle, inner)
        outer = numpy.where(inside, outer, middle)
    radius = (inner + outer) / 2
    return center_x + direction_x * radius, center_y + direction_y * radius


def slab_contour(slab, level, parameters):
    radius = SLAB_HALF_SIZE + level
    cosine = numpy.cos(parameters)
    sine = numpy.sin(parameters)
    return (
        radius * numpy.sign(cosine) * numpy.abs(cosine) ** 0.4,
        radius * numpy.sign(sine) * numpy.abs(sine) ** 0.4,
    )


def even_parameters(contour, shape, count):
    """Parameters spaced evenly by arc length on the outer contour, so corners get enough rows"""
    dense = numpy.linspace(0.0, 2 * math.pi, 8192, endpoint=False)
    x_values, y_values = contour(shape, 0.0, dense)
    steps = numpy.hypot(numpy.diff(x_values, append=x_values[0]), numpy.diff(y_values, append=y_values[0]))
    travelled = numpy.concatenate([[0.0], numpy.cumsum(steps)[:-1]])
    targets = numpy.linspace(0.0, travelled[-1] + steps[-1], count, endpoint=False)
    return numpy.interp(targets, travelled, dense)


def profile_rows(thickness, fillet, fillet_rows, wall_rows):
    """
    (outline level, depth below the front) for each ring, front to back. The fillet follows
    the p = 3 curve the distance function makes: (level + f)³ + (depth + f)³ = f³.
    """
    rows = []
    for index in range(fillet_rows + 1):
        angle = (math.pi / 2) * (1 - index / fillet_rows)
        across = math.cos(angle) ** (2 / 3)
        down = math.sin(angle) ** (2 / 3)
        rows.append((-fillet + fillet * across, -fillet + fillet * down))
    for index in range(1, wall_rows):
        rows.append((0.0, -fillet - (thickness - 2 * fillet) * index / wall_rows))
    for index in range(fillet_rows + 1):
        angle = (math.pi / 2) * index / fillet_rows
        across = math.cos(angle) ** (2 / 3)
        down = math.sin(angle) ** (2 / 3)
        rows.append((-fillet + fillet * across, -thickness + fillet - fillet * down))
    return rows


def build_mesh(name, contour, shape, front, thickness, fillet, shear, distance_function, ring_count):
    parameters = even_parameters(contour, shape, ring_count)
    rows = profile_rows(thickness, fillet, 18, 6)
    positions = []
    for level, depth in rows:
        x_values, y_values = contour(shape, level, parameters)
        z_value = front + depth
        positions.append(
            numpy.stack([x_values + depth * shear, y_values, numpy.full_like(x_values, z_value)], axis=1)
        )
    positions = numpy.concatenate(positions)

    mesh = bpy.data.meshes.new(name)
    faces = []
    for row in range(len(rows) - 1):
        for column in range(ring_count):
            following = (column + 1) % ring_count
            faces.append(
                (
                    row * ring_count + column,
                    row * ring_count + following,
                    (row + 1) * ring_count + following,
                    (row + 1) * ring_count + column,
                )
            )
    faces.append(tuple(range(ring_count)))
    last = (len(rows) - 1) * ring_count
    faces.append(tuple(range(last, last + ring_count)))
    mesh.from_pydata([tuple(point) for point in positions], [], faces)

    editable = bmesh.new()
    editable.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(editable, faces=editable.faces)
    editable.to_mesh(mesh)
    editable.free()

    # Exact normals from the distance function, so the fillets shade like the tracer's
    normals = gradient(distance_function, shape, positions)
    mesh.shade_smooth()
    mesh.normals_split_custom_set_from_vertices([tuple(normal) for normal in normals])
    return mesh


# ---------------------------------------------------------------------------------------
# Node helpers


class Nodes:
    """Builds node math from Python expressions of sockets and numbers"""

    def __init__(self, tree):
        self.tree = tree
        self.column = 0

    def add(self, kind, **properties):
        node = self.tree.nodes.new(kind)
        for key, value in properties.items():
            setattr(node, key, value)
        node.location = (self.column * 40 % 4000, -(self.column // 100) * 300)
        self.column += 1
        return node

    def feed(self, socket, value):
        if isinstance(value, (int, float)):
            socket.default_value = value
        elif isinstance(value, tuple):
            socket.default_value = value if len(socket.default_value) == len(value) else (*value, 1.0)
        else:
            self.tree.links.new(value, socket)

    def math(self, operation, first, second=None, clamp=False):
        node = self.add("ShaderNodeMath", operation=operation, use_clamp=clamp)
        self.feed(node.inputs[0], first)
        if second is not None:
            self.feed(node.inputs[1], second)
        return node.outputs[0]

    def separate(self, vector):
        node = self.add("ShaderNodeSeparateXYZ")
        self.feed(node.inputs[0], vector)
        return node.outputs[0], node.outputs[1], node.outputs[2]

    def smoothstep(self, value, low, high, flip=False):
        node = self.add("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        self.feed(node.inputs["Value"], value)
        node.inputs["From Min"].default_value = low
        node.inputs["From Max"].default_value = high
        node.inputs["To Min"].default_value = 1.0 if flip else 0.0
        node.inputs["To Max"].default_value = 0.0 if flip else 1.0
        return node.outputs["Result"]

    def mix_color(self, factor, first, second):
        node = self.add("ShaderNodeMix", data_type="RGBA")
        self.feed(node.inputs["Factor"], factor)
        self.feed(node.inputs[6], first)
        self.feed(node.inputs[7], second)
        return node.outputs[2]

    def scale_vector(self, vector, factor):
        node = self.add("ShaderNodeVectorMath", operation="SCALE")
        self.feed(node.inputs[0], vector)
        self.feed(node.inputs["Scale"], factor)
        return node.outputs[0]

    def mix_shader(self, factor, first, second):
        node = self.add("ShaderNodeMixShader")
        self.feed(node.inputs[0], factor)
        self.tree.links.new(first, node.inputs[1])
        self.tree.links.new(second, node.inputs[2])
        return node.outputs[0]

    def add_shader(self, first, second):
        node = self.add("ShaderNodeAddShader")
        self.tree.links.new(first, node.inputs[0])
        self.tree.links.new(second, node.inputs[1])
        return node.outputs[0]

    def emission(self, color, strength=1.0):
        node = self.add("ShaderNodeEmission")
        self.feed(node.inputs["Color"], color)
        self.feed(node.inputs["Strength"], strength)
        return node.outputs[0]

    def soft_combine(self, values):
        deepest = values[0]
        for value in values[1:]:
            deepest = self.math("MAXIMUM", deepest, value)
        total = None
        for value in values:
            cube = self.math("POWER", self.math("MAXIMUM", value, 0.0), 3.0)
            total = cube if total is None else self.math("ADD", total, cube)
        return self.math("ADD", self.math("POWER", total, 1 / 3), self.math("MINIMUM", deepest, 0.0))


def glow_field_group(glow):
    """
    glowDistance and glowAt from the tracer, for a point in the glowing block's own space:
    warm at the heart and low down, cooling to pink and violet towards the top and the skin.
    """
    group = bpy.data.node_groups.get("Glow Field") or bpy.data.node_groups.new("Glow Field", "ShaderNodeTree")
    group.nodes.clear()
    group.interface.clear()
    group.interface.new_socket("Vector", in_out="INPUT", socket_type="NodeSocketVector")
    group.interface.new_socket("Flatten", in_out="INPUT", socket_type="NodeSocketFloat")
    group.interface.new_socket("Distance", in_out="OUTPUT", socket_type="NodeSocketFloat")
    group.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    nodes = Nodes(group)
    group_input = nodes.add("NodeGroupInput")
    group_output = nodes.add("NodeGroupOutput")

    x_value, y_value, z_value = nodes.separate(group_input.outputs["Vector"])
    corner = glow["corner"]
    half = glow["thickness"] / 2
    fillet = glow["fillet"]

    def distance_at(depth_value):
        local_z = nodes.math("SUBTRACT", depth_value, glow["front"])
        local_x = nodes.math("SUBTRACT", x_value, nodes.math("MULTIPLY", local_z, SLANT_TAN))
        edges = []
        for normal_x, normal_y, offset in glow["planes"]:
            along = nodes.math(
                "ADD", nodes.math("MULTIPLY", local_x, normal_x), nodes.math("MULTIPLY", y_value, normal_y)
            )
            edges.append(nodes.math("ADD", along, corner - offset))
        outline = nodes.math("SUBTRACT", nodes.soft_combine(edges), corner)
        height = nodes.math("SUBTRACT", nodes.math("ABSOLUTE", nodes.math("ADD", local_z, half)), half)
        combined = nodes.soft_combine([nodes.math("ADD", outline, fillet), nodes.math("ADD", height, fillet)])
        return nodes.math("MULTIPLY", nodes.math("SUBTRACT", combined, fillet), 1 / math.sqrt(1 + SLANT_TAN**2))

    distance = distance_at(z_value)
    # The tracer takes each straight run's colour at its midpoint, the deepest and warmest
    # point, and applies it to the whole run. Flatten 1 does the same for rays crossing the
    # block front to back, by reading the colour on the block's middle plane.
    middle_plane = nodes.math(
        "ADD", z_value, nodes.math("MULTIPLY", group_input.outputs["Flatten"], nodes.math("SUBTRACT", glow["front"] - half, z_value))
    )
    color_distance = distance_at(middle_plane)

    depth = nodes.math("DIVIDE", nodes.math("MULTIPLY", color_distance, -1.0), 0.7, clamp=True)
    rise = nodes.math("DIVIDE", nodes.math("ADD", y_value, 2.5), 4.48, clamp=True)
    warmth = nodes.math(
        "ADD",
        nodes.math("ADD", nodes.math("MULTIPLY", depth, 0.55), nodes.math("MULTIPLY", nodes.math("SUBTRACT", 1.0, rise), 0.75)),
        -0.1,
        clamp=True,
    )
    color = nodes.mix_color(
        nodes.smoothstep(warmth, 0.0, 0.4), linear(SETTINGS["glowEdge"]), linear(SETTINGS["glowMid"])
    )
    color = nodes.mix_color(nodes.smoothstep(warmth, 0.45, 0.9), color, linear(SETTINGS["glowCore"]))
    brightness = nodes.math(
        "MULTIPLY", nodes.math("ADD", 0.5, nodes.math("MULTIPLY", nodes.math("MULTIPLY", warmth, warmth), 1.7)), SETTINGS["glowStrength"]
    )
    nodes.feed(group_output.inputs["Distance"], distance)
    nodes.feed(group_output.inputs["Color"], nodes.scale_vector(color, brightness))
    return group


def tidy(tree):
    """
    Lays nodes out in columns by how far they are from the output, so the graph reads left
    to right, and folds away the plain maths so the named nodes stand out.
    """
    feeds = {}
    for link in tree.links:
        feeds.setdefault(link.from_node.name, set()).add(link.to_node.name)
    depth = {}

    def depth_of(name, seen=()):
        if name in depth:
            return depth[name]
        targets = [target for target in feeds.get(name, ()) if target not in seen]
        value = 0 if not targets else 1 + max(depth_of(target, seen + (name,)) for target in targets)
        depth[name] = value
        return value

    columns = {}
    for node in tree.nodes:
        columns.setdefault(depth_of(node.name), []).append(node)
    for column, members in columns.items():
        top = 0.0
        for node in members:
            node.hide = node.bl_idname in ("ShaderNodeMath", "ShaderNodeVectorMath", "ShaderNodeSeparateXYZ") and not node.label
            node.location = (-column * 260.0, top)
            rows = 1 if node.hide else 2 + sum(socket.enabled and not socket.hide for socket in node.inputs) + len(node.outputs)
            top -= 40.0 + rows * 22.0


def fresh_material(name, light_source=False):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    material.node_tree.nodes.clear()
    # Only the softbox panels are lights. Spill and edge sheen glow where rays happen to land,
    # like in the tracer, instead of making every triangle of the base a light to sample.
    material.cycles.emission_sampling = "FRONT" if light_source else "NONE"
    return material, Nodes(material.node_tree)


def output_node(nodes):
    return nodes.add("ShaderNodeOutputMaterial", target="ALL")


def spill_emission(nodes, glow_object):
    """
    The glowing block's light pooling on the base and the page, like a lamp on a table.
    Art direction from the tracer: the path tracer finds this light too, but far too rarely.
    """
    coordinates = nodes.add("ShaderNodeTexCoord", object=glow_object)
    field = nodes.add("ShaderNodeGroup")
    field.node_tree = bpy.data.node_groups["Glow Field"]
    nodes.feed(field.inputs["Vector"], coordinates.outputs["Object"])
    falloff = nodes.math(
        "EXPONENT", nodes.math("DIVIDE", nodes.math("MAXIMUM", field.outputs["Distance"], 0.0), -SETTINGS["spillReach"])
    )
    return nodes.emission(field.outputs["Color"], nodes.math("MULTIPLY", falloff, SETTINGS["glowSpill"]))


def wall_weight(nodes, whole_wall=False):
    """
    How much a point is wall, seen from outside. The tracer's (1 - |normal.z|)² only reaches
    about 0.6 on a wall slanted 14°. whole_wall makes the entire side count, fading over the
    fillet, so a tone on the wall covers it evenly from top to bottom.
    """
    geometry = nodes.add("ShaderNodeNewGeometry")
    _, _, normal_z = nodes.separate(geometry.outputs["Normal"])
    wall = nodes.math("SUBTRACT", 1.0, nodes.math("ABSOLUTE", normal_z))
    outside = nodes.math("SUBTRACT", 1.0, geometry.outputs["Backfacing"])
    if whole_wall:
        return nodes.math("MULTIPLY", nodes.smoothstep(wall, 0.1, 0.6), outside)
    return nodes.math("MULTIPLY", nodes.math("MULTIPLY", wall, wall), outside)


def acrylic_surface(
    nodes,
    transmission_roughness,
    reflection_roughness,
    edge_shade,
    edge_light,
    shadow_tint,
    inside_roughness=None,
    wall_overlay=0.0,
):
    """
    Frosted acrylic with two finishes, like the tracer: rough refraction through a smoother
    reflection, chosen by Fresnel.
    """
    refraction = nodes.add("ShaderNodeBsdfRefraction", distribution="GGX", label="Frost")
    refraction.inputs["Roughness"].default_value = transmission_roughness
    refraction.inputs["IOR"].default_value = SETTINGS["ior"]
    glossy = nodes.add("ShaderNodeBsdfAnisotropic", distribution="GGX", label="Shine")
    glossy.inputs["Roughness"].default_value = reflection_roughness
    fresnel = nodes.add("ShaderNodeFresnel")
    fresnel.inputs["IOR"].default_value = SETTINGS["ior"]
    outside = nodes.mix_shader(fresnel.outputs[0], refraction.outputs[0], glossy.outputs[0])
    # From inside, the tracer reflects and refracts on the same frosted microfacet. A glass
    # closure keeps the light that total internal reflection traps, which is most of the glow.
    inside = nodes.add("ShaderNodeBsdfGlass", distribution="MULTI_GGX", label="Frost, seen from inside")
    inside.inputs["Roughness"].default_value = inside_roughness or transmission_roughness
    inside.inputs["IOR"].default_value = SETTINGS["ior"]
    facing = nodes.add("ShaderNodeNewGeometry")
    surface = nodes.mix_shader(facing.outputs["Backfacing"], outside, inside.outputs[0])

    wall = wall_weight(nodes)
    if edge_shade > 0:
        # Thick glass bends light away at its walls, so the rim reads darker. Art direction.
        black = nodes.emission((0.0, 0.0, 0.0), 0.0)
        shade = nodes.math("MULTIPLY", wall, edge_shade)
        shade.node.label = "Wall shade, darkens the walls"
        surface = nodes.mix_shader(shade, surface, black)
    if edge_light is not None:
        # A bounce card's sheen on the walls only, so they read as sides on a dark set
        sheen = nodes.emission(edge_light, wall)
        sheen.node.label = "Wall sheen (colour x brightness)"
        surface = nodes.add_shader(surface, sheen)
    if wall_overlay > 0:
        # A faint black over the whole side, evenly to its edge, so it reads as a side in shade
        black = nodes.emission((0.0, 0.0, 0.0), 0.0)
        overlay = nodes.math("MULTIPLY", wall_weight(nodes, whole_wall=True), wall_overlay)
        overlay.node.label = "Wall overlay, black"
        surface = nodes.mix_shader(overlay, surface, black)

    # The tracer lets the sun through the blocks, dimmed, instead of casting black shadows
    light_path = nodes.add("ShaderNodeLightPath")
    transparent = nodes.add("ShaderNodeBsdfTransparent")
    transparent.inputs["Color"].default_value = (*shadow_tint, 1.0)
    return nodes.mix_shader(light_path.outputs["Is Shadow Ray"], surface, transparent.outputs[0])


def glow_color(points):
    """glowAt from the tracer in numpy, for points in the glowing block's own space"""
    distance = block_distance(GLOW, points) / math.sqrt(1 + SLANT_TAN**2)
    depth = numpy.clip(-distance / 0.7, 0, 1)
    rise = numpy.clip((points[:, 1] + 2.5) / 4.48, 0, 1)
    warmth = numpy.clip(depth * 0.55 + (1 - rise) * 0.75 - 0.1, 0, 1)

    def smoothstep(low, high, value):
        amount = numpy.clip((value - low) / (high - low), 0, 1)
        return amount * amount * (3 - 2 * amount)

    edge, middle, core = (numpy.array(linear(SETTINGS[key])) for key in ("glowEdge", "glowMid", "glowCore"))
    color = edge + (middle - edge) * smoothstep(0, 0.4, warmth)[:, None]
    color = color + (core - color) * smoothstep(0.45, 0.9, warmth)[:, None]
    return color * (0.5 + 1.7 * warmth * warmth)[:, None] * SETTINGS["glowStrength"]


def glow_color_image(glow_object, resolution=1024):
    """The glow's colour on the block's middle plane, as a float texture over its outline"""
    corners = numpy.array([vertex.co[:2] for vertex in glow_object.data.vertices])
    low = corners.min(axis=0) - 0.05
    size = corners.max(axis=0) + 0.05 - low
    columns = (numpy.arange(resolution) + 0.5) / resolution
    grid_x, grid_y = numpy.meshgrid(low[0] + columns * size[0], low[1] + columns * size[1])
    middle = GLOW["front"] - GLOW["thickness"] / 2
    points = numpy.stack([grid_x.ravel(), grid_y.ravel(), numpy.full(grid_x.size, middle)], axis=1)
    color = glow_color(points)
    rgba = numpy.concatenate([color, numpy.ones((color.shape[0], 1))], axis=1).astype(numpy.float32)

    name = "Glow Colour"
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    image = bpy.data.images.new(name, resolution, resolution, alpha=False, float_buffer=True)
    image.colorspace_settings.name = "Linear Rec.709"
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    return image, low, size


def glow_texture(nodes, image, low, size, position):
    """The baked glow colour at a position in the block's own space"""
    offset = nodes.add("ShaderNodeVectorMath", operation="SUBTRACT")
    nodes.feed(offset.inputs[0], position)
    offset.inputs[1].default_value = (low[0], low[1], 0.0)
    across = nodes.add("ShaderNodeVectorMath", operation="DIVIDE")
    nodes.feed(across.inputs[0], offset.outputs[0])
    across.inputs[1].default_value = (size[0], size[1], 1.0)
    texture = nodes.add("ShaderNodeTexImage", image=image, interpolation="Linear", extension="EXTEND")
    nodes.feed(texture.inputs["Vector"], across.outputs[0])
    return texture.outputs["Color"]


def glow_material(glow_object):
    material, nodes = fresh_material("Glow Acrylic")
    output = output_node(nodes)
    # Inside: neutral absorption, milky scattering and the glow itself. Its colour only varies
    # across the block once it's read on the middle plane, so it's baked to a texture: the
    # volume samples it thousands of times per pixel, far too often for the node maths.
    image, low, size = glow_color_image(glow_object)

    surface = acrylic_surface(
        nodes,
        blender_roughness(SETTINGS["frost"]),
        blender_roughness(SETTINGS["polish"]),
        SETTINGS["edgeShade"],
        scaled(linear(SETTINGS["edgeColor"]), SETTINGS["edgeLight"]),
        (math.sqrt(0.5),) * 3,
        wall_overlay=BLENDER_WALL["overlay"],
    )
    nodes.tree.links.new(surface, output.inputs["Surface"])

    coordinates = nodes.add("ShaderNodeTexCoord")
    field_color = glow_texture(nodes, image, low, size, coordinates.outputs["Object"])
    absorption = nodes.add("ShaderNodeVolumeAbsorption", label="Glow absorption, higher is deeper")
    absorption.inputs["Density"].default_value = BLENDER_GLOW["absorption"]
    absorption.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    scatter = nodes.add("ShaderNodeVolumeScatter", label="Milkiness")
    scatter.inputs["Density"].default_value = SETTINGS["milkiness"]
    scatter.inputs["Anisotropy"].default_value = 0.0
    volume = nodes.add_shader(absorption.outputs[0], scatter.outputs[0])
    volume = nodes.add_shader(volume, nodes.emission(field_color, 1.0))
    nodes.tree.links.new(volume, output.inputs["Volume"])
    material.cycles.volume_sampling = "EQUIANGULAR"
    return material


def clear_material():
    material, nodes = fresh_material("Clear Acrylic")
    output = output_node(nodes)
    roughness = blender_roughness(SETTINGS["clearFrost"])
    surface = acrylic_surface(
        nodes,
        roughness,
        roughness,
        SETTINGS["clearEdgeShade"],
        None,
        (math.sqrt(0.85),) * 3,
        BLENDER_CLEAR["insideFrost"],
    )
    nodes.tree.links.new(surface, output.inputs["Surface"])

    # Absorption per world unit that turns white into the tint over one unit, times density
    absorption_rates = [-math.log(max(channel, 1e-4)) * SETTINGS["clearDensity"] for channel in linear(SETTINGS["clearTint"])]
    strongest = max(absorption_rates)
    absorption = nodes.add("ShaderNodeVolumeAbsorption", label="Tint")
    absorption.inputs["Density"].default_value = strongest
    absorption.inputs["Color"].default_value = (*[1 - rate / strongest for rate in absorption_rates], 1.0)
    scatter = nodes.add("ShaderNodeVolumeScatter", label="Haze")
    scatter.inputs["Density"].default_value = SETTINGS["clearHaze"]
    nodes.tree.links.new(nodes.add_shader(absorption.outputs[0], scatter.outputs[0]), output.inputs["Volume"])
    return material


def base_material(glow_object):
    """
    Dark satin. Reflects with a capped Fresnel, 0.04 + 0.5 (1 - cos)⁵, else diffuse plus
    the glow's spill, exactly the tracer's choice.
    """
    material, nodes = fresh_material("Base Satin")
    output = output_node(nodes)
    diffuse = nodes.add("ShaderNodeBsdfDiffuse", label="Base colour")
    diffuse.inputs["Color"].default_value = (*linear(SETTINGS["baseColor"]), 1.0)
    matte = nodes.add_shader(diffuse.outputs[0], spill_emission(nodes, glow_object))
    glossy = nodes.add("ShaderNodeBsdfAnisotropic", distribution="GGX", label="Base sheen")
    glossy.inputs["Roughness"].default_value = blender_roughness(SETTINGS["baseRoughness"])
    layer = nodes.add("ShaderNodeLayerWeight")
    layer.inputs["Blend"].default_value = 0.5
    grazing = nodes.math("POWER", layer.outputs["Facing"], 5.0)
    reflectance = nodes.math("ADD", nodes.math("MULTIPLY", grazing, 0.5), 0.04)
    nodes.tree.links.new(nodes.mix_shader(reflectance, matte, glossy.outputs[0]), output.inputs["Surface"])
    return material


def floor_material(glow_object):
    material, nodes = fresh_material("Page")
    output = output_node(nodes)
    diffuse = nodes.add("ShaderNodeBsdfDiffuse", label="Page colour")
    diffuse.inputs["Color"].default_value = (*linear(SETTINGS["floorColor"]), 1.0)
    nodes.tree.links.new(nodes.add_shader(diffuse.outputs[0], spill_emission(nodes, glow_object)), output.inputs["Surface"])
    return material


def panel_material(name, radiance, half_size, feather):
    """A feathered softbox like the tracer's, in tangent space across the panel"""
    material, nodes = fresh_material(name, light_source=True)
    output = output_node(nodes)
    coordinates = nodes.add("ShaderNodeTexCoord")
    across, up, _ = nodes.separate(coordinates.outputs["Object"])
    mask_across = nodes.smoothstep(nodes.math("ABSOLUTE", across), half_size[0] - feather, half_size[0] + feather, flip=True)
    mask_up = nodes.smoothstep(nodes.math("ABSOLUTE", up), half_size[1] - feather, half_size[1] + feather, flip=True)
    strength = max(radiance)
    color = tuple(channel / strength for channel in radiance)
    emission = nodes.emission(color, nodes.math("MULTIPLY", nodes.math("MULTIPLY", mask_across, mask_up), strength))
    nodes.tree.links.new(emission, output.inputs["Surface"])
    return material


# ---------------------------------------------------------------------------------------
# Scene


def scene_and_collection():
    scene = bpy.data.scenes.get(SCENE_NAME) or bpy.data.scenes.new(SCENE_NAME)
    for obj in list(scene.collection.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for child in list(scene.collection.children):
        scene.collection.children.unlink(child)
    for collection in list(bpy.data.collections):
        if collection.name.startswith("Glow ") and collection.users == 0:
            bpy.data.collections.remove(collection)
    return scene


def link_object(scene, name, data):
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return obj


def sun_direction():
    azimuth = math.radians(SETTINGS["sunAzimuth"])
    elevation = math.radians(SETTINGS["sunElevation"])
    return Vector(
        (math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation))
    )


def softbox_basis(axis):
    axis = axis.normalized()
    right = Vector((0, 0, 1)).cross(axis).normalized()
    up = axis.cross(right)
    return axis, right, up


def add_panel(scene, name, axis, half_size, feather, radiance):
    """A far emissive plane standing in for one of the tracer's direction-only softboxes"""
    axis, right, up = softbox_basis(axis)
    reach_x = half_size[0] + feather
    reach_y = half_size[1] + feather
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(
        [(-reach_x, -reach_y, 0), (reach_x, -reach_y, 0), (reach_x, reach_y, 0), (-reach_x, reach_y, 0)],
        [],
        [(0, 3, 2, 1)],
    )
    mesh.materials.append(panel_material(name, radiance, half_size, feather))
    panel = link_object(scene, name, mesh)
    basis = Matrix((right, up, axis)).transposed().to_4x4()
    panel.matrix_world = Matrix.Translation(axis * PANEL_DISTANCE) @ basis @ Matrix.Scale(PANEL_DISTANCE, 4)
    panel.visible_camera = False
    panel.visible_shadow = False
    return panel


def add_sun(scene, name, angle_degrees, receivers):
    """The sun as direct light only. Reflections see the softbox panels instead, as in the tracer."""
    light = bpy.data.lights.new(name, "SUN")
    # The tracer adds albedo x irradiance with no 1/pi, so its sun is pi times Blender's
    light.energy = SETTINGS["sunStrength"] * math.pi
    light.color = linear("#fdfaff")
    light.angle = math.radians(angle_degrees)
    sun = link_object(scene, name, light)
    sun.rotation_mode = "QUATERNION"
    sun.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(sun_direction())
    sun.visible_glossy = False
    sun.visible_transmission = False
    sun.visible_volume_scatter = False
    link_receivers(sun, name, receivers, "INCLUDE")
    return sun


def link_receivers(emitter, name, receivers, state):
    collection = bpy.data.collections.new(f"Glow {name} receivers")
    for receiver in receivers:
        collection.objects.link(receiver)
    emitter.light_linking.receiver_collection = collection
    for item in collection.collection_objects:
        item.light_linking.link_state = state


def designed_phase():
    """The loop phase where neither block has slid, so the icon matches the Figma layout"""
    middle = (SETTINGS["loopApart"] - SETTINGS["loopTogether"]) / 2
    swing = (SETTINGS["loopApart"] + SETTINGS["loopTogether"]) / 2
    return (math.asin(-middle / swing) / (2 * math.pi)) % 1


def loop_driver(obj, direction):
    """
    Slides a block along x: one sine from most overlapped to furthest apart and back, so the
    speed never jumps. Phase is the scene's loop_phase plus the frame over the loop's length,
    so frames 0 to LOOP_FRAMES - 1 play one seamless loop, and motion blur sees the movement.
    """
    middle = (SETTINGS["loopApart"] - SETTINGS["loopTogether"]) / 2
    swing = (SETTINGS["loopApart"] + SETTINGS["loopTogether"]) / 2
    driver = obj.driver_add("location", 0).driver
    driver.type = "SCRIPTED"
    variable = driver.variables.new()
    variable.name = "phase"
    variable.type = "SINGLE_PROP"
    variable.targets[0].id_type = "SCENE"
    variable.targets[0].id = obj.users_scene[0]
    variable.targets[0].data_path = '["loop_phase"]'
    driver.expression = (
        f"{direction} * ({middle:.6f} + {swing:.6f} * sin(2 * pi * (phase + frame / {LOOP_FRAMES})))"
    )


def build():
    scene = scene_and_collection()
    # Opens on the original logo, blocks where the Figma layout puts them
    scene["loop_phase"] = designed_phase()

    glow_planes, glow_center = edge_planes(GLOW_OUTLINE)
    clear_planes, clear_center = edge_planes(CLEAR_OUTLINE)
    global GLOW
    glow = GLOW = {
        "planes": glow_planes,
        "center": glow_center,
        "corner": SETTINGS["glowCorner"],
        "fillet": SETTINGS["glowFillet"],
        "thickness": SETTINGS["glowThickness"],
        "front": GLOW_FRONT,
    }
    clear = {
        "planes": clear_planes,
        "center": clear_center,
        "corner": SETTINGS["clearCorner"],
        "fillet": SETTINGS["clearFillet"],
        "thickness": SETTINGS["clearThickness"],
        "front": CLEAR_FRONT,
    }
    slab = {"fillet": min(SETTINGS["slabFillet"], SLAB_THICKNESS / 2)}

    glow_object = link_object(
        scene,
        "Glow Block",
        build_mesh("Glow Block", block_contour, glow, glow["front"], glow["thickness"], glow["fillet"], SLANT_TAN, block_distance, 512),
    )
    clear_object = link_object(
        scene,
        "Clear Block",
        build_mesh("Clear Block", block_contour, clear, clear["front"], clear["thickness"], clear["fillet"], SLANT_TAN, block_distance, 512),
    )
    base_object = link_object(
        scene,
        "Base",
        build_mesh("Base", slab_contour, slab, 0.0, SLAB_THICKNESS, slab["fillet"], 0.0, slab_distance, 768),
    )
    floor_mesh = bpy.data.meshes.new("Page")
    reach = PANEL_DISTANCE * 10
    floor_mesh.from_pydata(
        [(-reach, -reach, FLOOR_Z), (reach, -reach, FLOOR_Z), (reach, reach, FLOOR_Z), (-reach, reach, FLOOR_Z)], [], [(0, 1, 2, 3)]
    )
    floor_object = link_object(scene, "Page", floor_mesh)

    glow_field_group(glow)
    glow_object.data.materials.append(glow_material(glow_object))
    clear_object.data.materials.append(clear_material())
    base_object.data.materials.append(base_material(glow_object))
    floor_object.data.materials.append(floor_material(glow_object))

    for tree in [material.node_tree for material in bpy.data.materials if material.node_tree] + [
        bpy.data.node_groups["Glow Field"]
    ]:
        tidy(tree)

    loop_driver(glow_object, -1)
    loop_driver(clear_object, 1)

    # Direct sun, only on the base and the page like the tracer. Each sees it a different size, so shadows soften as they stretch.
    add_sun(scene, "Sun on Base", 2 * SETTINGS["baseShadowSoftness"], [base_object])
    add_sun(scene, "Sun on Page", 2 * SETTINGS["shadowSoftness"], [floor_object])

    # The sun as reflections see it, 5x the irradiance as radiance over a soft square
    sun_radiance = scaled(linear("#fdfaff"), SETTINGS["sunStrength"] * 5)
    sun_panel = add_panel(scene, "Sun Reflection", sun_direction(), (0.12, 0.12), 0.1, sun_radiance)
    link_receivers(sun_panel, "Sun Reflection", [base_object], "EXCLUDE")
    spread = SETTINGS["baseSunSpread"]
    # Art direction: the base reflects the sun broader and dimmer, so its edge gets a soft sheen
    wide_panel = add_panel(
        scene, "Sun Reflection on Base", sun_direction(), (0.12 * spread, 0.12 * spread), 0.1 * spread, scaled(sun_radiance, 1 / spread**2)
    )
    link_receivers(wide_panel, "Sun Reflection on Base", [base_object], "INCLUDE")
    add_panel(
        scene,
        "Violet Panel",
        Vector((0.75, -0.55, 0.35)),
        (0.7, 0.9),
        0.5,
        scaled(linear(SETTINGS["accentColor"]), SETTINGS["accentStrength"]),
    )

    # A dim cool room, brighter overhead
    world = bpy.data.worlds.get("Glow Room") or bpy.data.worlds.new("Glow Room")
    world.use_nodes = True
    world.node_tree.nodes.clear()
    nodes = Nodes(world.node_tree)
    world_output = nodes.add("ShaderNodeOutputWorld")
    coordinates = nodes.add("ShaderNodeTexCoord")
    _, _, direction_z = nodes.separate(coordinates.outputs["Generated"])
    overhead = nodes.math("ADD", nodes.math("MULTIPLY", direction_z, 0.25), 0.75)
    background = nodes.add("ShaderNodeBackground")
    background.inputs["Color"].default_value = (*scaled(linear("#b3a0f4"), SETTINGS["ambient"]), 1.0)
    nodes.feed(background.inputs["Strength"], overhead)
    world.node_tree.links.new(background.outputs[0], world_output.inputs["Surface"])
    scene.world = world
    tidy(world.node_tree)

    camera_data = bpy.data.cameras.new("Camera")
    camera_data.sensor_fit = "VERTICAL"
    camera_data.angle_y = math.radians(LENS_FOV)
    camera_data.clip_end = PANEL_DISTANCE * 20
    camera = link_object(scene, "Camera", camera_data)
    scene.camera = camera
    frame_icon(scene, 0.5)

    render_settings(scene, 1024, 1024, 256)
    scene.frame_start = 0
    scene.frame_end = LOOP_FRAMES - 1
    scene.frame_current = 0
    scene.render.fps = 30
    # Half the shutter, a whisper of blur at the fastest point of the slide
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5
    return scene


def frame_icon(scene, icon_share):
    """Fit the icon to a share of the frame's short side, like the tracer's size setting"""
    width = scene.render.resolution_x
    height = scene.render.resolution_y
    aspect = width / height
    visible_height = ICON_WORLD_SIZE / icon_share / min(aspect, 1)
    distance = visible_height / 2 / math.tan(math.radians(LENS_FOV / 2))
    scene.camera.location = (0.0, 0.0, distance)
    scene.camera.rotation_euler = (0.0, 0.0, 0.0)


def render_settings(scene, width, height, samples):
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    cycles = scene.cycles
    cycles.device = "GPU"
    cycles.samples = samples
    cycles.use_adaptive_sampling = True
    cycles.adaptive_threshold = 0.005
    cycles.use_denoising = True
    cycles.denoiser = "OPENIMAGEDENOISE"
    cycles.use_light_tree = True
    cycles.max_bounces = SETTINGS["bounces"]
    cycles.diffuse_bounces = SETTINGS["bounces"]
    cycles.glossy_bounces = SETTINGS["bounces"]
    cycles.transmission_bounces = SETTINGS["bounces"]
    cycles.volume_bounces = SETTINGS["bounces"]
    cycles.transparent_max_bounces = 32
    cycles.sample_clamp_direct = 16
    cycles.sample_clamp_indirect = 16
    cycles.blur_glossy = 0.0
    cycles.caustics_reflective = True
    cycles.caustics_refractive = True
    cycles.volume_step_rate = 1.0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.render.film_transparent = False
    # Renders started from inside Blender land with the others, not next to the scripts
    scene.render.filepath = "//../renders/blender/from-blender/frame-"


if __name__ == "__main__" or "__file__" not in globals():
    built = build()
    if bpy.context.window is not None:
        bpy.context.window.scene = built
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
