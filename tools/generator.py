"""Generate nonogram puzzles from images."""

from pathlib import Path
from PIL import Image

from models import Clue, Puzzle, EMPTY


def load_image(path: str | Path) -> tuple[list[list[int]], dict[int, tuple[int, int, int]]]:
    """
    Load an image and convert to a color-indexed grid.

    Transparent pixels (alpha < 128) are treated as empty (0).

    Returns:
        - Grid of color IDs (0 = empty, 1+ = colors)
        - Color map: ID -> RGB tuple
    """
    img = Image.open(path)
    img = img.convert("RGBA")

    width, height = img.size
    pixels = list(img.getdata())

    # Build color palette (skip transparent)
    color_to_id: dict[tuple[int, int, int], int] = {}
    next_id = 1

    grid: list[list[int]] = []

    for y in range(height):
        row: list[int] = []
        for x in range(width):
            r, g, b, a = pixels[y * width + x]

            if a < 128:
                # Transparent -> empty
                row.append(EMPTY)
            else:
                rgb = (r, g, b)
                if rgb not in color_to_id:
                    color_to_id[rgb] = next_id
                    next_id += 1
                row.append(color_to_id[rgb])
        grid.append(row)

    # Invert to id -> rgb
    color_map = {v: k for k, v in color_to_id.items()}

    return grid, color_map


def generate_clues(line: list[int]) -> list[Clue]:
    """
    Generate clues for a single line (row or column).

    Clues describe consecutive runs of same-colored filled cells.
    Empty cells (0) separate runs but don't generate clues.
    """
    clues: list[Clue] = []

    i = 0
    while i < len(line):
        if line[i] == EMPTY:
            i += 1
            continue

        # Start of a run
        color = line[i]
        count = 0
        while i < len(line) and line[i] == color:
            count += 1
            i += 1

        clues.append(Clue(count=count, color=color))

    return clues


def trim_grid(grid: list[list[int]]) -> list[list[int]]:
    """
    Remove empty rows/columns from the edges of a grid.

    Returns a new grid with empty borders removed.
    """
    if not grid or not grid[0]:
        return grid

    height = len(grid)
    width = len(grid[0])

    # Find bounds
    top, bottom, left, right = 0, height - 1, 0, width - 1

    # Find top (first non-empty row)
    while top < height and all(cell == EMPTY for cell in grid[top]):
        top += 1

    # Find bottom (last non-empty row)
    while bottom > top and all(cell == EMPTY for cell in grid[bottom]):
        bottom -= 1

    # Find left (first non-empty column)
    while left < width and all(grid[row][left] == EMPTY for row in range(top, bottom + 1)):
        left += 1

    # Find right (last non-empty column)
    while right > left and all(grid[row][right] == EMPTY for row in range(top, bottom + 1)):
        right -= 1

    # Extract trimmed region
    trimmed = [
        row[left:right + 1]
        for row in grid[top:bottom + 1]
    ]

    return trimmed


def puzzle_from_grid(
    grid: list[list[int]],
    color_map: dict[int, tuple[int, int, int]],
    trim: bool = False
) -> Puzzle:
    """
    Create a puzzle from a color grid.

    Args:
        grid: 2D array of color IDs (0 = empty, 1+ = colors)
        color_map: Color ID -> RGB mapping
        trim: If True, remove empty rows/columns from edges

    Returns:
        Puzzle with clues generated from the grid
    """
    if trim:
        grid = trim_grid(grid)

    height = len(grid)
    width = len(grid[0]) if grid else 0

    # Generate row clues
    row_clues = [generate_clues(row) for row in grid]

    # Generate column clues
    col_clues = []
    for col in range(width):
        column = [grid[row][col] for row in range(height)]
        col_clues.append(generate_clues(column))

    return Puzzle(
        width=width,
        height=height,
        row_clues=row_clues,
        col_clues=col_clues,
        color_map=color_map,
        solution=grid
    )


def puzzle_from_image(path: str | Path, trim: bool = True) -> Puzzle:
    """
    Load an image and create a nonogram puzzle from it.

    Transparent pixels become empty spaces.
    Each unique color becomes a separate color in the puzzle.

    Args:
        path: Path to image file
        trim: If True, remove empty rows/columns from edges (default True)
    """
    grid, color_map = load_image(path)
    return puzzle_from_grid(grid, color_map, trim=trim)


def puzzle_from_array(
    data: list[list[int | str]],
    color_map: dict[int, tuple[int, int, int]] | None = None
) -> Puzzle:
    """
    Create a puzzle from a raw array (useful for testing).

    Args:
        data: 2D array where:
            - 0, '.', or ' ' = empty
            - 1+ or other chars = colors
        color_map: Optional color mapping, auto-generated if None

    Example:
        puzzle_from_array([
            [1, 1, 0, 1],
            [1, 0, 0, 1],
            [1, 1, 1, 1],
        ])
    """
    # Normalize to int grid
    grid: list[list[int]] = []
    char_to_id: dict[str, int] = {'.': 0, ' ': 0, '0': 0}
    next_id = 1

    for row_data in data:
        row: list[int] = []
        for cell in row_data:
            if isinstance(cell, int):
                row.append(cell)
            else:
                # Character input
                if cell not in char_to_id:
                    char_to_id[cell] = next_id
                    next_id += 1
                row.append(char_to_id[cell])
        grid.append(row)

    # Generate default color map if not provided
    if color_map is None:
        colors = set(c for row in grid for c in row if c != EMPTY)
        # Simple color generation: different hues
        color_map = {}
        hues = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0),
                (255, 0, 255), (0, 255, 255), (128, 128, 128), (0, 0, 0)]
        for i, color_id in enumerate(sorted(colors)):
            color_map[color_id] = hues[i % len(hues)]

    return puzzle_from_grid(grid, color_map)
