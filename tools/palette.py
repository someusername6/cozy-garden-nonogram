"""Color palette optimization for nonogram puzzles."""

import math
from pathlib import Path
from PIL import Image

from models import EMPTY


def color_distance(c1: tuple[int, int, int], c2: tuple[int, int, int]) -> float:
    """
    Calculate perceptual color distance between two RGB colors.

    Uses weighted Euclidean distance that accounts for human perception
    (we're more sensitive to green, less to blue).
    """
    r1, g1, b1 = c1
    r2, g2, b2 = c2

    # Weighted RGB distance (approximate perceptual)
    rmean = (r1 + r2) / 2
    dr = r1 - r2
    dg = g1 - g2
    db = b1 - b2

    # Formula from: https://www.compuphase.com/cmetric.htm
    return math.sqrt(
        (2 + rmean / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - rmean) / 256) * db * db
    )


def find_closest_colors(colors: list[tuple[int, int, int]]) -> tuple[int, int, float]:
    """Find the two closest colors in a list. Returns (idx1, idx2, distance)."""
    min_dist = float('inf')
    closest = (0, 1)

    for i in range(len(colors)):
        for j in range(i + 1, len(colors)):
            dist = color_distance(colors[i], colors[j])
            if dist < min_dist:
                min_dist = dist
                closest = (i, j)

    return closest[0], closest[1], min_dist


def merge_colors(c1: tuple[int, int, int], c2: tuple[int, int, int]) -> tuple[int, int, int]:
    """Merge two colors by averaging."""
    return (
        (c1[0] + c2[0]) // 2,
        (c1[1] + c2[1]) // 2,
        (c1[2] + c2[2]) // 2
    )


def reduce_palette(
    grid: list[list[int]],
    color_map: dict[int, tuple[int, int, int]],
    min_distance: float = 100.0,
    max_colors: int = 6
) -> tuple[list[list[int]], dict[int, tuple[int, int, int]]]:
    """
    Reduce color palette by merging similar colors.

    Args:
        grid: 2D array of color IDs
        color_map: Color ID -> RGB mapping
        min_distance: Minimum perceptual distance between colors (0-765)
        max_colors: Maximum number of colors to keep

    Returns:
        New grid and color_map with reduced palette
    """
    if not color_map:
        return grid, color_map

    # Build working lists
    color_ids = list(color_map.keys())
    colors = [color_map[cid] for cid in color_ids]

    # Create mapping from old IDs to new IDs
    id_mapping = {cid: cid for cid in color_ids}

    # Iteratively merge closest colors until constraints are met
    while len(colors) > 1:
        # Check if we've met both constraints
        if len(colors) <= max_colors:
            i, j, dist = find_closest_colors(colors)
            if dist >= min_distance:
                break  # All colors are sufficiently distinct

        # Find and merge closest pair
        i, j, dist = find_closest_colors(colors)

        # Merge color j into color i
        merged = merge_colors(colors[i], colors[j])
        colors[i] = merged

        # Update ID mapping - all pixels with color_ids[j] now map to color_ids[i]
        old_id = color_ids[j]
        new_id = color_ids[i]
        for k, v in id_mapping.items():
            if v == old_id:
                id_mapping[k] = new_id

        # Remove the merged color
        colors.pop(j)
        color_ids.pop(j)

    # Build new grid with remapped colors
    new_grid = []
    for row in grid:
        new_row = []
        for cell in row:
            if cell == EMPTY:
                new_row.append(EMPTY)
            else:
                new_row.append(id_mapping.get(cell, cell))
        new_grid.append(new_row)

    # Build new color map with sequential IDs
    unique_colors = {}
    for old_id, new_id in id_mapping.items():
        if new_id not in unique_colors:
            # Find the merged color
            if new_id in color_ids:
                idx = color_ids.index(new_id)
                unique_colors[new_id] = colors[idx]

    # Renumber to sequential IDs starting from 1
    old_to_new = {}
    new_color_map = {}
    next_id = 1

    for old_id in sorted(unique_colors.keys()):
        old_to_new[old_id] = next_id
        new_color_map[next_id] = unique_colors[old_id]
        next_id += 1

    # Apply renumbering to grid
    final_grid = []
    for row in new_grid:
        final_row = []
        for cell in row:
            if cell == EMPTY:
                final_row.append(EMPTY)
            else:
                mapped = id_mapping.get(cell, cell)
                final_row.append(old_to_new.get(mapped, cell))
        final_grid.append(final_row)

    return final_grid, new_color_map


def process_image(
    input_path: str | Path,
    output_path: str | Path,
    min_distance: float = 100.0,
    max_colors: int = 6
) -> tuple[list[list[int]], dict[int, tuple[int, int, int]]]:
    """
    Load an image, reduce its palette, and save the result.

    Args:
        input_path: Path to input image
        output_path: Path to save processed image
        min_distance: Minimum perceptual distance between colors
        max_colors: Maximum number of colors

    Returns:
        Processed grid and color_map
    """
    from generator import load_image, trim_grid

    # Load and process
    grid, color_map = load_image(input_path)
    grid = trim_grid(grid)

    print(f"Original: {len(color_map)} colors")

    # Reduce palette
    grid, color_map = reduce_palette(grid, color_map, min_distance, max_colors)

    print(f"Reduced: {len(color_map)} colors")

    # Save processed image
    save_grid_as_image(grid, color_map, output_path)

    return grid, color_map


def save_grid_as_image(
    grid: list[list[int]],
    color_map: dict[int, tuple[int, int, int]],
    path: str | Path
):
    """Save a color grid as a PNG image."""
    if not grid or not grid[0]:
        return

    height = len(grid)
    width = len(grid[0])

    img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    pixels = img.load()

    for y in range(height):
        for x in range(width):
            cell = grid[y][x]
            if cell == EMPTY:
                pixels[x, y] = (0, 0, 0, 0)  # Transparent
            else:
                rgb = color_map.get(cell, (255, 0, 255))  # Magenta for missing
                pixels[x, y] = (rgb[0], rgb[1], rgb[2], 255)

    img.save(path)
    print(f"Saved: {path}")


def analyze_palette(color_map: dict[int, tuple[int, int, int]]):
    """Print analysis of color distances in a palette."""
    colors = list(color_map.values())
    color_ids = list(color_map.keys())

    print(f"\nPalette analysis ({len(colors)} colors):")
    print("-" * 50)

    distances = []
    for i in range(len(colors)):
        for j in range(i + 1, len(colors)):
            dist = color_distance(colors[i], colors[j])
            distances.append((color_ids[i], color_ids[j], dist, colors[i], colors[j]))

    distances.sort(key=lambda x: x[2])

    for id1, id2, dist, c1, c2 in distances:
        status = "OK" if dist >= 100 else "TOO CLOSE"
        print(f"  {id1} {c1} <-> {id2} {c2}: {dist:.1f} [{status}]")

    if distances:
        print(f"\nMin distance: {distances[0][2]:.1f}")
        print(f"Max distance: {distances[-1][2]:.1f}")
