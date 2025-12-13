#!/usr/bin/env python3
"""
Complete pipeline to build puzzles from images.

This script automates the entire process:
1. Process images (trim, reduce colors)
2. Validate solutions
3. Generate report
4. Update play.html with easy/medium/hard puzzles

Usage:
    python build_puzzles.py <input_dir> [input_dir2 ...] [options]

Examples:
    python build_puzzles.py test_images/flowers
    python build_puzzles.py test_images/flowers test_images/potted_plants test_images/garden_elements
    python build_puzzles.py test_images/flowers --difficulties easy medium
    python build_puzzles.py test_images/flowers --no-update-html
    python build_puzzles.py test_images/flowers --skip skip_list.txt

Skip List:
    The --skip option takes a file containing image names to skip (one per line).
    Lines starting with # are treated as comments. Example skip_list.txt:

        # Images that timeout
        vine_1
        vine_2
        hanging_basket_6
"""

import argparse
import colorsys
import json
import re
import signal
import sys
from pathlib import Path
from datetime import datetime
from collections import defaultdict

from generator import puzzle_from_image, load_image, trim_grid
from palette import process_image
from validator import validate_puzzle
from difficulty import calculate_difficulty


# Minimum perceptual distance between any two colors in the final palette.
# Uses weighted Euclidean distance: sqrt(0.30*dR² + 0.59*dG² + 0.11*dB²)
# where weights reflect human color perception (green > red > blue).
# Value of 35 balances distinguishability vs palette variety:
# - Lower values (25-30): More colors allowed, but some may look similar
# - Higher values (40-50): Fewer colors, but all clearly distinct
# Empirically tuned: 35 ensures colors are distinguishable on typical displays
# while allowing enough palette variety for detailed pixel art.
MIN_COLOR_DISTANCE = 35

# Color matching threshold for palette consistency analysis.
# When comparing colors across puzzle variants (e.g., rose_1, rose_2),
# colors closer than this are considered "matching" for consistency scoring.
# Uses compuphase weighted distance (~3x larger than perceptual_color_distance).
COLOR_MATCH_THRESHOLD = 200

# Color remapping threshold for palette unification.
# When unifying a puzzle family to a canonical palette, only remap colors
# that are within this distance. Prevents mapping dissimilar colors.
COLOR_REMAP_THRESHOLD = 150

# Per-image max color overrides (image stem -> max colors)
COLOR_OVERRIDES = {
    "black_susan": 3,
    "violet_3": 5,
    "potted_flower_5": 5,
    "potted_flower_1": 5,
    "yellow_daffodil_1": 5,
    "orange_zinnia_2": 4,
    "pink_peony_bloom_5": 5,
    "purple_iris_10": 5,
    "orange_zinnia_8": 5,
    "pink_peony_bloom_1": 5,
    "purple_iris_11": 5,
    "red_tulip_4": 5,
    "bee_4": 5,
    "orange_marigold_bloom_3": 5,
    "onion": 4,
    "red_carnation_3": 5,
    "bee_5": 5,
    "blue_morning_glory_vine_1": 4,
    "strawberry": 5,
    "bee_2": 5,
    "purple_iris_7": 5,
    "purple_iris_8": 5,
}


def perceptual_color_distance(c1: tuple, c2: tuple) -> float:
    """Calculate perceptual distance between two RGB colors.

    Uses weighted Euclidean distance that accounts for human perception:
    green (0.59) > red (0.30) > blue (0.11).

    Note: This differs from palette.py's color_distance() which uses the
    compuphase formula. This simpler formula is kept here because
    MIN_COLOR_DISTANCE (35) was empirically tuned for this specific formula.
    The compuphase formula gives ~3x larger values, so switching would
    require re-tuning the threshold.

    Args:
        c1: First color as (r, g, b) tuple (0-255 each)
        c2: Second color as (r, g, b) tuple (0-255 each)

    Returns:
        Perceptual distance (0 = identical, ~196 = max for black vs white)
    """
    r1, g1, b1 = c1
    r2, g2, b2 = c2
    return ((r1-r2)**2 * 0.30 + (g1-g2)**2 * 0.59 + (b1-b2)**2 * 0.11) ** 0.5


def check_color_similarity(color_map: dict, min_distance: float = MIN_COLOR_DISTANCE) -> tuple[bool, list]:
    """Check if any colors in the palette are too visually similar.

    Returns (is_ok, list of problematic color pairs with distances).
    """
    colors = list(color_map.values())
    problems = []

    for i, c1 in enumerate(colors):
        for c2 in colors[i+1:]:
            dist = perceptual_color_distance(c1, c2)
            if dist < min_distance:
                problems.append((c1, c2, dist))

    return len(problems) == 0, problems


class TimeoutError(Exception):
    """Raised when processing times out."""
    pass


def timeout_handler(signum, frame):
    raise TimeoutError("Processing timed out")


def load_skip_list(skip_file: Path) -> set[str]:
    """Load a skip list from a file. Returns set of image names (without extension)."""
    if not skip_file.exists():
        return set()

    skip_set = set()
    for line in skip_file.read_text().splitlines():
        line = line.strip()
        # Skip empty lines and comments
        if not line or line.startswith("#"):
            continue
        # Remove .png extension if present
        if line.endswith(".png"):
            line = line[:-4]
        skip_set.add(line)
    return skip_set


def get_display_name(filename: str) -> str:
    """Convert filename to human-readable display name.

    Transforms underscores/dashes to spaces and applies title case.
    Preserves trailing numbers (e.g., "rose_1" -> "Rose 1").

    Args:
        filename: Filename without extension (e.g., "pink_rose_1")

    Returns:
        Display name in title case (e.g., "Pink Rose 1")
    """
    name = filename.replace("_", " ").replace("-", " ")
    parts = name.rsplit(" ", 1)
    if len(parts) == 2 and parts[1].isdigit():
        name = parts[0] + " " + parts[1]
    return name.title()


def get_puzzle_prefix(title: str) -> str:
    """Extract family prefix from puzzle title for grouping related puzzles.

    Used to identify puzzle families (e.g., all "Red Tulip" variants) for
    palette consistency analysis.

    Args:
        title: Full puzzle title (e.g., "Red Tulip 1 (10x12, easy)")

    Returns:
        Normalized prefix in lowercase with underscores (e.g., "red_tulip")
    """
    # Remove difficulty suffix like "(10x12, easy)"
    name = re.sub(r'\s*\([^)]+\)\s*$', '', title)
    # Remove trailing number
    name = re.sub(r'\s*\d+\s*$', '', name)
    return name.strip().lower().replace(' ', '_')


def rgb_to_hsl(r: int, g: int, b: int) -> tuple:
    """Convert RGB color to HSL color space.

    Args:
        r: Red component (0-255)
        g: Green component (0-255)
        b: Blue component (0-255)

    Returns:
        Tuple of (hue, saturation, lightness) where:
        - hue: 0-360 degrees
        - saturation: 0-100 percent
        - lightness: 0-100 percent
    """
    r, g, b = r/255, g/255, b/255
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return (h * 360, s * 100, l * 100)


def color_distance_rgb(c1: list, c2: list) -> float:
    """Calculate Euclidean distance between two colors in RGB space.

    Simple unweighted distance. For perceptual distance, use
    perceptual_color_distance() instead.

    Args:
        c1: First color as [r, g, b] (0-255 each)
        c2: Second color as [r, g, b] (0-255 each)

    Returns:
        Distance value (0 = identical, ~441 = max for black vs white)
    """
    return sum((a - b) ** 2 for a, b in zip(c1, c2)) ** 0.5


# ============================================================================
# COLOR NAMING FOR SCREEN READER ACCESSIBILITY
# ============================================================================
# 65 familiar color names for generating ARIA labels on color palette buttons.
# Each color has an HSL reference point for matching.

COLOR_NAME_REFERENCES = [
    # REDS (0°-15°)
    {"name": "red", "h": 0, "s": 100, "l": 50},
    {"name": "dark red", "h": 0, "s": 90, "l": 30},
    {"name": "light red", "h": 0, "s": 85, "l": 65},
    {"name": "maroon", "h": 0, "s": 70, "l": 25},
    {"name": "crimson", "h": 350, "s": 80, "l": 45},
    {"name": "brick", "h": 5, "s": 65, "l": 38},

    # ORANGES (15°-45°)
    {"name": "tomato", "h": 10, "s": 90, "l": 58},
    {"name": "coral", "h": 16, "s": 75, "l": 62},
    {"name": "salmon", "h": 8, "s": 85, "l": 72},
    {"name": "orange", "h": 28, "s": 100, "l": 52},
    {"name": "rust", "h": 18, "s": 75, "l": 38},
    {"name": "copper", "h": 22, "s": 68, "l": 48},

    # BROWNS
    {"name": "brown", "h": 25, "s": 60, "l": 30},
    {"name": "chocolate", "h": 20, "s": 75, "l": 22},
    {"name": "tan", "h": 32, "s": 42, "l": 68},
    {"name": "beige", "h": 35, "s": 38, "l": 78},
    {"name": "peach", "h": 28, "s": 90, "l": 82},

    # YELLOWS/GOLDS (40°-65°)
    {"name": "amber", "h": 40, "s": 95, "l": 50},
    {"name": "gold", "h": 48, "s": 92, "l": 52},
    {"name": "yellow", "h": 55, "s": 100, "l": 55},
    {"name": "lemon", "h": 58, "s": 100, "l": 72},
    {"name": "mustard", "h": 48, "s": 78, "l": 45},
    {"name": "olive", "h": 58, "s": 55, "l": 35},
    {"name": "khaki", "h": 50, "s": 38, "l": 62},

    # YELLOW-GREENS (70°-100°)
    {"name": "lime", "h": 78, "s": 88, "l": 52},
    {"name": "chartreuse", "h": 88, "s": 88, "l": 48},
    {"name": "sage", "h": 82, "s": 28, "l": 55},
    {"name": "moss", "h": 80, "s": 42, "l": 38},

    # GREENS (100°-160°)
    {"name": "green", "h": 120, "s": 85, "l": 38},
    {"name": "dark green", "h": 120, "s": 65, "l": 22},
    {"name": "light green", "h": 115, "s": 68, "l": 60},
    {"name": "forest", "h": 120, "s": 60, "l": 28},
    {"name": "emerald", "h": 142, "s": 68, "l": 42},
    {"name": "mint", "h": 148, "s": 50, "l": 72},
    {"name": "seafoam", "h": 162, "s": 48, "l": 65},

    # TEALS/CYANS (165°-190°)
    {"name": "teal", "h": 175, "s": 75, "l": 35},
    {"name": "turquoise", "h": 178, "s": 65, "l": 52},
    {"name": "aqua", "h": 182, "s": 80, "l": 55},
    {"name": "cyan", "h": 185, "s": 100, "l": 55},

    # BLUES (190°-250°)
    {"name": "sky blue", "h": 198, "s": 68, "l": 72},
    {"name": "azure", "h": 208, "s": 85, "l": 55},
    {"name": "blue", "h": 220, "s": 100, "l": 50},
    {"name": "light blue", "h": 205, "s": 75, "l": 70},
    {"name": "dark blue", "h": 225, "s": 85, "l": 35},
    {"name": "cobalt", "h": 225, "s": 78, "l": 45},
    {"name": "navy", "h": 230, "s": 75, "l": 25},
    {"name": "steel", "h": 215, "s": 22, "l": 50},
    {"name": "slate", "h": 210, "s": 18, "l": 40},

    # PURPLES (250°-290°)
    {"name": "indigo", "h": 260, "s": 78, "l": 32},
    {"name": "violet", "h": 270, "s": 70, "l": 55},
    {"name": "purple", "h": 280, "s": 75, "l": 42},
    {"name": "dark purple", "h": 275, "s": 65, "l": 28},
    {"name": "lavender", "h": 270, "s": 55, "l": 78},
    {"name": "lilac", "h": 280, "s": 42, "l": 72},
    {"name": "plum", "h": 295, "s": 55, "l": 35},
    {"name": "mauve", "h": 300, "s": 28, "l": 58},

    # MAGENTAS/PINKS (290°-350°)
    {"name": "magenta", "h": 300, "s": 95, "l": 50},
    {"name": "fuchsia", "h": 315, "s": 88, "l": 58},
    {"name": "hot pink", "h": 325, "s": 85, "l": 60},
    {"name": "pink", "h": 330, "s": 85, "l": 75},
    {"name": "rose", "h": 340, "s": 58, "l": 55},
    {"name": "blush", "h": 345, "s": 52, "l": 85},

    # NEUTRALS
    {"name": "white", "h": 0, "s": 0, "l": 98},
    {"name": "ivory", "h": 48, "s": 90, "l": 95},
    {"name": "cream", "h": 40, "s": 85, "l": 92},
    {"name": "silver", "h": 0, "s": 0, "l": 76},
    {"name": "gray", "h": 0, "s": 0, "l": 50},
    {"name": "dark gray", "h": 0, "s": 0, "l": 30},
    {"name": "charcoal", "h": 0, "s": 0, "l": 22},
    {"name": "black", "h": 0, "s": 0, "l": 5},
]


def hex_to_hsl(hex_color: str) -> tuple:
    """Convert hex color string to HSL.

    Args:
        hex_color: Color as "#rrggbb" string

    Returns:
        Tuple of (hue, saturation, lightness) where:
        - hue: 0-360 degrees
        - saturation: 0-100 percent
        - lightness: 0-100 percent
    """
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return rgb_to_hsl(r, g, b)


def hsl_distance(c1: dict, c2: dict) -> float:
    """Calculate perceptual distance between two HSL colors.

    Weights hue by saturation (grays have no meaningful hue) and
    lightness more heavily (most perceptually important).

    Args:
        c1: First color as {"h": hue, "s": sat, "l": light}
        c2: Second color as {"h": hue, "s": sat, "l": light}

    Returns:
        Distance value (lower = more similar)
    """
    # Hue difference (circular)
    h_diff = abs(c1["h"] - c2["h"])
    if h_diff > 180:
        h_diff = 360 - h_diff

    # Weight hue by average saturation (grays have no meaningful hue)
    avg_sat = (c1["s"] + c2["s"]) / 2
    hue_weight = avg_sat / 100

    return (
        (h_diff * hue_weight) ** 2 * 2 +  # Hue (weighted by saturation)
        (c1["s"] - c2["s"]) ** 2 +         # Saturation
        (c1["l"] - c2["l"]) ** 2 * 3       # Lightness (most important)
    ) ** 0.5


def generate_color_names(palette: list[str]) -> list[str]:
    """Generate unique, human-readable names for a color palette.

    Used for ARIA labels on color palette buttons to improve
    screen reader accessibility.

    Args:
        palette: List of hex color strings (e.g., ["#ff0000", "#00ff00"])

    Returns:
        List of color names (e.g., ["red", "green"])
    """
    # Convert hex colors to HSL
    colors = []
    for hex_color in palette:
        h, s, l = hex_to_hsl(hex_color)
        colors.append({"hex": hex_color, "h": h, "s": s, "l": l})

    names = [None] * len(colors)
    used_names = {}  # name -> count

    # Pass 1: Force neutral names for extreme values
    for idx, c in enumerate(colors):
        if c["l"] >= 95 or (c["l"] >= 90 and c["s"] < 25):
            names[idx] = "white"
            used_names["white"] = used_names.get("white", 0) + 1
        elif c["l"] <= 10 or (c["l"] <= 15 and c["s"] < 15):
            names[idx] = "black"
            used_names["black"] = used_names.get("black", 0) + 1

    # Pass 2: Match remaining colors to reference vocabulary
    for idx, c in enumerate(colors):
        if names[idx] is not None:
            continue

        best_name = None
        best_score = float('inf')

        for ref in COLOR_NAME_REFERENCES:
            dist = hsl_distance(c, ref)
            # Heavy penalty for reusing a name in this palette
            penalty = 800 * used_names.get(ref["name"], 0)
            score = dist + penalty

            if score < best_score:
                best_score = score
                best_name = ref["name"]

        names[idx] = best_name
        used_names[best_name] = used_names.get(best_name, 0) + 1

    return names


def normalize_family_palettes(puzzles: list[dict], min_consistency_score: float = 60.0) -> tuple[list[dict], dict]:
    """
    Normalize color palettes across puzzle families.

    For families with low consistency scores, remaps colors to use a canonical palette.
    Returns (normalized_puzzles, normalization_report).
    """
    # Group puzzles by prefix
    families = defaultdict(list)
    for i, p in enumerate(puzzles):
        prefix = get_puzzle_prefix(p["title"])
        families[prefix].append((i, p))

    report = {
        "families_analyzed": 0,
        "families_normalized": 0,
        "puzzles_modified": 0,
        "details": []
    }

    normalized = [p.copy() for p in puzzles]

    for prefix, members in families.items():
        if len(members) < 2:
            continue

        report["families_analyzed"] += 1

        # Extract color data for each puzzle
        family_colors = []
        for idx, p in members:
            colors = []
            for color_idx, rgb in p["color_map"].items():
                colors.append({
                    "idx": int(color_idx),
                    "rgb": tuple(rgb),
                    "hsl": rgb_to_hsl(*rgb)
                })
            family_colors.append({
                "puzzle_idx": idx,
                "title": p["title"],
                "colors": sorted(colors, key=lambda c: c["hsl"][0]),  # Sort by hue
                "num_colors": len(colors)
            })

        # Calculate family consistency
        pair_distances = []
        for i in range(len(family_colors)):
            for j in range(i + 1, len(family_colors)):
                p1_colors = [c["rgb"] for c in family_colors[i]["colors"]]
                p2_colors = [c["rgb"] for c in family_colors[j]["colors"]]

                # Best matching (greedy)
                total_dist = 0
                matched = 0
                used = set()
                for c1 in p1_colors:
                    best_dist = float('inf')
                    best_idx = -1
                    for k, c2 in enumerate(p2_colors):
                        if k not in used:
                            d = color_distance_rgb(c1, c2)
                            if d < best_dist:
                                best_dist = d
                                best_idx = k
                    if best_idx >= 0 and best_dist < COLOR_MATCH_THRESHOLD:
                        used.add(best_idx)
                        total_dist += best_dist
                        matched += 1

                avg_dist = total_dist / matched if matched > 0 else 255
                pair_distances.append(avg_dist)

        avg_pair_dist = sum(pair_distances) / len(pair_distances) if pair_distances else 0
        color_counts = [fc["num_colors"] for fc in family_colors]
        count_variance = max(color_counts) - min(color_counts)

        # Simple consistency score
        consistency_score = max(0, 100 - avg_pair_dist * 1.5 - count_variance * 25)

        # Skip if already consistent enough
        if consistency_score >= min_consistency_score:
            report["details"].append({
                "family": prefix,
                "action": "skip",
                "score": consistency_score,
                "reason": "already consistent"
            })
            continue

        # Find canonical palette (puzzle with most colors, or first if tied)
        canonical_idx = max(range(len(family_colors)), key=lambda i: family_colors[i]["num_colors"])
        canonical = family_colors[canonical_idx]
        canonical_puzzle_idx = canonical["puzzle_idx"]

        # Normalize other puzzles to match canonical palette
        modified_count = 0
        for fc in family_colors:
            if fc["puzzle_idx"] == canonical_puzzle_idx:
                continue  # Skip canonical

            puzzle_idx = fc["puzzle_idx"]
            puzzle = normalized[puzzle_idx]

            # Build color mapping: old_idx -> new_rgb
            old_colors = {c["idx"]: c["rgb"] for c in fc["colors"]}
            canonical_colors = [c["rgb"] for c in canonical["colors"]]

            # Match each old color to closest canonical color
            color_remap = {}  # old_idx -> (new_idx_in_canonical, new_rgb)
            used_canonical = set()

            for old_idx, old_rgb in old_colors.items():
                best_dist = float('inf')
                best_canonical_idx = 0
                for k, can_rgb in enumerate(canonical_colors):
                    if k not in used_canonical:
                        d = color_distance_rgb(old_rgb, can_rgb)
                        if d < best_dist:
                            best_dist = d
                            best_canonical_idx = k

                # Only remap if distance is reasonable
                if best_dist < COLOR_REMAP_THRESHOLD:
                    used_canonical.add(best_canonical_idx)
                    color_remap[old_idx] = canonical_colors[best_canonical_idx]
                else:
                    color_remap[old_idx] = old_rgb  # Keep original

            # Apply remapping to puzzle data
            new_color_map = {}
            for str_idx, rgb in puzzle["color_map"].items():
                idx = int(str_idx)
                if idx in color_remap:
                    new_color_map[str_idx] = list(color_remap[idx])
                else:
                    new_color_map[str_idx] = rgb

            # Update puzzle
            normalized[puzzle_idx] = puzzle.copy()
            normalized[puzzle_idx]["color_map"] = new_color_map
            modified_count += 1

        if modified_count > 0:
            report["families_normalized"] += 1
            report["puzzles_modified"] += modified_count
            report["details"].append({
                "family": prefix,
                "action": "normalized",
                "score": consistency_score,
                "canonical": canonical["title"],
                "modified": modified_count
            })

    return normalized, report


def process_single_image(input_path: Path, output_path: Path, min_distance: float, max_colors: int, timeout_seconds: int = 10, max_clues_per_line: int = 15) -> dict:
    """Process a single image and return results."""
    result = {
        "name": input_path.stem,
        "input_path": str(input_path),
        "output_path": str(output_path),
        "status": "error",
        "validation": None,
        "difficulty": None,
        "score": None,
        "width": None,
        "height": None,
        "original_colors": None,
        "reduced_colors": None,
        "max_clues": None,
        "error": None,
        "puzzle_data": None,
    }

    # Set up timeout
    old_handler = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(timeout_seconds)

    try:
        # Load original to count colors
        orig_grid, orig_cmap = load_image(str(input_path))
        result["original_colors"] = len(orig_cmap)

        # Process image (trim + reduce palette)
        grid, color_map = process_image(
            str(input_path),
            str(output_path),
            min_distance=min_distance,
            max_colors=max_colors
        )

        result["reduced_colors"] = len(color_map)

        # Check for colors that are too visually similar
        colors_ok, color_problems = check_color_similarity(color_map)
        if not colors_ok:
            result["status"] = "invalid"
            result["validation"] = "colors_too_similar"
            worst = min(color_problems, key=lambda x: x[2])
            result["error"] = f"Colors too similar: {worst[0]} vs {worst[1]} (dist={worst[2]:.1f})"
            return result

        # Create puzzle and validate
        puzzle = puzzle_from_image(str(output_path))
        grid, _ = load_image(str(output_path))
        grid = trim_grid(grid)

        result["height"] = puzzle.height
        result["width"] = puzzle.width

        # Check max clues per line
        row_clue_counts = [len(clues) for clues in puzzle.row_clues]
        col_clue_counts = [len(clues) for clues in puzzle.col_clues]
        max_clues = max(row_clue_counts + col_clue_counts) if row_clue_counts or col_clue_counts else 0
        result["max_clues"] = max_clues

        if max_clues > max_clues_per_line:
            result["status"] = "invalid"
            result["validation"] = "too_dense"
            result["error"] = f"Max {max_clues} clues/line exceeds limit of {max_clues_per_line}"
            return result

        validation = validate_puzzle(puzzle)
        result["validation"] = validation.result.value

        if validation.result.value == "valid_unique":
            # Calculate difficulty
            diff = calculate_difficulty(puzzle, validation.solve_result.metrics)
            result["difficulty"] = diff.difficulty.value
            result["score"] = diff.score
            result["status"] = "valid"

            # Generate puzzle data for website (concise format)
            # Clues as [count, color] pairs, colors 0-indexed
            row_clues = [[[c.count, c.color - 1] for c in row] for row in puzzle.row_clues]
            col_clues = [[[c.count, c.color - 1] for c in col] for col in puzzle.col_clues]
            # Palette as hex colors (e.g., "#ff00aa")
            palette = ['#{:02x}{:02x}{:02x}'.format(*puzzle.color_map[i]) for i in sorted(puzzle.color_map.keys())]
            # Color names for screen reader accessibility
            color_names = generate_color_names(palette)
            # Solution with 0-indexed colors (-1 = empty)
            solution_0indexed = [[c - 1 if c > 0 else -1 for c in row] for row in grid]

            display_name = get_display_name(input_path.stem)

            result["puzzle_data"] = {
                "t": f"{display_name} ({puzzle.width}x{puzzle.height}, {diff.difficulty.value})",
                "w": puzzle.width,
                "h": puzzle.height,
                "r": row_clues,
                "c": col_clues,
                "p": palette,
                "n": color_names,
                "s": solution_0indexed
            }
        else:
            result["status"] = "invalid"
            result["error"] = validation.message

    except TimeoutError:
        result["status"] = "invalid"
        result["validation"] = "timeout"
        result["error"] = f"Processing timed out after {timeout_seconds}s"

    except Exception as e:
        result["error"] = str(e)

    finally:
        # Cancel the alarm and restore the old handler
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)

    return result


def generate_report(results: list[dict], difficulties: list[str]) -> str:
    """Generate a text report."""
    lines = []
    lines.append("=" * 70)
    lines.append("NONOGRAM PUZZLE BUILD REPORT")
    lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("=" * 70)

    valid = [r for r in results if r["status"] == "valid"]
    invalid = [r for r in results if r["status"] == "invalid"]
    errors = [r for r in results if r["status"] == "error"]
    skipped = [r for r in results if r["status"] == "skipped"]
    included = [r for r in valid if r["difficulty"] in difficulties]

    lines.append(f"\nSUMMARY")
    lines.append("-" * 40)
    lines.append(f"Total images: {len(results)}")
    lines.append(f"Skipped: {len(skipped)}")
    lines.append(f"Valid puzzles: {len(valid)}")
    lines.append(f"Invalid puzzles: {len(invalid)}")
    lines.append(f"Errors: {len(errors)}")
    lines.append(f"Included in website: {len(included)}")
    lines.append(f"Difficulties included: {', '.join(difficulties)}")

    if valid:
        lines.append(f"\nVALID PUZZLES BY DIFFICULTY")
        lines.append("-" * 40)

        for diff in ["easy", "medium", "hard", "challenging", "expert", "master"]:
            diff_puzzles = [r for r in valid if r["difficulty"] == diff]
            if diff_puzzles:
                marker = "✓" if diff in difficulties else "✗"
                lines.append(f"\n{diff.upper()} ({len(diff_puzzles)}) {marker if diff not in difficulties else ''}")
                for r in sorted(diff_puzzles, key=lambda x: x["score"]):
                    inc = "→" if diff in difficulties else " "
                    lines.append(f"  {inc} {r['name']}: {r['width']}x{r['height']}, {r['reduced_colors']} colors (score: {r['score']:.1f})")

    if invalid:
        lines.append(f"\nINVALID PUZZLES")
        lines.append("-" * 40)
        for r in invalid:
            lines.append(f"  ✗ {r['name']}: {r['validation']}")

    if errors:
        lines.append(f"\nERRORS")
        lines.append("-" * 40)
        for r in errors:
            lines.append(f"  ✗ {r['name']}: {r['error']}")

    lines.append("\n" + "=" * 70)

    return "\n".join(lines)


def update_html(html_path: Path, puzzles: list[dict]) -> bool:
    """Update the PUZZLES constant in the HTML file (legacy support)."""
    html = html_path.read_text()
    js_puzzles = "    const PUZZLES = " + json.dumps(puzzles, separators=(',', ': ')) + ";"
    pattern = r'    const PUZZLES = \[[\s\S]*?\];'

    if not re.search(pattern, html):
        return False

    new_html = re.sub(pattern, js_puzzles, html, count=1)
    html_path.write_text(new_html)
    return True


def write_puzzle_data(output_path: Path, puzzles: list[dict]) -> bool:
    """Write puzzle data to a JavaScript file for the modular website structure."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    js_content = "// Puzzle data - auto-generated by build_puzzles.py\nwindow.PUZZLE_DATA = " + json.dumps(puzzles, separators=(',', ': ')) + ";\n"
    output_path.write_text(js_content)
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Complete pipeline to build puzzles from images",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python build_puzzles.py test_images/flowers
    python build_puzzles.py test_images/flowers --difficulties easy medium
    python build_puzzles.py test_images/flowers --no-update-html --report report.txt
        """
    )
    parser.add_argument("input_dirs", type=Path, nargs="+", help="Directory(s) containing PNG images")
    parser.add_argument("--min-distance", type=float, default=100.0,
                        help="Minimum color distance for palette reduction (default: 100)")
    parser.add_argument("--max-colors", type=int, default=6,
                        help="Maximum colors per puzzle (default: 6)")
    parser.add_argument("--timeout", type=int, default=10,
                        help="Timeout per image in seconds (default: 10)")
    parser.add_argument("--difficulties", nargs="+", default=["easy", "medium", "hard", "challenging", "expert", "master"],
                        choices=["easy", "medium", "hard", "challenging", "expert", "master"],
                        help="Difficulties to include in website (default: easy medium hard challenging expert master)")
    parser.add_argument("--output", type=Path, default=Path("src/data/puzzles.js"),
                        help="Output puzzle data file (default: src/data/puzzles.js)")
    parser.add_argument("--html", type=Path, default=None,
                        help="Legacy: HTML file to update (use --output instead)")
    parser.add_argument("--no-update", action="store_true",
                        help="Don't write puzzle data to output file")
    parser.add_argument("--report", type=Path, default=None,
                        help="Save report to file")
    parser.add_argument("--json", type=Path, default=None,
                        help="Save full results as JSON")
    parser.add_argument("--skip", type=Path, default=None,
                        help="File containing image names to skip (one per line, # for comments)")
    parser.add_argument("--normalize-colors", action="store_true",
                        help="Normalize color palettes across puzzle families")
    parser.add_argument("--no-normalize-colors", action="store_true",
                        help="Disable color normalization (default: enabled)")

    args = parser.parse_args()

    # Default to normalizing colors unless explicitly disabled
    args.normalize = not args.no_normalize_colors or args.normalize_colors

    # Validate all input directories
    for input_dir in args.input_dirs:
        if not input_dir.is_dir():
            print(f"Error: {input_dir} is not a directory", file=sys.stderr)
            sys.exit(1)

    # Load skip list if provided
    skip_set = load_skip_list(args.skip) if args.skip else set()

    print("=" * 70)
    print("NONOGRAM PUZZLE BUILDER")
    print("=" * 70)
    print(f"Input directories: {', '.join(str(d) for d in args.input_dirs)}")
    print(f"Min color distance: {args.min_distance}")
    print(f"Max colors: {args.max_colors}")
    print(f"Include difficulties: {', '.join(args.difficulties)}")
    if skip_set:
        print(f"Skipping: {len(skip_set)} images from {args.skip}")
    print()

    results = []

    # Process each input directory
    for input_dir in args.input_dirs:
        output_dir = input_dir.parent / f"{input_dir.name}_reduced"
        output_dir.mkdir(parents=True, exist_ok=True)

        images = sorted(input_dir.glob("*.png"))
        print(f"Processing {input_dir} ({len(images)} images)...")
        print("-" * 40)

        for img_path in images:
            output_path = output_dir / f"{img_path.stem}.png"

            # Check if image should be skipped
            if img_path.stem in skip_set:
                print(f"  {img_path.name}... SKIPPED")
                results.append({
                    "name": img_path.stem,
                    "input_path": str(img_path),
                    "output_path": str(output_path),
                    "status": "skipped",
                    "validation": "skipped",
                    "difficulty": None,
                    "score": None,
                    "width": None,
                    "height": None,
                    "original_colors": None,
                    "reduced_colors": None,
                    "max_clues": None,
                    "error": None,
                    "puzzle_data": None,
                })
                continue

            # Use per-image color override if specified, otherwise use default
            max_colors = COLOR_OVERRIDES.get(img_path.stem, args.max_colors)
            override_marker = f" [max:{max_colors}]" if img_path.stem in COLOR_OVERRIDES else ""
            print(f"  {img_path.name}{override_marker}...", end=" ", flush=True)

            result = process_single_image(img_path, output_path, args.min_distance, max_colors, args.timeout)
            results.append(result)

            if result["status"] == "valid":
                inc = "✓" if result["difficulty"] in args.difficulties else "○"
                print(f"{inc} {result['difficulty']} ({result['width']}x{result['height']}, {result['reduced_colors']} colors)")
            elif result["status"] == "invalid":
                print(f"✗ {result['validation']}")
            else:
                print(f"✗ ERROR: {result['error']}")

        print()

    # Generate report
    report = generate_report(results, args.difficulties)
    print("\n" + report)

    # Save report if requested
    if args.report:
        args.report.write_text(report)
        print(f"Report saved to: {args.report}")

    # Save JSON if requested
    if args.json:
        # Remove puzzle_data from JSON output (it's large)
        json_results = [{k: v for k, v in r.items() if k != "puzzle_data"} for r in results]
        args.json.write_text(json.dumps(json_results, indent=2))
        print(f"Results saved to: {args.json}")

    # Update HTML
    if True:  # Always prepare data, actual write controlled by args.no_update
        # Collect puzzle data for included difficulties
        difficulty_order = {"easy": 0, "medium": 1, "hard": 2, "challenging": 3, "expert": 4, "master": 5}
        puzzles = []
        for r in results:
            if r["status"] == "valid" and r["difficulty"] in args.difficulties and r["puzzle_data"]:
                puzzles.append((difficulty_order.get(r["difficulty"], 5), r["score"], r["puzzle_data"]))

        # Sort by difficulty then score
        puzzles.sort(key=lambda x: (x[0], x[1]))
        puzzle_data = [p[2] for p in puzzles]

        # Normalize color palettes across families
        # DISABLED: The greedy matching algorithm has a bug where hue-sorted iteration
        # causes suboptimal matches (e.g., orange grabs yellow's best match first)
        # TODO: Fix by using Hungarian algorithm for optimal bipartite matching
        if False and puzzle_data and args.normalize:
            print("\nNormalizing color palettes across families...")
            puzzle_data, norm_report = normalize_family_palettes(puzzle_data)
            print(f"  Families analyzed: {norm_report['families_analyzed']}")
            print(f"  Families normalized: {norm_report['families_normalized']}")
            print(f"  Puzzles modified: {norm_report['puzzles_modified']}")
            for detail in norm_report["details"]:
                if detail["action"] == "normalized":
                    print(f"    ✓ {detail['family']}: {detail['modified']} puzzles → canonical: {detail['canonical']}")
                elif detail["action"] == "skip":
                    pass  # Don't print skipped families to reduce noise

        if puzzle_data and not args.no_update:
            # Use legacy --html if specified, otherwise use new --output
            if args.html:
                print(f"\nUpdating {args.html} (legacy mode)...")
                if update_html(args.html, puzzle_data):
                    print(f"✓ Updated with {len(puzzle_data)} puzzles:")
                    for p in puzzle_data:
                        print(f"  • {p['t']}")
                else:
                    print("✗ Failed to update HTML (PUZZLES constant not found)")
            else:
                print(f"\nWriting {args.output}...")
                if write_puzzle_data(args.output, puzzle_data):
                    print(f"✓ Written {len(puzzle_data)} puzzles:")
                    for p in puzzle_data:
                        print(f"  • {p['t']}")
                else:
                    print("✗ Failed to write puzzle data")
        elif not puzzle_data:
            print("\nNo puzzles to add to website")

    print("\nDone!")


if __name__ == "__main__":
    main()
