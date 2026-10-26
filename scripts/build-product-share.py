"""生成固定产品分享封面；仅包含品牌与固定用途，不读取用户数据。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 2
FONT = Path("C:/Windows/Fonts/msyh.ttc")
if not FONT.exists():
    raise SystemExit("需要 Microsoft YaHei 字体：C:/Windows/Fonts/msyh.ttc")

image = Image.new("RGB", (1000 * SCALE, 800 * SCALE), "#f7f6f2")
draw = ImageDraw.Draw(image)


def box(values):
    return tuple(int(value * SCALE) for value in values)


def line(points, fill, width=2):
    draw.line([box(point) for point in points], fill=fill, width=width * SCALE,
              joint="curve")


def text(position, content, size, color, bold=False):
    font_path = FONT.with_name("msyhbd.ttc") if bold else FONT
    font = ImageFont.truetype(str(font_path), size * SCALE)
    draw.text(box(position), content, font=font, fill=color)


# 延续暖纸、靛蓝、金色灵光与翻开书页的品牌形状。
draw.rounded_rectangle(box((150, 100, 232, 182)), radius=20 * SCALE, fill="#34377f")
draw.polygon([box(p) for p in [(163, 128), (191, 137), (191, 164), (163, 155)]], fill="#fff5dc")
draw.polygon([box(p) for p in [(191, 137), (219, 128), (219, 155), (191, 164)]], fill="#ffffff")
line([(191, 138), (191, 164)], "#d7b76d", 2)
draw.polygon([box(p) for p in [(196, 109), (200, 119), (210, 123), (200, 127), (196, 137), (192, 127), (182, 123), (192, 119)]], fill="#e4a83a")
text((255, 112), "灵感拾光簿", 38, "#34377f", bold=True)

text((150, 268), "随手记录灵感", 68, "#191a23", bold=True)
text((150, 368), "手动整理成稿", 68, "#34377f", bold=True)
line([(150, 522), (850, 522)], "#d7d4cb", 2)
text((150, 566), "记录  ·  补充  ·  选材整理", 33, "#5f6070")
text((150, 627), "把一闪念，慢慢整理成可用的文字", 28, "#5f6070")

target = ROOT / "miniprogram/assets/product-share.png"
image.resize((1000, 800), Image.Resampling.LANCZOS).save(target, optimize=True)
print(f"{target}: {target.stat().st_size} bytes")
