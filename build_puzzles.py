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
import json
import re
import signal
import sys
from pathlib import Path
from datetime import datetime

from generator import puzzle_from_image, load_image, trim_grid
from palette import process_image
from validator import validate_puzzle
from difficulty import calculate_difficulty


# Minimum perceptual distance between any two colors in the final palette
MIN_COLOR_DISTANCE = 35


def perceptual_color_distance(c1: tuple, c2: tuple) -> float:
    """Calculate perceptual distance between two RGB colors.

    Uses weighted Euclidean distance that accounts for human perception
    (green is more perceptible than red, red more than blue).
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
    """Convert filename to display name."""
    name = filename.replace("_", " ").replace("-", " ")
    parts = name.rsplit(" ", 1)
    if len(parts) == 2 and parts[1].isdigit():
        name = parts[0] + " " + parts[1]
    return name.title()


def process_single_image(input_path: Path, output_path: Path, min_distance: float, max_colors: int, timeout_seconds: int = 30, max_clues_per_line: int = 15) -> dict:
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

            # Generate puzzle data for website
            row_clues = [[{"count": c.count, "color": c.color} for c in row] for row in puzzle.row_clues]
            col_clues = [[{"count": c.count, "color": c.color} for c in col] for col in puzzle.col_clues]
            color_map_js = {str(k): list(v) for k, v in puzzle.color_map.items()}

            display_name = get_display_name(input_path.stem)

            result["puzzle_data"] = {
                "title": f"{display_name} ({puzzle.width}x{puzzle.height}, {diff.difficulty.value})",
                "width": puzzle.width,
                "height": puzzle.height,
                "row_clues": row_clues,
                "col_clues": col_clues,
                "color_map": color_map_js,
                "solution": grid
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

        for diff in ["trivial", "easy", "medium", "hard", "challenging", "expert", "master"]:
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
    """Update the PUZZLES constant in the HTML file."""
    html = html_path.read_text()
    js_puzzles = "    const PUZZLES = " + json.dumps(puzzles, separators=(',', ': ')) + ";"
    pattern = r'    const PUZZLES = \[[\s\S]*?\];'

    if not re.search(pattern, html):
        return False

    new_html = re.sub(pattern, js_puzzles, html, count=1)
    html_path.write_text(new_html)
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
    parser.add_argument("--timeout", type=int, default=30,
                        help="Timeout per image in seconds (default: 30)")
    parser.add_argument("--difficulties", nargs="+", default=["easy", "medium", "hard", "challenging", "expert"],
                        choices=["trivial", "easy", "medium", "hard", "challenging", "expert", "master"],
                        help="Difficulties to include in website (default: easy medium hard challenging expert)")
    parser.add_argument("--html", type=Path, default=Path("play.html"),
                        help="HTML file to update (default: play.html)")
    parser.add_argument("--no-update-html", action="store_true",
                        help="Don't update the HTML file")
    parser.add_argument("--report", type=Path, default=None,
                        help="Save report to file")
    parser.add_argument("--json", type=Path, default=None,
                        help="Save full results as JSON")
    parser.add_argument("--skip", type=Path, default=None,
                        help="File containing image names to skip (one per line, # for comments)")

    args = parser.parse_args()

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

            print(f"  {img_path.name}...", end=" ", flush=True)

            result = process_single_image(img_path, output_path, args.min_distance, args.max_colors, args.timeout)
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
    if not args.no_update_html:
        # Collect puzzle data for included difficulties
        difficulty_order = {"trivial": 0, "easy": 1, "medium": 2, "hard": 3, "challenging": 4, "expert": 5, "master": 6}
        puzzles = []
        for r in results:
            if r["status"] == "valid" and r["difficulty"] in args.difficulties and r["puzzle_data"]:
                puzzles.append((difficulty_order.get(r["difficulty"], 5), r["score"], r["puzzle_data"]))

        # Sort by difficulty then score
        puzzles.sort(key=lambda x: (x[0], x[1]))
        puzzle_data = [p[2] for p in puzzles]

        if puzzle_data:
            print(f"\nUpdating {args.html}...")
            if update_html(args.html, puzzle_data):
                print(f"✓ Updated with {len(puzzle_data)} puzzles:")
                for p in puzzle_data:
                    print(f"  • {p['title']}")
            else:
                print("✗ Failed to update HTML (PUZZLES constant not found)")
        else:
            print("\nNo puzzles to add to website")

    print("\nDone!")


if __name__ == "__main__":
    main()
