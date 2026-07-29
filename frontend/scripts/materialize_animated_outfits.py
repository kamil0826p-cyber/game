from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets' / 'sprites'
OUT.mkdir(parents=True, exist_ok=True)

CATALOG = {
    'MAGE': ['mage-apprentice','mage-scholar','mage-evoker','mage-archmage','mage-illusionist','mage-elementalist','mage-runekeeper','mage-starcaller','mage-chronomancer','mage-voidseer','mage-ascendant'],
    'WARRIOR': ['warrior-recruit','warrior-guard','warrior-vanguard','warrior-champion','warrior-berserker','warrior-templar','warrior-warlord','warrior-dreadnought','warrior-kingsguard','warrior-titan','warrior-immortal'],
    'ARCHER': ['archer-scout','archer-hunter','archer-pathfinder','archer-ranger','archer-sharpshooter','archer-beaststalker','archer-windrunner','archer-nightstalker','archer-warden','archer-legend','archer-starshot'],
}
PALETTES = {
    'MAGE': [('#315fa8','#7347a8','#7de3ff','#4d2d73'),('#e6dcc4','#345b9a','#d9b85e','#5c3b27'),('#932943','#3e1f55','#ff714f','#2a1729'),('#342363','#7d40b6','#f4cb52','#e4e6ff'),('#167b7a','#6750a2','#8ef3e5','#27314d'),('#603923','#28718a','#ffb84e','#633c2a'),('#596273','#252a38','#8ac6ff','#b7b9ca'),('#141b48','#44318c','#f5f1a2','#d7d9ee'),('#89919e','#765524','#9ee8ff','#594c42'),('#17121f','#57401f','#c38eff','#d5c6bd'),('#f4f0dc','#7a5ae0','#fff2a2','#ffffff')],
    'WARRIOR': [('#7c8797','#8e3540','#d9e2eb','#5b3728'),('#8292aa','#274b7a','#d4dbe8','#754629'),('#4f5968','#6e3030','#aeb8c5','#3b281e'),('#9d7425','#7d192d','#f3d672','#2f1b18'),('#70402f','#3c302a','#d5b17b','#532d22'),('#ddd5ba','#9b7a30','#fff1b5','#563a26'),('#30333d','#8c2430','#b4b8c5','#302019'),('#434852','#20242d','#bfc8d3','#30251f'),('#17191e','#967231','#f0cf72','#3a281e'),('#59606c','#39274a','#d3bdf5','#2d211d'),('#d4d8df','#5c3ea4','#f7efb3','#f0f2ff')],
    'ARCHER': [('#3e7652','#704b2e','#b8d790','#8a5a2f'),('#66543a','#315b3e','#c8b477','#4d3020'),('#6d7a62','#60452d','#ccd8b0','#6e4527'),('#1f5f62','#26333a','#6ee7c4','#d1b06c'),('#3b4856','#6f3f2e','#b9d7e8','#4b3023'),('#66503b','#314b36','#d3b57b','#5a3927'),('#a4b9ad','#39716b','#e1f2dd','#ad7d45'),('#171c25','#263449','#7089b5','#25201d'),('#22573b','#8a6a31','#cce8a7','#68452a'),('#816425','#243e34','#f2d67b','#c09b5d'),('#24304f','#6c3db9','#a8e8ff','#e8e3ff')],
}

def rect(x,y,w,h,color,extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{color}"{extra}/>'
def polygon(points,color):
    return f'<polygon points="{points}" fill="{color}"/>'
def ellipse(cx,cy,rx,ry,color,extra=''):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}"{extra}/>'
def path(d,color,width=1):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"/>'

def body(character_class):
    parts = []
    if character_class == 'MAGE':
        parts += [polygon('8,19 24,19 24,39 8,39','#11141b'),polygon('10,20 22,20 22,38 10,38','var(--p)'),rect(10,27,12,3,'var(--s)')]
    elif character_class == 'WARRIOR':
        parts += [rect(5,20,12,6,'var(--a)',' stroke="#11141b"'),rect(16,20,12,6,'var(--a)',' stroke="#11141b"'),rect(9,23,14,15,'#11141b'),rect(10,24,12,13,'var(--p)'),rect(13,24,6,13,'var(--s)')]
    else:
        parts += [polygon('9,20 23,20 21,39 11,39','#11141b'),polygon('10,21 22,21 20,38 12,38','var(--p)'),rect(11,27,10,3,'var(--s)')]
    parts += [rect(7,22,4,12,'#11141b'),rect(21,22,4,12,'#11141b'),rect(8,23,3,9,'var(--p)'),rect(21,23,3,9,'var(--p)'),rect(8,32,3,3,'#e4ad82'),rect(21,32,3,3,'#e4ad82'),rect(12,9,10,12,'#11141b'),rect(13,10,8,10,'#e4ad82'),rect(15,14,1,1,'#11141b'),rect(19,14,1,1,'#11141b')]
    if character_class == 'MAGE':
        parts += [path('M27 14V42','#70482b',2),ellipse(27,10,3,3,'var(--a)')]
    elif character_class == 'WARRIOR':
        parts += [path('M27 15V41','var(--a)',2),rect(23,31,9,2,'var(--s)')]
    else:
        parts += [path('M27 15Q21 28 27 42','#8e5d34',2),path('M27 15V42','var(--a)',1)]
    return ''.join(parts)

def headgear(style):
    mode = style % 6
    return [
        rect(11,7,12,6,'var(--h)'),
        polygon('9,14 16,4 24,14 22,21 10,21','var(--p)') + rect(13,8,6,3,'var(--s)'),
        rect(10,6,13,8,'var(--a)') + rect(8,12,17,3,'var(--a)'),
        rect(11,6,12,7,'var(--h)') + rect(10,12,14,3,'var(--a)'),
        polygon('10,15 12,7 20,5 23,14 21,20 11,20','var(--s)') + rect(13,9,7,3,'var(--h)'),
        rect(10,7,13,6,'var(--h)') + polygon('10,7 13,2 15,7 18,1 20,7 23,3 23,12 10,12','var(--a)'),
    ][mode]

def legs(direction, frame):
    bob = (0,1,0,1)[frame]
    step = (0,-2,0,2)[frame]
    parts = [ellipse(16,43,8 + (frame % 2),3,'#05070a',' opacity=".5"')]
    if direction in ('SOUTH','NORTH'):
        left, right = 10 + step, 17 - step
        parts += [rect(left,34+bob,5,9,'#11141b'),rect(right,34+bob,5,9,'#11141b'),rect(left+1,35+bob,3,7,'var(--s)'),rect(right+1,35+bob,3,7,'var(--s)')]
    else:
        front, back = 10 + step // 2, 16 - step // 2
        parts += [rect(back,35+bob,5,8,'#11141b',' opacity=".75"'),rect(front,33+bob,5,10,'#11141b'),rect(back+1,36+bob,3,6,'var(--s)',' opacity=".8"'),rect(front+1,34+bob,3,8,'var(--s)')]
    return ''.join(parts)

def sprite_sheet(character_class, key, style):
    primary, secondary, accent, hair = PALETTES[character_class][style]
    defs = [f'<g id="body">{body(character_class)}</g>', f'<g id="headgear">{headgear(style)}</g>']
    for direction in ('SOUTH','WEST','EAST','NORTH'):
        for frame in range(4):
            defs.append(f'<g id="legs-{direction}-{frame}">{legs(direction, frame)}</g>')
    output = ['<svg xmlns="http://www.w3.org/2000/svg" width="128" height="192" viewBox="0 0 128 192" shape-rendering="crispEdges">','<defs>',*defs,'</defs>',f'<g style="--p:{primary};--s:{secondary};--a:{accent};--h:{hair}">']
    for row, direction in enumerate(('SOUTH','WEST','EAST','NORTH')):
        for frame in range(4):
            bob = (0,1,0,1)[frame]
            lean = (0,-1,0,1)[frame]
            side = ' translate(2 0) scale(.875 1)' if direction == 'WEST' else ' translate(30 0) scale(-.875 1)' if direction == 'EAST' else ''
            output += [f'<g data-direction="{direction}" data-frame="{frame}" transform="translate({frame*32} {row*48})">',f'<use href="#legs-{direction}-{frame}"/>',f'<g transform="translate({lean} {bob}){side}"><use href="#body"/><use href="#headgear"/>']
            if direction == 'NORTH': output.append(rect(12,12,10,9,'var(--h)'))
            if style >= 8: output.append(rect(14,30,4,2,'var(--a)'))
            if style == 10: output.append(ellipse(16,18,10,13,'var(--a)',' opacity=".1"'))
            output += ['</g></g>']
    output += ['</g></svg>']
    return ''.join(output)

def main():
    for character_class, keys in CATALOG.items():
        for style, key in enumerate(keys):
            (OUT / f'{key}.svg').write_text(sprite_sheet(character_class, key, style), encoding='utf-8')
    atlas = OUT / 'outfits-atlas.svg'
    if atlas.exists():
        atlas.unlink()

if __name__ == '__main__':
    main()
