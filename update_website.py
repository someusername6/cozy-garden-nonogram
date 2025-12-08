#!/usr/bin/env python3
"""
Update play.html with puzzle data.

Usage:
    python update_website.py <puzzles.json> [--html FILE]

Example:
    python update_website.py puzzles.json
    python update_website.py puzzles.json --html play.html
"""

import argparse
import json
import re
import sys
from pathlib import Path


def update_html(html_path: Path, puzzles: list[dict]) -> bool:
    """Update the PUZZLES constant in the HTML file."""
    html = html_path.read_text()

    # Create the new PUZZLES constant (compact JSON)
    js_puzzles = "    const PUZZLES = " + json.dumps(puzzles, separators=(',', ': ')) + ";"

    # Replace the old PUZZLES array
    pattern = r'    const PUZZLES = \[[\s\S]*?\];'

    if not re.search(pattern, html):
        print("Error: Could not find PUZZLES constant in HTML file", file=sys.stderr)
        return False

    new_html = re.sub(pattern, js_puzzles, html, count=1)

    html_path.write_text(new_html)
    return True


def main():
    parser = argparse.ArgumentParser(description="Update play.html with puzzle data")
    parser.add_argument("puzzles_json", type=Path, help="JSON file containing puzzle data")
    parser.add_argument("--html", type=Path, default=Path("play.html"), help="HTML file to update (default: play.html)")

    args = parser.parse_args()

    if not args.puzzles_json.exists():
        print(f"Error: {args.puzzles_json} not found", file=sys.stderr)
        sys.exit(1)

    if not args.html.exists():
        print(f"Error: {args.html} not found", file=sys.stderr)
        sys.exit(1)

    # Load puzzles
    puzzles = json.loads(args.puzzles_json.read_text())

    print(f"Updating {args.html} with {len(puzzles)} puzzles...")

    if update_html(args.html, puzzles):
        print("Success!")
        print("\nPuzzles included:")
        for p in puzzles:
            print(f"  • {p['title']}")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
