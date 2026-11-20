#!/usr/bin/env python3
"""Compact the pixel icons in index.html without changing a single rendered pixel.

Each <symbol> is drawn as hundreds of 1-px-high <rect>s with a fill each. This script paints them in order onto a grid
(a later rect covers an earlier one), covers each colour's pixels with as few rectangles as it easily can (runs along
rows merged down the columns, or runs along columns merged across, whichever gives fewer), and writes one
<g fill="colour"> of plain <rect>s per colour.

Why rects and not one <path> per colour: Chrome honours shape-rendering="crispEdges" on <rect> by snapping each edge
to the nearest device pixel, but still anti-aliases a <path>, so at the sizes the app draws icons (e.g. a 21-unit icon
at 16 px) paths come out blurred. Snapped rect edges have a useful property: two rects that share an edge snap that
edge to the same pixel, so a rect and the two rects it replaces fill exactly the same pixels at any size.

Symbols that aren't plain integer <rect x y width height fill>s (already compacted ones, i-logo, which js/main.js fills
at runtime) are left as they are, so running it twice changes nothing.

  python3 tools/compact_icons.py            rewrite index.html in place
  python3 tools/compact_icons.py --dry-run  only print the sizes
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "..", "index.html")
SYMBOL = re.compile(r'(<symbol\b[^>]*>)(.*?)(</symbol>)', re.S)
RECT = re.compile(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-fA-F]{3,8})"\s*/>')
SKIP = {"i-logo"}


def grid_of(body):
    """{(x, y): colour} with paint order respected, or None if the symbol isn't only plain integer fill rects."""
    if not body.strip() or RECT.sub("", body).strip():
        return None
    grid = {}
    for x, y, w, h, fill in RECT.findall(body):
        x, y, w, h = int(x), int(y), int(w), int(h)
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                grid[(xx, yy)] = fill.lower()
    return grid


def cover_rows(pixels):
    """Non-overlapping rectangles (x, y, w, h) covering the pixels: runs along each row, merged downward while the
    next row has a run with the same start and width."""
    runs = {}
    for x, y in sorted(pixels, key=lambda p: (p[1], p[0])):
        row = runs.setdefault(y, [])
        if row and row[-1][0] + row[-1][1] == x:
            row[-1][1] += 1
        else:
            row.append([x, 1])
    done, growing = [], {}
    for y in sorted(runs):
        nxt = {}
        for x, w in runs[y]:
            r = growing.pop((x, w), None)
            if r and r[1] + r[3] == y:
                r[3] += 1
            else:
                if r:
                    done.append(r)
                r = [x, y, w, 1]
            nxt[(x, w)] = r
        done.extend(growing.values())
        growing = nxt
    done.extend(growing.values())
    return sorted(tuple(r) for r in done)


def cover(pixels):
    by_rows = cover_rows(pixels)
    by_cols = [(x, y, w, h) for y, x, h, w in cover_rows({(y, x) for x, y in pixels})]  # same, on the transposed grid
    return by_rows if len(by_rows) <= len(by_cols) else sorted(by_cols)


def compact(body):
    grid = grid_of(body)
    if grid is None:
        return None
    by_colour = {}
    for p, c in grid.items():
        by_colour.setdefault(c, set()).add(p)
    order = list(dict.fromkeys(f.lower() for *_, f in RECT.findall(body)))  # colours by first appearance
    return "".join(f'<g fill="{c}">' + "".join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}"/>' for x, y, w, h in cover(by_colour[c]))
                   + "</g>" for c in order if c in by_colour)


def main():
    src = open(INDEX, encoding="utf-8").read()
    stats = {"symbols": 0, "before": 0, "after": 0}

    def sub(m):
        sid = re.search(r'id="([^"]+)"', m.group(1))
        if sid and sid.group(1) in SKIP:
            return m.group(0)
        new = compact(m.group(2))
        if new is None:
            return m.group(0)
        stats["symbols"] += 1
        stats["before"] += len(RECT.findall(m.group(2)))
        stats["after"] += new.count("<rect")
        return m.group(1) + new + m.group(3)

    out = SYMBOL.sub(sub, src)
    print(f"index.html: {len(src.encode()):,} -> {len(out.encode()):,} bytes; {stats['symbols']} symbols compacted, "
          f"{stats['before']:,} -> {stats['after']:,} rects")
    if "--dry-run" not in sys.argv and out != src:
        with open(INDEX + ".tmp", "w", encoding="utf-8") as f:
            f.write(out)
        os.replace(INDEX + ".tmp", INDEX)


if __name__ == "__main__":
    main()
