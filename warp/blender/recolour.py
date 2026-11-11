"""
Recolours the glow with a palette, in memory only (nothing is saved): rebakes the Glow Colour
image that the block and the Glow Lamp read, smooths it like smooth_glow.py, and sets the
Glow Field's colours. Runs before render.py; render_set.py passes the palette.

  GLOW_PALETTE='{"glowCore": "#3ee8c8", "glowMid": "#1fa2ff", "glowEdge": "#5a4dff"}' \
    Blender -b frosted.blend -P recolour.py -P render.py -- <render.py arguments>
"""

import importlib.util
import json
import os

import bpy
import numpy

HERE = os.path.dirname(os.path.abspath(__file__))
SOFTNESS = 0.3


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bake(build_scene, image, low, size):
    """The tracer's glowAt on the block's middle plane, over the area the texture covers"""
    planes, center = build_scene.edge_planes(build_scene.GLOW_OUTLINE)
    build_scene.GLOW = {
        "planes": planes,
        "center": center,
        "corner": build_scene.SETTINGS["glowCorner"],
        "fillet": build_scene.SETTINGS["glowFillet"],
        "thickness": build_scene.SETTINGS["glowThickness"],
        "front": build_scene.GLOW_FRONT,
    }
    width, height = image.size
    columns = (numpy.arange(width) + 0.5) / width
    rows = (numpy.arange(height) + 0.5) / height
    grid_x, grid_y = numpy.meshgrid(low[0] + columns * size[0], low[1] + rows * size[1])
    middle = build_scene.GLOW["front"] - build_scene.GLOW["thickness"] / 2
    points = numpy.stack([grid_x.ravel(), grid_y.ravel(), numpy.full(grid_x.size, middle)], axis=1)
    return build_scene.glow_color(points).reshape(height, width, 3)


def recolour(palette):
    build_scene = load("build_scene")
    smooth_glow = load("smooth_glow")
    build_scene.SETTINGS.update(palette)

    tree = bpy.data.materials["Glow Acrylic"].node_tree
    low = tree.nodes["Vector Math"].inputs[1].default_value
    size = tree.nodes["Vector Math.001"].inputs[1].default_value
    image = bpy.data.images["Glow Colour"]
    width, height = image.size
    color = bake(build_scene, image, low, size)
    color = smooth_glow.gaussian_blur(color, SOFTNESS / size[0] * width, SOFTNESS / size[1] * height)
    pixels = numpy.concatenate([color, numpy.ones((height, width, 1))], axis=2).astype(numpy.float32)
    image.pixels.foreach_set(pixels.ravel())
    image.update()

    # The painted spill reads these. It is off in the file, but stays in tune if it comes back.
    field = bpy.data.node_groups["Glow Field"]
    for node_name, socket_name, key in (("Mix", "A", "glowEdge"), ("Mix", "B", "glowMid"), ("Mix.001", "B", "glowCore")):
        for socket in field.nodes[node_name].inputs:
            if socket.name == socket_name and socket.type == "RGBA":
                socket.default_value = (*build_scene.linear(palette[key]), 1.0)


palette_json = os.environ.get("GLOW_PALETTE")
if palette_json:
    recolour(json.loads(palette_json))
