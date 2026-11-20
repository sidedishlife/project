"""스티커 원본(stickers-src/*.png)의 흰 배경을 지우고, 여백을 잘라, 앱용 작은 webp로 만든다.

사용법: python3 scripts/make-stickers.py
결과: src/stickers/<이름>.webp  (앱이 자동으로 찾아 씀)

원리: 가장자리에서부터 '거의 흰색' 픽셀만 따라 채워 들어가면 스티커 둘레의 얇은 회색 칼선에서 멈춘다.
그 바깥만 투명하게 만들기 때문에 강아지의 흰 털은 지워지지 않는다.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SRC = Path(__file__).resolve().parent.parent / 'stickers-src'
OUT = Path(__file__).resolve().parent.parent / 'src' / 'stickers'
SIZE = 440  # 긴 변 픽셀 (화면 200px x 2배 해상도 정도)
WHITE = 244  # 세 채널이 모두 이 값 이상이면 배경 후보
GAP = 15  # 칼선 틈을 메우는 두께(px)


def cut(path: Path) -> Image.Image:
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    # 칼선(조금이라도 흰색이 아닌 픽셀)을 두껍게 만들어 칼선의 작은 틈을 메운다
    barrier = Image.new('L', (w, h), 0)
    bp = barrier.load()
    for y in range(h):
        for x in range(w):
            if min(px[x, y]) < WHITE:
                bp[x, y] = 255
    barrier = barrier.filter(ImageFilter.MaxFilter(GAP))
    bp = barrier.load()
    cand = Image.new('L', (w, h), 0)
    cp = cand.load()
    for y in range(h):
        for x in range(w):
            if bp[x, y] == 0:
                cp[x, y] = 255
    # 가장자리 모든 점에서 채우기
    for x in range(0, w, 8):
        for y in (0, h - 1):
            if cp[x, y] == 255:
                ImageDraw.floodfill(cand, (x, y), 128)
    for y in range(0, h, 8):
        for x in (0, w - 1):
            if cp[x, y] == 255:
                ImageDraw.floodfill(cand, (x, y), 128)
    bg = cand.point(lambda v: 255 if v == 128 else 0)
    # 칼선을 두껍게 한 만큼 배경을 다시 넓혀 원래 칼선에 맞춘다
    bg = bg.filter(ImageFilter.MaxFilter(GAP - 2))
    alpha = bg.point(lambda v: 0 if v else 255).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert('RGBA')
    out.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 20 else 0).getbbox()
    out = out.crop(bbox)
    out.thumbnail((SIZE, SIZE), Image.LANCZOS)
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for p in sorted(SRC.glob('*.png')):
        img = cut(p)
        dst = OUT / f'{p.stem}.webp'
        img.save(dst, 'WEBP', quality=82, method=6)
        kept = sum(1 for a in img.getchannel('A').get_flattened_data() if a > 20) / (img.width * img.height)
        print(f'{p.stem:10s} {img.size} {dst.stat().st_size // 1024}KB  채움 {kept:.0%}')


if __name__ == '__main__':
    main()
