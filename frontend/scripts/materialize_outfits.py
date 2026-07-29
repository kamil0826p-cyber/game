from PIL import Image, ImageDraw
from pathlib import Path
import json

# One-time repository materializer. This file removes itself after committing the generated assets.
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets' / 'sprites'
OUT.mkdir(parents=True, exist_ok=True)
LEVELS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
CATALOG = {
    'MAGE': ['mage-apprentice', 'mage-scholar', 'mage-evoker', 'mage-archmage', 'mage-illusionist', 'mage-elementalist', 'mage-runekeeper', 'mage-starcaller', 'mage-chronomancer', 'mage-voidseer', 'mage-ascendant'],
    'WARRIOR': ['warrior-recruit', 'warrior-guard', 'warrior-vanguard', 'warrior-champion', 'warrior-berserker', 'warrior-templar', 'warrior-warlord', 'warrior-dreadnought', 'warrior-kingsguard', 'warrior-titan', 'warrior-immortal'],
    'ARCHER': ['archer-scout', 'archer-hunter', 'archer-pathfinder', 'archer-ranger', 'archer-sharpshooter', 'archer-beaststalker', 'archer-windrunner', 'archer-nightstalker', 'archer-warden', 'archer-legend', 'archer-starshot'],
}
PALETTES = {
    'MAGE': [('#315fa8','#7347a8','#7de3ff','#4d2d73','#e7bb91'),('#e6dcc4','#345b9a','#d9b85e','#5c3b27','#edc39a'),('#932943','#3e1f55','#ff714f','#2a1729','#dca87e'),('#342363','#7d40b6','#f4cb52','#e4e6ff','#e5b488'),('#167b7a','#6750a2','#8ef3e5','#27314d','#d7a77d'),('#603923','#28718a','#ffb84e','#633c2a','#e0ae82'),('#596273','#252a38','#8ac6ff','#b7b9ca','#d8a47d'),('#141b48','#44318c','#f5f1a2','#d7d9ee','#e0b087'),('#89919e','#765524','#9ee8ff','#594c42','#dfad85'),('#17121f','#57401f','#c38eff','#d5c6bd','#d9a67d'),('#f4f0dc','#7a5ae0','#fff2a2','#ffffff','#edc79d')],
    'WARRIOR': [('#7c8797','#8e3540','#d9e2eb','#5b3728','#e5b085'),('#8292aa','#274b7a','#d4dbe8','#754629','#e6b186'),('#4f5968','#6e3030','#aeb8c5','#3b281e','#dca87f'),('#9d7425','#7d192d','#f3d672','#2f1b18','#d89e72'),('#70402f','#3c302a','#d5b17b','#532d22','#ce946d'),('#ddd5ba','#9b7a30','#fff1b5','#563a26','#e5af82'),('#30333d','#8c2430','#b4b8c5','#302019','#d9a279'),('#434852','#20242d','#bfc8d3','#30251f','#d8a17a'),('#17191e','#967231','#f0cf72','#3a281e','#dda77d'),('#59606c','#39274a','#d3bdf5','#2d211d','#d6a078'),('#d4d8df','#5c3ea4','#f7efb3','#f0f2ff','#e6b48a')],
    'ARCHER': [('#3e7652','#704b2e','#b8d790','#8a5a2f','#edba8e'),('#66543a','#315b3e','#c8b477','#4d3020','#dfaa80'),('#6d7a62','#60452d','#ccd8b0','#6e4527','#e4b186'),('#1f5f62','#26333a','#6ee7c4','#d1b06c','#dca779'),('#3b4856','#6f3f2e','#b9d7e8','#4b3023','#e0ad83'),('#66503b','#314b36','#d3b57b','#5a3927','#dca77c'),('#a4b9ad','#39716b','#e1f2dd','#ad7d45','#e5b188'),('#171c25','#263449','#7089b5','#25201d','#d49e74'),('#22573b','#8a6a31','#cce8a7','#68452a','#e0aa7f'),('#816425','#243e34','#f2d67b','#c09b5d','#deb083'),('#24304f','#6c3db9','#a8e8ff','#e8e3ff','#ebbd92')],
}

def px(draw, x, y, w, h, color): draw.rectangle((x, y, x + w - 1, y + h - 1), fill=color)
def poly(draw, points, color): draw.polygon(points, fill=color)
def line(draw, points, color, width=1): draw.line(points, fill=color, width=width)

def draw_frame(image, character_class, style, column, row, palette):
    draw = ImageDraw.Draw(image)
    ox, oy = column * 32, row * 48
    primary, secondary, accent, hair, skin = palette
    bob = 1 if column in (1, 3) else 0
    stride = -1 if column == 1 else 1 if column == 3 else 0
    south, west, north = row == 0, row == 1, row == 3
    outline, steel = '#12131a', '#b9c3d0'
    draw.ellipse((ox + 8, oy + 39, ox + 24, oy + 46), fill=(4, 5, 10, 105))
    px(draw, ox + 10 + stride, oy + 34 + bob, 5, 10, outline); px(draw, ox + 17 - stride, oy + 34 + bob, 5, 10, outline)
    px(draw, ox + 11 + stride, oy + 35 + bob, 3, 8, secondary); px(draw, ox + 18 - stride, oy + 35 + bob, 3, 8, secondary)
    if style in (3, 6, 8, 9, 10):
        cape = secondary if style != 10 else '#6d47ce'
        poly(draw, [(ox+9,oy+20+bob),(ox+23,oy+20+bob),(ox+25,oy+39+bob),(ox+7,oy+39+bob)], outline)
        poly(draw, [(ox+10,oy+21+bob),(ox+22,oy+21+bob),(ox+23,oy+38+bob),(ox+9,oy+38+bob)], cape)
    if character_class == 'MAGE':
        width = 18 if style in (5, 7, 9, 10) else 16
        poly(draw, [(ox+16-width//2,oy+18+bob),(ox+16+width//2,oy+18+bob),(ox+24,oy+39+bob),(ox+8,oy+39+bob)], outline)
        poly(draw, [(ox+17-width//2,oy+19+bob),(ox+15+width//2,oy+19+bob),(ox+22,oy+38+bob),(ox+10,oy+38+bob)], primary)
        px(draw, ox+10, oy+27+bob, 12, 3, secondary)
        if style in (2, 5): px(draw, ox+14, oy+20+bob, 4, 16, accent)
        if style in (6, 8): px(draw, ox+9, oy+23+bob, 3, 4, steel); px(draw, ox+20, oy+23+bob, 3, 4, steel)
        if style in (7, 9, 10): px(draw, ox+12, oy+23+bob, 2, 2, accent); px(draw, ox+18, oy+29+bob, 2, 2, accent)
    elif character_class == 'WARRIOR':
        shoulder = 4 if style < 5 else 6 if style < 8 else 7
        px(draw, ox+7-shoulder//2, oy+20+bob, 9+shoulder, 6, outline); px(draw, ox+16, oy+20+bob, 9+shoulder//2, 6, outline)
        px(draw, ox+8-shoulder//2, oy+21+bob, 8+shoulder, 4, accent); px(draw, ox+17, oy+21+bob, 7+shoulder//2, 4, accent)
        px(draw, ox+9, oy+23+bob, 14, 15, outline); px(draw, ox+10, oy+24+bob, 12, 13, primary)
        if style % 3 == 0: px(draw, ox+13, oy+24+bob, 6, 13, secondary)
        else:
            px(draw, ox+11, oy+27+bob, 10, 3, secondary)
            if style >= 6: px(draw, ox+14, oy+24+bob, 4, 13, accent)
    else:
        poly(draw, [(ox+9,oy+20+bob),(ox+23,oy+20+bob),(ox+21,oy+39+bob),(ox+11,oy+39+bob)], outline)
        poly(draw, [(ox+10,oy+21+bob),(ox+22,oy+21+bob),(ox+20,oy+38+bob),(ox+12,oy+38+bob)], primary)
        px(draw, ox+11, oy+27+bob, 10, 3, secondary)
        if style in (1, 5, 7, 9): poly(draw, [(ox+9,oy+21+bob),(ox+4,oy+38+bob),(ox+12,oy+35+bob)], secondary)
        if style in (4, 8, 10): px(draw, ox+9, oy+23+bob, 3, 12, accent)
    px(draw, ox+7, oy+22+bob, 4, 12, outline); px(draw, ox+21, oy+22+bob, 4, 12, outline)
    px(draw, ox+8, oy+23+bob, 3, 9, primary); px(draw, ox+21, oy+23+bob, 3, 9, primary)
    px(draw, ox+8, oy+32+bob, 3, 3, skin); px(draw, ox+21, oy+32+bob, 3, 3, skin)
    px(draw, ox+12, oy+9+bob, 10, 12, outline); px(draw, ox+13, oy+10+bob, 8, 10, skin)
    mode = style % 6
    if mode == 0:
        px(draw, ox+11, oy+7+bob, 12, 6, hair); px(draw, ox+12, oy+12+bob, 2, 4, hair); px(draw, ox+21, oy+12+bob, 2, 4, hair)
    elif mode == 1:
        poly(draw, [(ox+9,oy+14+bob),(ox+16,oy+4+bob),(ox+24,oy+14+bob),(ox+22,oy+21+bob),(ox+10,oy+21+bob)], primary); px(draw, ox+13, oy+8+bob, 6, 3, secondary)
    elif mode == 2:
        px(draw, ox+10, oy+6+bob, 13, 8, accent); px(draw, ox+8, oy+12+bob, 17, 3, accent)
        if character_class == 'WARRIOR': poly(draw, [(ox+15,oy+6+bob),(ox+18,oy+1+bob),(ox+20,oy+7+bob)], secondary)
    elif mode == 3:
        px(draw, ox+11, oy+6+bob, 12, 7, hair); px(draw, ox+10, oy+12+bob, 14, 3, accent)
        if character_class == 'MAGE': poly(draw, [(ox+13,oy+6+bob),(ox+18,oy+1+bob),(ox+21,oy+6+bob)], primary)
    elif mode == 4:
        poly(draw, [(ox+10,oy+15+bob),(ox+12,oy+7+bob),(ox+20,oy+5+bob),(ox+23,oy+14+bob),(ox+21,oy+20+bob),(ox+11,oy+20+bob)], secondary); px(draw, ox+13, oy+9+bob, 7, 3, hair)
    else:
        px(draw, ox+10, oy+7+bob, 13, 6, hair); poly(draw, [(ox+10,oy+7+bob),(ox+13,oy+2+bob),(ox+15,oy+7+bob),(ox+18,oy+1+bob),(ox+20,oy+7+bob),(ox+23,oy+3+bob),(ox+23,oy+12+bob),(ox+10,oy+12+bob)], accent)
    if north: px(draw, ox+12, oy+12+bob, 10, 9, hair)
    elif south: px(draw, ox+15, oy+14+bob, 1, 1, outline); px(draw, ox+19, oy+14+bob, 1, 1, outline)
    weapon_x = ox + 5 if west else ox + 27
    if character_class == 'MAGE':
        line(draw, [(weapon_x,oy+14),(weapon_x,oy+42)], '#70482b', 2)
        radius = 3 if style < 6 else 4
        draw.ellipse((weapon_x-radius,oy+9-radius,weapon_x+radius,oy+9+radius), fill=accent, outline=outline)
        if style in (5,7,9,10): draw.ellipse((weapon_x-1,oy+8,weapon_x+1,oy+10), fill='#ffffff')
    elif character_class == 'WARRIOR':
        line(draw, [(weapon_x,oy+15),(weapon_x,oy+41)], accent, 3 if style >= 7 else 2); px(draw, weapon_x-4, oy+31, 9, 2, secondary)
        if style >= 6: poly(draw, [(weapon_x-3,oy+15),(weapon_x,oy+8),(weapon_x+3,oy+15)], accent)
        if style in (4,7,10):
            shield_x = ox+5 if not west else ox+27
            draw.ellipse((shield_x-5,oy+23,shield_x+5,oy+35), fill=secondary, outline=accent)
    else:
        line(draw, [(weapon_x,oy+15),(weapon_x+(6 if west else -6),oy+28),(weapon_x,oy+42)], '#8e5d34', 2)
        line(draw, [(weapon_x,oy+15),(weapon_x,oy+42)], accent, 1)
        if style >= 4: px(draw, ox+13, oy+7+bob, 7, 3, primary)
        if style in (8,9,10):
            quiver_x = ox+5 if west else ox+24
            px(draw, quiver_x, oy+20, 3, 17, secondary); line(draw, [(quiver_x+1,oy+20),(quiver_x+1,oy+15)], accent, 1)

def materialize():
    for old in OUT.glob('*.png'):
        old.unlink()
    outfits = {}
    for character_class, keys in CATALOG.items():
        for index, key in enumerate(keys):
            sheet = Image.new('RGBA', (128, 192), (0, 0, 0, 0))
            for row in range(4):
                for column in range(4):
                    draw_frame(sheet, character_class, index, column, row, PALETTES[character_class][index])
            sheet.save(OUT / f'{key}.png', optimize=True)
            outfits[key] = {
                'image': f'/assets/sprites/{key}.png?v=6', 'frameWidth': 32, 'frameHeight': 48,
                'columns': 4, 'rows': 4, 'framesPerDirection': 4, 'frameDurationMs': 120,
                'directionRows': {'SOUTH': 0, 'WEST': 1, 'EAST': 2, 'NORTH': 3},
                'characterClass': character_class, 'unlockLevel': LEVELS[index],
            }
    manifest_path = ROOT / 'public' / 'assets' / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['version'] = 6
    manifest['outfits'] = outfits
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')

if __name__ == '__main__':
    materialize()
