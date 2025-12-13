#!/usr/bin/env python3
"""
Process images for nonogram puzzles.

Usage:
    python process_images.py <input_dir> [--output-dir DIR] [--min-distance FLOAT] [--max-colors INT]

Example:
    python process_images.py test_images/flowers
    python process_images.py test_images/flowers --output-dir processed --min-distance 120
"""

import argparse
import json
import sys
from pathlib import Path

from generator import puzzle_from_image, load_image, trim_grid
from palette import process_image, analyze_palette
from validator import validate_puzzle
from difficulty import calculate_difficulty


def process_single_image(input_path: Path, output_path: Path, min_distance: float, max_colors: int) -> dict:
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
        "error": None,
    }

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
        result["height"] = len(grid)
        result["width"] = len(grid[0]) if grid else 0

        # Create puzzle and validate
        puzzle = puzzle_from_image(str(output_path))
        validation = validate_puzzle(puzzle)

        result["validation"] = validation.result.value

        if validation.result.value == "valid_unique":
            # Calculate difficulty
            diff = calculate_difficulty(puzzle, validation.solve_result.metrics)
            result["difficulty"] = diff.difficulty.value
            result["score"] = diff.score
            result["status"] = "valid"
        else:
            result["status"] = "invalid"
            result["error"] = validation.message

    except Exception as e:
        result["error"] = str(e)

    return result


def process_directory(input_dir: Path, output_dir: Path, min_distance: float, max_colors: int) -> list[dict]:
    """Process all PNG images in a directory."""
    output_dir.mkdir(parents=True, exist_ok=True)

    images = sorted(input_dir.glob("*.png"))
    results = []

    for img_path in images:
        output_path = output_dir / f"{img_path.stem}.png"
        print(f"Processing: {img_path.name}...", end=" ", flush=True)

        result = process_single_image(img_path, output_path, min_distance, max_colors)
        results.append(result)

        if result["status"] == "valid":
            print(f"✓ {result['difficulty']} ({result['width']}x{result['height']}, {result['reduced_colors']} colors)")
        elif result["status"] == "invalid":
            print(f"✗ {result['validation']}")
        else:
            print(f"✗ ERROR: {result['error']}")

    return results


def generate_report(results: list[dict]) -> str:
    """Generate a text report of processing results."""
    lines = []
    lines.append("=" * 60)
    lines.append("NONOGRAM PROCESSING REPORT")
    lines.append("=" * 60)

    # Summary
    valid = [r for r in results if r["status"] == "valid"]
    invalid = [r for r in results if r["status"] == "invalid"]
    errors = [r for r in results if r["status"] == "error"]

    lines.append(f"\nTotal images: {len(results)}")
    lines.append(f"Valid puzzles: {len(valid)}")
    lines.append(f"Invalid puzzles: {len(invalid)}")
    lines.append(f"Errors: {len(errors)}")

    # By difficulty
    if valid:
        lines.append("\n" + "-" * 40)
        lines.append("VALID PUZZLES BY DIFFICULTY")
        lines.append("-" * 40)

        for diff in ["easy", "medium", "hard", "expert"]:
            diff_puzzles = [r for r in valid if r["difficulty"] == diff]
            if diff_puzzles:
                lines.append(f"\n{diff.upper()} ({len(diff_puzzles)}):")
                for r in diff_puzzles:
                    lines.append(f"  • {r['name']}: {r['width']}x{r['height']}, {r['reduced_colors']} colors (score: {r['score']:.1f})")

    # Invalid puzzles
    if invalid:
        lines.append("\n" + "-" * 40)
        lines.append("INVALID PUZZLES")
        lines.append("-" * 40)
        for r in invalid:
            lines.append(f"  • {r['name']}: {r['validation']}")

    # Errors
    if errors:
        lines.append("\n" + "-" * 40)
        lines.append("ERRORS")
        lines.append("-" * 40)
        for r in errors:
            lines.append(f"  • {r['name']}: {r['error']}")

    lines.append("\n" + "=" * 60)

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Process images for nonogram puzzles")
    parser.add_argument("input_dir", type=Path, help="Directory containing PNG images")
    parser.add_argument("--output-dir", type=Path, default=None, help="Output directory for processed images")
    parser.add_argument("--min-distance", type=float, default=100.0, help="Minimum color distance (default: 100)")
    parser.add_argument("--max-colors", type=int, default=6, help="Maximum colors (default: 6)")
    parser.add_argument("--report", type=Path, default=None, help="Save report to file")
    parser.add_argument("--json", type=Path, default=None, help="Save results as JSON")

    args = parser.parse_args()

    if not args.input_dir.is_dir():
        print(f"Error: {args.input_dir} is not a directory")
        sys.exit(1)

    output_dir = args.output_dir or (args.input_dir.parent / f"{args.input_dir.name}_reduced")

    print(f"Input directory: {args.input_dir}")
    print(f"Output directory: {output_dir}")
    print(f"Min color distance: {args.min_distance}")
    print(f"Max colors: {args.max_colors}")
    print()

    results = process_directory(args.input_dir, output_dir, args.min_distance, args.max_colors)

    # Generate and print report
    report = generate_report(results)
    print("\n" + report)

    # Save report if requested
    if args.report:
        args.report.write_text(report)
        print(f"\nReport saved to: {args.report}")

    # Save JSON if requested
    if args.json:
        args.json.write_text(json.dumps(results, indent=2))
        print(f"Results saved to: {args.json}")

    return results


if __name__ == "__main__":
    main()
