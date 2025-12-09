#!/usr/bin/env python3
"""
Analyze puzzle clue counts and show cumulative breakdown by difficulty.

Usage:
    python analyze_clues.py

This reads from data/puzzles.js and outputs a table showing how many puzzles
of each difficulty would be included at various max clue thresholds.
"""

import json
import re
from collections import defaultdict

def load_puzzles():
    """Load puzzles from data/puzzles.js"""
    with open('data/puzzles.js', 'r') as f:
        content = f.read()

    # Extract JSON array from the JS file
    match = re.search(r'window\.PUZZLE_DATA\s*=\s*(\[.*\]);?\s*$', content, re.DOTALL)
    if not match:
        raise ValueError("Could not parse puzzles.js")

    return json.loads(match.group(1))

def get_max_clues(puzzle):
    """Get the maximum number of clues in any single row or column"""
    max_clues = 0

    for row_clues in puzzle['row_clues']:
        max_clues = max(max_clues, len(row_clues))

    for col_clues in puzzle['col_clues']:
        max_clues = max(max_clues, len(col_clues))

    return max_clues

def get_difficulty(title):
    """Extract difficulty from puzzle title"""
    title_lower = title.lower()
    if 'expert' in title_lower:
        return 'expert'
    elif 'challenging' in title_lower:
        return 'challenging'
    elif 'hard' in title_lower:
        return 'hard'
    elif 'medium' in title_lower:
        return 'medium'
    elif 'easy' in title_lower:
        return 'easy'
    return 'unknown'

def main():
    puzzles = load_puzzles()

    # Collect data: (max_clues, difficulty) for each puzzle
    puzzle_data = []
    for puzzle in puzzles:
        max_clues = get_max_clues(puzzle)
        difficulty = get_difficulty(puzzle['title'])
        puzzle_data.append((max_clues, difficulty, puzzle['title']))

    # Find the range of max clues
    all_max_clues = [d[0] for d in puzzle_data]
    min_clue = min(all_max_clues)
    max_clue = max(all_max_clues)

    print(f"Max clues range: {min_clue} to {max_clue}")
    print(f"Total puzzles: {len(puzzles)}")
    print()

    # Difficulty order for display
    difficulties = ['easy', 'medium', 'hard', 'challenging', 'expert']

    # Build cumulative table
    print("Cumulative puzzle counts by max clue threshold:")
    print()

    # Header
    header = "Max Clues | " + " | ".join(f"{d:>11}" for d in difficulties) + " | Total"
    print(header)
    print("-" * len(header))

    # For each threshold, count puzzles at or below that threshold
    for threshold in range(min_clue, max_clue + 1):
        counts = defaultdict(int)
        for max_clues, difficulty, title in puzzle_data:
            if max_clues <= threshold:
                counts[difficulty] += 1

        total = sum(counts.values())
        row = f"{threshold:>9} | " + " | ".join(f"{counts[d]:>11}" for d in difficulties) + f" | {total:>5}"
        print(row)

    print()
    print("=" * 60)
    print()

    # Also show the distribution of max clues
    print("Distribution of max clues per puzzle:")
    print()

    clue_dist = defaultdict(list)
    for max_clues, difficulty, title in puzzle_data:
        clue_dist[max_clues].append((difficulty, title))

    for clue_count in sorted(clue_dist.keys()):
        puzzles_at_count = clue_dist[clue_count]
        diff_counts = defaultdict(int)
        for diff, _ in puzzles_at_count:
            diff_counts[diff] += 1

        diff_str = ", ".join(f"{d}: {c}" for d, c in sorted(diff_counts.items(), key=lambda x: difficulties.index(x[0]) if x[0] in difficulties else 99))
        print(f"  {clue_count} clues: {len(puzzles_at_count)} puzzles ({diff_str})")

    print()
    print("=" * 60)
    print()

    # Show puzzles with highest clue counts (potential candidates for removal)
    print("Puzzles with 8+ clues in a row/column:")
    print()

    high_clue_puzzles = [(mc, diff, title) for mc, diff, title in puzzle_data if mc >= 8]
    high_clue_puzzles.sort(key=lambda x: (-x[0], x[2]))

    for max_clues, difficulty, title in high_clue_puzzles:
        print(f"  {max_clues} clues: {title}")

if __name__ == '__main__':
    main()
