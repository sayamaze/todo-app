"""绘制「日程待办」应用图标：扁平蓝底圆角矩形 + 白色勾选/清单行图形"""
from PIL import Image, ImageDraw

S = 1024  # 画布
M = 96    # 图标主体边距
R = 210   # 圆角半径（macOS 风格）

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 主体：极轻微的纵向渐变（两档蓝色，远看仍是扁平纯色）
TOP = (59, 130, 246)    # #3B82F6
BOT = (37, 99, 235)     # #2563EB
body = Image.new("RGBA", (S - 2 * M, S - 2 * M))
bd = ImageDraw.Draw(body)
h = body.height
for y in range(h):
    t = y / h
    c = tuple(round(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3)) + (255,)
    bd.line([(0, y), (body.width, y)], fill=c)

# 圆角蒙版
mask = Image.new("L", body.size, 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, body.width - 1, body.height - 1], radius=R, fill=255)
img.paste(body, (M, M), mask)

d = ImageDraw.Draw(img)
WHITE = (255, 255, 255, 255)
BLUE = BOT + (255,)

def rounded_bar(x0, y0, x1, y1, w):
    """圆头横条"""
    d.line([(x0, y0), (x1, y1)], fill=WHITE, width=w)
    r = w // 2
    d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=WHITE)
    d.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=WHITE)

def check(cx, cy, s, w, color):
    """对勾，(cx,cy) 为中心，s 为尺寸"""
    pts = [(cx - 0.42 * s, cy + 0.02 * s), (cx - 0.10 * s, cy + 0.32 * s), (cx + 0.45 * s, cy - 0.30 * s)]
    d.line(pts, fill=color, width=w, joint="curve")
    r = w // 2
    for px, py in pts:
        d.ellipse([px - r, py - r, px + r, py + r], fill=color)

# 第一行：实心白圆 + 蓝色对勾 + 长清单条
c1x, c1y, c1r = 356, 408, 78
d.ellipse([c1x - c1r, c1y - c1r, c1x + c1r, c1y + c1r], fill=WHITE)
check(c1x, c1y, 78, 26, BLUE)
rounded_bar(500, c1y, 736, c1y, 52)

# 第二行：白色描边圆环 + 短清单条
c2x, c2y, c2r, ring = 356, 616, 70, 34
d.ellipse([c2x - c2r, c2y - c2r, c2x + c2r, c2y + c2r], outline=WHITE, width=ring)
rounded_bar(500, c2y, 668, c2y, 52)

img.save("/Users/vivo/Desktop/AI探索/日程待办APP/app/build/icon.png")
print("saved 1024px icon")
