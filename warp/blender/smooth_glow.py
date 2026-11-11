"""
Smooths the baked Glow Colour image so the glow's colours blend softly around the corners.

The colour comes from the distance to the nearest edge, which folds into sharp diagonal
creases from each corner (where the nearest edge switches sides). A Gaussian blur, round in
world units, melts those creases and keeps the overall gradient.

  Blender -b frosted.blend -P smooth_glow.py -- [softness=0.3] [--save]
  softness is the blur radius (sigma) in world units; the block is about 3.9 x 4.6.
"""

import sys

import bpy
import numpy

ARGUMENTS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def gaussian_blur(channels, sigma_x, sigma_y):
    """Blur height x width x channels with reflected edges, via the Fourier transform"""
    pad_y = int(3 * sigma_y) + 1
    pad_x = int(3 * sigma_x) + 1
    padded = numpy.pad(channels, ((pad_y, pad_y), (pad_x, pad_x), (0, 0)), mode="reflect")
    height, width, _ = padded.shape
    frequency_y = numpy.fft.fftfreq(height)[:, None]
    frequency_x = numpy.fft.rfftfreq(width)[None, :]
    transfer = numpy.exp(-2 * (numpy.pi**2) * ((frequency_y * sigma_y) ** 2 + (frequency_x * sigma_x) ** 2))
    blurred = numpy.empty_like(padded)
    for channel in range(padded.shape[2]):
        spectrum = numpy.fft.rfft2(padded[:, :, channel])
        blurred[:, :, channel] = numpy.fft.irfft2(spectrum * transfer, s=(height, width))
    return blurred[pad_y : pad_y + channels.shape[0], pad_x : pad_x + channels.shape[1]]


def smooth_glow(softness):
    image = bpy.data.images["Glow Colour"]
    width, height = image.size
    tree = bpy.data.materials["Glow Acrylic"].node_tree
    world_size = tree.nodes["Vector Math.001"].inputs[1].default_value
    pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(height, width, 4)
    sigma_x = softness / world_size[0] * width
    sigma_y = softness / world_size[1] * height
    pixels[:, :, :3] = gaussian_blur(pixels[:, :, :3], sigma_x, sigma_y)
    image.pixels.foreach_set(pixels.ravel())
    image.pack()


def main():
    save = "--save" in ARGUMENTS
    if save:
        ARGUMENTS.remove("--save")
    softness = float(ARGUMENTS[0]) if ARGUMENTS else 0.3
    smooth_glow(softness)
    if save:
        bpy.ops.wm.save_mainfile()


if __name__ == "__main__":
    main()
