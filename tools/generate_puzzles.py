#!/usr/bin/env python3
"""
Generate puzzle data from processed images.

Usage:
    python generate_puzzles.py <input_dir> [--difficulties DIFF...] [--output FILE]

Example:
    python generate_puzzles.py test_images/flowers_reduced
    python generate_puzzles.py test_images/flowers_reduced --difficulties easy medium hard
    python generate_puzzles.py test_images/flowers_reduced --output puzzles.json
"""

import argparse
import json
import sys
from pathlib import Path

from generator import puzzle_from_image, load_image, trim_grid
from validator import validate_puzzle
from difficulty import calculate_difficulty


# Map filename patterns to display names
def get_display_name(filename: str) -> str:
    """Convert filename to display name."""
    name = filename.replace("_", " ").replace("-", " ")
    # Remove trailing numbers like _1, _2
    parts = name.rsplit(" ", 1)
    if len(parts) == 2 and parts[1].isdigit():
        name = parts[0] + " " + parts[1]
    return name.title()


def generate_puzzle_data(image_path: Path) -> dict | None:
    """Generate puzzle data from a processed image."""
    try:
        puzzle = puzzle_from_image(str(image_path))
        grid, _ = load_image(str(image_path))
        grid = trim_grid(grid)

        # Validate
        validation = validate_puzzle(puzzle)
        if validation.result.value != "valid_unique":
            return None

        # Calculate difficulty
        diff = calculate_difficulty(puzzle, validation.solve_result.metrics)

        # Format clues for JS
        row_clues = [[{"count": c.count, "color": c.color} for c in row] for row in puzzle.row_clues]
        col_clues = [[{"count": c.count, "color": c.color} for c in col] for col in puzzle.col_clues]
        color_map = {str(k): list(v) for k, v in puzzle.color_map.items()}

        display_name = get_display_name(image_path.stem)

        return {
            "filename": image_path.stem,
            "title": f"{display_name} ({puzzle.width}x{puzzle.height}, {diff.difficulty.value})",
            "width": puzzle.width,
            "height": puzzle.height,
            "difficulty": diff.difficulty.value,
            "score": diff.score,
            "row_clues": row_clues,
            "col_clues": col_clues,
            "color_map": color_map,
            "solution": grid
        }

    except Exception as e:
        print(f"Error processing {image_path}: {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description="Generate puzzle data from processed images")
    parser.add_argument("input_dir", type=Path, help="Directory containing processed PNG images")
    parser.add_argument("--difficulties", nargs="+", default=["easy", "medium", "hard", "challenging"],
                        choices=["easy", "medium", "hard", "challenging", "expert"],
                        help="Difficulties to include (default: easy medium hard challenging)")
    parser.add_argument("--output", "-o", type=Path, default=None, help="Output JSON file")
    parser.add_argument("--sort-by", choices=["difficulty", "name", "size"], default="difficulty",
                        help="Sort order (default: difficulty)")

    args = parser.parse_args()

    if not args.input_dir.is_dir():
        print(f"Error: {args.input_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    images = sorted(args.input_dir.glob("*.png"))

    print(f"Processing {len(images)} images...")
    print(f"Including difficulties: {', '.join(args.difficulties)}")
    print()

    puzzles = []
    for img_path in images:
        data = generate_puzzle_data(img_path)
        if data and data["difficulty"] in args.difficulties:
            puzzles.append(data)
            print(f"  ✓ {data['title']}")
        elif data:
            print(f"  ✗ {data['title']} (excluded: {data['difficulty']})")
        else:
            print(f"  ✗ {img_path.name} (invalid)")

    # Sort
    difficulty_order = {"easy": 0, "medium": 1, "hard": 2, "challenging": 3, "expert": 4}
    if args.sort_by == "difficulty":
        puzzles.sort(key=lambda p: (difficulty_order.get(p["difficulty"], 5), p["score"]))
    elif args.sort_by == "name":
        puzzles.sort(key=lambda p: p["filename"])
    elif args.sort_by == "size":
        puzzles.sort(key=lambda p: p["width"] * p["height"])

    # Remove internal fields before output
    output_puzzles = []
    for p in puzzles:
        output_p = {k: v for k, v in p.items() if k not in ["filename", "difficulty", "score"]}
        output_puzzles.append(output_p)

    print(f"\nTotal puzzles: {len(output_puzzles)}")

    if args.output:
        args.output.write_text(json.dumps(output_puzzles, indent=2))
        print(f"Saved to: {args.output}")
    else:
        print("\nPuzzle data (use --output to save to file):")
        print(json.dumps(output_puzzles, separators=(',', ': ')))

    return output_puzzles


if __name__ == "__main__":
    main()
