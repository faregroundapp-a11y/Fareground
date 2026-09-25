"""
Fareground logo -> every icon asset the app needs.

    python scripts/logo.py

The mark: an amber map pin with a ruby in its head, planted on a glowing
parcel of an isometric grid. "Claim a square of ground, find what's in it" -
the whole game in one picture. Drawn once here as SVG and rendered to each
size, so every icon stays in step. (The same shapes live in
src/components/Logo.tsx for use inside the app - change both together.)

HISTORY, so nobody redoes this by accident: on 2026-09-24 this mark was
replaced twice - first by a single cut gem, then by mineral parcels standing
on the grid at their in-game heights - and both were reverted at the product
owner's request. This original is what ships. The attempts are worth
remembering only for the traps they hit: three blocks in an ascending row read
as a bar chart, and cells placed along the main diagonal all share u - v = 0,
so they project to the same screen x and stack into one tower.

There is NO wordmark on the icon. The original did not have one and this is a
revert to it. The name is set live, large, in Nunito on the loading screen
instead - see src/components/LoadingScreen.tsx.
"""
import io
from pathlib import Path

import resvg_py
from PIL import Image

ASSETS = Path(__file__).resolve().parent.parent / 'assets'

BG_DARK, BG_MID, BG_LIGHT = '#143328', '#2F5D50', '#43806A'


def P(u, v):
    """A point on the isometric tile: u runs down-right, v down-left."""
    return (512 + 300 * u - 300 * v, 550 + 150 * u + 150 * v)


def poly(points):
    return ' '.join(f'{x:.1f},{y:.1f}' for x, y in points)


def art(mono=False):
    """The mark itself, on a 1024 canvas, bounding box ~ (212..812, 215..890)."""
    ink = '#FFFFFF'
    tile_top = ink if mono else 'url(#tile)'
    grid = []
    for i in (1, 2):
        t = i / 3
        a, b = P(t, 0), P(t, 1)
        c, d = P(0, t), P(1, t)
        grid.append(f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}"/>')
        grid.append(f'<line x1="{c[0]}" y1="{c[1]}" x2="{d[0]}" y2="{d[1]}"/>')
    cell = poly([P(1 / 3, 1 / 3), P(2 / 3, 1 / 3), P(2 / 3, 2 / 3), P(1 / 3, 2 / 3)])
    top = poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)])
    left = poly([P(0, 1), P(1, 1), (P(1, 1)[0], P(1, 1)[1] + 44), (P(0, 1)[0], P(0, 1)[1] + 44)])
    right = poly([P(1, 1), P(1, 0), (P(1, 0)[0], P(1, 0)[1] + 44), (P(1, 1)[0], P(1, 1)[1] + 44)])

    pin = ('M512 712 C 468 632 336 530 336 404 A 176 176 0 1 1 688 404 '
           'C 688 530 556 632 512 712 Z')

    if mono:
        # One flat colour, with the gem and grid cut out as holes.
        return f'''
        <mask id="m"><rect width="1024" height="1024" fill="white"/>
          <circle cx="512" cy="398" r="112" fill="black"/>
          <g stroke="black" stroke-width="12">{''.join(grid)}</g>
        </mask>
        <g mask="url(#m)" fill="{ink}">
          <polygon points="{top}"/><polygon points="{left}"/><polygon points="{right}"/>
          <path d="{pin}"/>
        </g>
        <polygon points="447,352 577,352 612,388 512,478 412,388" fill="{ink}"/>
        '''

    return f'''
    <!-- the ground: an isometric slab of parcel grid -->
    <polygon points="{left}" fill="#1E4638"/>
    <polygon points="{right}" fill="#173A2E"/>
    <polygon points="{top}" fill="{tile_top}"/>
    <g stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="6" stroke-linecap="round">{''.join(grid)}</g>
    <!-- footsteps across the grid, walking up to the claimed square -->
    {footsteps()}
    <!-- the claimed square glows -->
    <polygon points="{cell}" fill="#FFC968" opacity="0.35" filter="url(#glow)"/>
    <polygon points="{cell}" fill="url(#cell)"/>
    <!-- pin shadow -->
    <ellipse cx="512" cy="712" rx="64" ry="22" fill="#000" opacity="0.28"/>
    <!-- the pin -->
    <path d="{pin}" fill="url(#pin)"/>
    <path d="M512 712 C 556 632 688 530 688 404 A 176 176 0 0 0 600 252 C 650 300 660 360 652 420 C 640 520 560 620 512 712 Z"
          fill="#B8741A" opacity="0.35"/>
    <path d="M392 330 A 150 150 0 0 1 500 238" stroke="#FFF1CF" stroke-width="16" stroke-linecap="round" fill="none" opacity="0.7"/>
    <!-- the find: a faceted ruby in the pin's head -->
    <circle cx="512" cy="398" r="118" fill="#FFF6E2"/>
    <circle cx="512" cy="398" r="118" fill="none" stroke="#E7B25A" stroke-width="6"/>
    <polygon points="447,352 577,352 612,388 512,478 412,388" fill="#C0304A"/>
    <polygon points="447,352 482,388 412,388" fill="#E4566E"/>
    <polygon points="482,388 542,388 512,352 447,352" fill="#EE7086"/>
    <polygon points="512,352 542,388 577,352" fill="#D8435C"/>
    <polygon points="542,388 612,388 577,352" fill="#A62540"/>
    <polygon points="412,388 482,388 512,478" fill="#D23A55"/>
    <polygon points="482,388 542,388 512,478" fill="#B0283F"/>
    <polygon points="542,388 612,388 512,478" fill="#8C1C31"/>
    <polygon points="462,360 490,360 478,378" fill="#FFFFFF" opacity="0.75"/>
    <!-- sparkles -->
    <path d="M742 236 l12 34 34 12 -34 12 -12 34 -12 -34 -34 -12 34 -12z" fill="#FFF6E2"/>
    <path d="M292 290 l7 20 20 7 -20 7 -7 20 -7 -20 -20 -7 20 -7z" fill="#FFF6E2" opacity="0.8"/>
    '''


def footsteps():
    """Alternating footprints along the tile's left diagonal, toward the centre."""
    out = []
    steps = [(0.16, 0.86, -1), (0.24, 0.74, 1), (0.30, 0.60, -1)]
    for i, (u, v, side) in enumerate(steps):
        x, y = P(u, v)
        x += side * 16
        o = 0.5 + 0.18 * i
        # squashed to lie flat on the isometric ground
        out.append(
            f'<g transform="translate({x:.1f} {y:.1f}) scale(1 0.55) rotate(-38)" fill="#FFF6E2" opacity="{o:.2f}">'
            '<ellipse cx="0" cy="0" rx="13" ry="20"/><ellipse cx="0" cy="-30" rx="10" ry="9"/></g>'
        )
    return ''.join(out)


DEFS = f'''
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{BG_LIGHT}"/><stop offset="0.55" stop-color="{BG_MID}"/><stop offset="1" stop-color="{BG_DARK}"/>
  </linearGradient>
  <radialGradient id="shine" cx="0.3" cy="0.22" r="0.7">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6FB08F"/><stop offset="1" stop-color="#3E7F63"/>
  </linearGradient>
  <linearGradient id="cell" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFD37A"/><stop offset="1" stop-color="#F2A93B"/>
  </linearGradient>
  <linearGradient id="pin" x1="0" y1="0" x2="0.6" y2="1">
    <stop offset="0" stop-color="#FFD27A"/><stop offset="0.5" stop-color="#F6AE3E"/><stop offset="1" stop-color="#DC8C1F"/>
  </linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
</defs>'''


def svg(background, scale, mono=False, rounded=False):
    bg = ''
    if background:
        r = 'rx="230"' if rounded else ''
        bg = f'<rect width="1024" height="1024" {r} fill="url(#bg)"/><rect width="1024" height="1024" {r} fill="url(#shine)"/>'
    # Centre the art's bounding box (centre ~ 512,553) on the canvas.
    g = f'<g transform="translate(512 512) scale({scale}) translate(-512 -553)">{art(mono)}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{DEFS}{bg}{g}</svg>'


def render(svg_text, size, name, mode='RGBA'):
    png = bytes(resvg_py.svg_to_bytes(svg_string=svg_text, width=size, height=size))
    im = Image.open(io.BytesIO(png)).convert(mode)
    im.save(ASSETS / name, optimize=True)
    return im


def background_only():
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{DEFS}'
            '<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#shine)"/></svg>')


if __name__ == '__main__':
    # iOS / store icon: full-bleed square, no transparency (the OS rounds it).
    render(svg(True, 0.88), 1024, 'icon.png', 'RGB')
    # Android adaptive icon: art inside the 66/108 safe circle, separate layers.
    render(svg(False, 0.82), 1024, 'android-icon-foreground.png')
    render(background_only(), 1024, 'android-icon-background.png', 'RGB')
    render(svg(False, 0.82, mono=True), 1024, 'android-icon-monochrome.png')
    # Splash: the mark alone; the splash background colour comes from app.json.
    render(svg(False, 0.86), 1024, 'splash-icon.png')
    render(svg(True, 0.88, rounded=True), 48, 'favicon.png')
    # A rounded preview, for looking at.
    render(svg(True, 0.88, rounded=True), 512, '../scripts/logo-preview.png')
    print('icons written to', ASSETS)
