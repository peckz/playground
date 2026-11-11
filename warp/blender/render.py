"""
Headless render of the Glow Icon scene, finished with the tracer's own output curve
(exposure, contrast on the peak channel, a hue-keeping shoulder, sRGB), so the two compare.

  Blender -b frosted.blend -P render.py -- <out.png> [size=768] [samples=256] [icon share=0.5] [phase=the saved one, the original layout] [denoise=1]
  Grain shading: add --grain <amount> (about 0.06) for illustration-style grain in the mid-tones.
  Viewport look: add --blender-look to keep Blender's own colour output instead of the tracer curve;
  with few samples and denoise 0 it keeps the preview's natural grain.
  Fast video: add --fast for a looser noise threshold, fewer volume bounces and no reflective
  caustics. Persistent data and GPU denoise are always on, they don't change the look.
  Cooler: add --rest <seconds> to pause after every frame (4 runs the GPU at about 80%).
  Timing: add --fps <rate> and/or --loop <seconds> (the saved loop is 4 s at 30 fps).
  Eased loop: add --ease to replace the sine with one breath out and back, see eased_loop().
  Frames: add --frames <first> <last> and <out> becomes a folder of frame-0001.png... for
  scene frames first to last. Phase is then the scene's loop_phase plus the frame's place in the loop.
"""

import math
import os
import struct
import sys
import time
import zlib

import bpy
import numpy

ARGUMENTS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
EXPOSURE = 0.6
CONTRAST = 1.2
SHOULDER = 0.85
MIDDLE_GREY = 0.18
LENS_FOV = 5
ICON_WORLD_SIZE = 8.24


def write_png(path, pixels):
    """pixels: height x width x 3 uint8, top row first"""
    height, width, _ = pixels.shape
    raw = b"".join(b"\x00" + pixels[row].tobytes() for row in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with open(path, "wb") as file:
        file.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def grain_shading(srgb, amount, seed=7):
    """
    Illustration-style grain: fine monochrome noise that lives in the shading, strongest in
    the mid-tones where gradients turn, fading out in highlights and in deep black.
    A new seed per video frame makes it live like film grain instead of dust on the lens.
    """
    lightness = srgb.mean(axis=2, keepdims=True)
    shading = numpy.clip(4 * lightness * (1 - lightness), 0, 1) ** 0.75
    noise = numpy.random.default_rng(seed).standard_normal(srgb.shape[:2])[..., None]
    return srgb + noise * shading * amount


def tone_map(linear_pixels, grain=0.0, seed=7):
    color = linear_pixels * EXPOSURE
    peak = color.max(axis=2, keepdims=True)
    safe = numpy.maximum(peak, 1e-9)
    color = numpy.where(peak > 0, color * (MIDDLE_GREY * (safe / MIDDLE_GREY) ** CONTRAST / safe), color)
    peak = color.max(axis=2, keepdims=True)
    headroom = 1 - SHOULDER
    over = numpy.maximum(peak - SHOULDER, 0)
    squeezed = (SHOULDER + headroom * over / (over + headroom)) / numpy.maximum(peak, 1e-9)
    color = numpy.where(peak > SHOULDER, color * squeezed, color)
    color = numpy.maximum(color, 0)
    srgb = numpy.where(color <= 0.0031308, color * 12.92, 1.055 * color ** (1 / 2.4) - 0.055)
    if grain > 0:
        srgb = grain_shading(srgb, grain, seed)
    noise = numpy.random.default_rng(1).random(srgb.shape[:2])[..., None]
    return numpy.clip(numpy.round(srgb * 255 + noise - 0.5), 0, 255).astype(numpy.uint8)


def frame_icon(scene, icon_share):
    aspect = scene.render.resolution_x / scene.render.resolution_y
    visible_height = ICON_WORLD_SIZE / icon_share / min(aspect, 1)
    scene.camera.location = (0.0, 0.0, visible_height / 2 / math.tan(math.radians(LENS_FOV / 2)))
    # An orthographic camera is perfectly frontal: it sees no sliver of top or bottom edges
    scene.camera.data.ortho_scale = visible_height


def finish_exr(exr, path, grain=0.0, seed=7):
    """Linear EXR to the tracer-curve PNG, then drop the EXR"""
    image = bpy.data.images.load(exr)
    width, height = image.size
    pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    os.remove(exr)
    linear = pixels.reshape(height, width, 4)[::-1, :, :3]
    write_png(path, tone_map(linear, grain, seed))


def render_to(scene, path, grain=0.0, blender_look=False, seed=7):
    if blender_look:
        # Blender's own colour output, exactly as the viewport preview shows it
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_depth = "8"
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        return
    exr = path + ".exr"
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    finish_exr(exr, path, grain, seed)


def rest_between_frames(seconds):
    """
    Pause after every frame so the GPU cools down: about 15 s of work and 4 s of rest runs it
    at about 80%, which keeps the fans calm on a long overnight render.
    """

    def rest(scene, *arguments):
        time.sleep(seconds)

    bpy.app.handlers.render_post.append(rest)


def render_frames(scene, out, first, last, grain=0.0, blender_look=False):
    """
    One animation render, so Cycles keeps the scene, BVH and textures warm between frames
    instead of rebuilding them for each one. Frames already on disk are skipped, so a
    stopped render picks up where it left off. The tone curve runs once all frames are in.
    """
    os.makedirs(out, exist_ok=True)
    scene.frame_start = first
    scene.frame_end = last
    scene.render.use_overwrite = False
    scene.render.use_placeholder = False
    if blender_look:
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_depth = "8"
        scene.render.filepath = os.path.join(out, "frame-")
        bpy.ops.render.render(animation=True)
        return
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.filepath = os.path.join(out, "linear-")
    pending = []
    for frame in range(first, last + 1):
        png = os.path.join(out, f"frame-{frame + 1:04d}.png")
        if not os.path.exists(png):
            pending.append((frame, png))
    if not pending:
        return
    bpy.ops.render.render(animation=True)
    for frame, png in pending:
        finish_exr(os.path.join(out, f"linear-{frame:04d}.exr"), png, grain, seed=frame)
        print(f"frame {frame + 1} done", flush=True)


def go_fast(scene):
    """
    Video settings that cost time but barely show in motion: a looser noise threshold,
    fewer volume bounces (the milkiness is thin), no reflective caustics.
    """
    scene.cycles.adaptive_threshold = 0.015
    scene.cycles.volume_bounces = 3
    scene.cycles.caustics_reflective = False


def cubic_bezier(x1, y1, x2, y2, progress):
    """CSS-style cubic-bezier: progress through time to progress along the move"""
    low, high = 0.0, 1.0
    for _ in range(60):
        middle = (low + high) / 2
        inverse = 1 - middle
        time = 3 * inverse * inverse * middle * x1 + 3 * inverse * middle * middle * x2 + middle**3
        if time < progress:
            low = middle
        else:
            high = middle
    middle = (low + high) / 2
    inverse = 1 - middle
    return 3 * inverse * inverse * middle * y1 + 3 * inverse * middle * middle * y2 + middle**3


# After Effects style ease, 85% influence out and 70% in: a very slow creep out of rest
# (14% of the move after 0.8 s), a smooth speed-up, a long soft landing. No overshoot.
BREATH = (0.85, 0.0, 0.3, 1.0)
APART = 0.6
TOGETHER = 0.19


def eased_loop(scene):
    """
    One breath: from most overlapped the blocks ease out, sweep apart fast and settle, then
    come back the same way. Both ends land at rest, so the loop joins without a seam.
    Keyed on every frame, so motion blur follows the curve.
    """
    length = scene.frame_end - scene.frame_start + 1
    half = length / 2
    glow = bpy.data.objects["Glow Block"]
    clear = bpy.data.objects["Clear Block"]
    for block in (glow, clear):
        block.driver_remove("location", 0)
    # Straight lines between the per-frame keys, so nothing but the curve shapes the move
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    for frame in range(scene.frame_start, scene.frame_end + 2):
        local = (frame - scene.frame_start) % length
        if local <= half:
            amount = cubic_bezier(*BREATH, local / half)
        else:
            amount = 1 - cubic_bezier(*BREATH, (local - half) / half)
        spread = -TOGETHER + (APART + TOGETHER) * amount
        glow.location.x = -spread
        clear.location.x = spread
        for block in (glow, clear):
            block.keyframe_insert("location", index=0, frame=frame)


def set_timing(scene, fps, seconds=None):
    """
    Frame rate and loop length: the drivers count the loop in frames (frame / 120 at 30 fps),
    so set that count and the scene's end together. Without seconds the loop keeps its length.
    The shutter is a share of a frame, so motion blur keeps the same look per frame.
    """
    old_length = scene.frame_end - scene.frame_start + 1
    if seconds is None:
        seconds = old_length / scene.render.fps
    new_length = round(seconds * fps)
    for name in ("Glow Block", "Clear Block"):
        block = bpy.data.objects[name]
        if not block.animation_data:
            continue
        for curve in block.animation_data.drivers:
            curve.driver.expression = curve.driver.expression.replace(f"frame / {old_length}", f"frame / {new_length}")
    scene.render.fps = fps
    scene.frame_end = scene.frame_start + new_length - 1


def scene_phase():
    """The phase saved in the file, which opens on the original logo layout"""
    return bpy.data.scenes["Glow Icon"]["loop_phase"]


def main():
    ease = "--ease" in ARGUMENTS
    if ease:
        ARGUMENTS.remove("--ease")
    fast = "--fast" in ARGUMENTS
    if fast:
        ARGUMENTS.remove("--fast")
    blender_look = "--blender-look" in ARGUMENTS
    if blender_look:
        ARGUMENTS.remove("--blender-look")
    grain = 0.0
    if "--grain" in ARGUMENTS:
        index = ARGUMENTS.index("--grain")
        grain = float(ARGUMENTS[index + 1])
        del ARGUMENTS[index : index + 2]
    rest = 0.0
    if "--rest" in ARGUMENTS:
        index = ARGUMENTS.index("--rest")
        rest = float(ARGUMENTS[index + 1])
        del ARGUMENTS[index : index + 2]
    seconds = None
    if "--loop" in ARGUMENTS:
        index = ARGUMENTS.index("--loop")
        seconds = float(ARGUMENTS[index + 1])
        del ARGUMENTS[index : index + 2]
    fps = None
    if "--fps" in ARGUMENTS:
        index = ARGUMENTS.index("--fps")
        fps = int(ARGUMENTS[index + 1])
        del ARGUMENTS[index : index + 2]
    frames = None
    if "--frames" in ARGUMENTS:
        index = ARGUMENTS.index("--frames")
        frames = [int(value) for value in ARGUMENTS[index + 1 : index + 3]]
        del ARGUMENTS[index : index + 3]
    out = ARGUMENTS[0]
    size = ARGUMENTS[1] if len(ARGUMENTS) > 1 else "768"
    samples = int(ARGUMENTS[2]) if len(ARGUMENTS) > 2 else 256
    icon_share = float(ARGUMENTS[3]) if len(ARGUMENTS) > 3 else 0.5
    phase = float(ARGUMENTS[4]) if len(ARGUMENTS) > 4 else scene_phase()
    denoise = ARGUMENTS[5] != "0" if len(ARGUMENTS) > 5 else True

    scene = bpy.data.scenes["Glow Icon"]
    width, _, height = size.partition("x")
    scene.render.resolution_x = int(width)
    scene.render.resolution_y = int(height or width)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = denoise
    frame_icon(scene, icon_share)

    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.refresh_devices()
    for device in preferences.devices:
        device.use = device.type == "METAL"
    scene.cycles.device = "GPU"
    # Free speed, same look: keep the scene loaded between frames, denoise on the GPU
    scene.render.use_persistent_data = True
    scene.cycles.denoising_use_gpu = True
    if fast:
        go_fast(scene)

    scene["loop_phase"] = phase
    if fps or seconds:
        set_timing(scene, fps or scene.render.fps, seconds)
    if ease:
        eased_loop(scene)
    if frames is None:
        scene.render.use_motion_blur = False
        scene.frame_set(0)
        render_to(scene, out, grain, blender_look)
        return
    if rest > 0:
        rest_between_frames(rest)
    render_frames(scene, out, frames[0], frames[1], grain, blender_look)


main()
