#!/usr/bin/env python3
"""重新生成 README 的「皮肤一览」目录（只替换标记之间的内容）。

README 顶部的安装说明、权限与风险、兼容性等段落是手写的，脚本不碰它们；只把
`<!-- skins:start -->` 与 `<!-- skins:end -->` 之间替换成按系列分组的全部皮肤，
因此重新生成不会覆盖手写文案，也不会写回任何外部仓库地址。

分组顺序与 README 一致：先游戏 IP 系列，再经典配色 / 美学风格 / 节日限定 /
系统复古 / 彩蛋 / 其他游戏。分组取自皮肤名（角色皮肤以系列名开头）与标签，
不依赖 aionui-themes 本地副本。

用法（仓库根目录）：python3 tools/build_readme.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKINS = os.path.join(ROOT, "skins")
README = os.path.join(ROOT, "README.md")
START = "<!-- skins:start -->"
END = "<!-- skins:end -->"

# README 里的分组顺序；不在名单里的分组排在后面
SERIES_ORDER = [
    "绝区零", "超级马里奥", "塞尔达传说", "宝可梦", "迪士尼", "街头霸王",
    "原神", "崩坏星穹铁道", "经典配色", "美学风格", "节日限定", "系统复古",
    "彩蛋", "其他游戏",
]

# 游戏 IP 系列：角色皮肤名统一以系列名开头（如「原神 · 胡桃」）
NAME_SERIES = [
    "绝区零", "超级马里奥", "塞尔达传说", "宝可梦", "街头霸王", "原神",
    "崩坏星穹铁道",
]
# 迪士尼两款角色皮肤没有统一前缀
NAME_ALIASES = {"唐老鸭": "迪士尼", "米老鼠": "迪士尼"}


def series_of(meta):
    """按名字前缀 / 标签归类，结果与 README 现有分组一致。"""
    name = meta.get("name", "")
    for series in NAME_SERIES:
        if name.startswith(series):
            return series
    if name in NAME_ALIASES:
        return NAME_ALIASES[name]
    tags = meta.get("tags") or []
    first = tags[0] if tags else "其他"
    return "其他游戏" if first == "游戏" else first


def load_skins():
    """读取 skins/<id>/skin.json；目录名作为 id 的后备值。"""
    skins = []
    for sid in sorted(os.listdir(SKINS)):
        path = os.path.join(SKINS, sid, "skin.json")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fh:
            meta = json.load(fh)
        meta.setdefault("id", sid)
        skins.append(meta)
    return skins


def render(skins, eol):
    """渲染全部 <details> 分组，返回正文、皮肤数与分组名。"""
    groups = {name: [] for name in SERIES_ORDER}
    for meta in skins:
        groups.setdefault(series_of(meta), []).append(meta)

    blocks = []
    for name, metas in groups.items():
        if not metas:
            continue
        rows = [
            f"| **{m['name']}**<br>`{m['id']}` "
            f"| ![{m['name']} 浅色](skins/{m['id']}/preview/light.png) "
            f"| ![{m['name']} 深色](skins/{m['id']}/preview/dark.png) |"
            for m in sorted(metas, key=lambda x: x["id"])
        ]
        blocks.append(eol.join([
            f"<details open><summary><b>{name}</b>（{len(metas)} 个）</summary>",
            "",
            "| 皮肤 | 浅色预览 | 深色预览 |",
            "|---|---|---|",
            *rows,
            "</details>",
        ]))
    return eol + (eol * 2).join(blocks) + eol * 2, len(skins), [n for n in groups if groups[n]]


def main():
    with open(README, "rb") as fh:
        text = fh.read().decode("utf-8")
    start = text.find(START)
    end = text.find(END, start + len(START)) if start >= 0 else -1
    if start < 0 or end < 0:
        sys.exit(f"README.md 缺少 {START} / {END} 标记，未修改")

    eol = "\r\n" if "\r\n" in text else "\n"
    payload, total, names = render(load_skins(), eol)
    updated = text[: start + len(START)] + payload + text[end:]
    with open(README, "wb") as fh:
        fh.write(updated.encode("utf-8"))
    print(f"README.md: {total} skins / {len(names)} groups regenerated")


if __name__ == "__main__":
    main()
