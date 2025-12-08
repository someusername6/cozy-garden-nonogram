"""Quality scoring for nonogram puzzles.

Quality measures how satisfying and well-designed a puzzle is, independent of difficulty.
A trivially easy puzzle can be high quality (clear image, good proportions) or low quality
(boring pattern, wasted space). Quality is about the puzzle's design, not its challenge.

Quality Criteria:
1. Fill Ratio - 35-65% filled is ideal (not too sparse, not too dense)
2. Aspect Ratio - Reasonably proportional grids are better
3. Grid Size - Sweet spot is 8x8 to 25x25
4. Color Effectiveness - Each color should contribute meaningfully
5. Clue Variety - Mix of clue lengths is more interesting
6. Edge Utilization - Content should use the full grid, not just center
7. Line Balance - Mix of easy and harder lines across the puzzle
"""

from dataclasses import dataclass
from enum import Enum
from collections import Counter
import statistics

from models import Puzzle, Clue


class QualityGrade(Enum):
    """Quality grade for a puzzle."""
    EXCELLENT = "excellent"  # 85-100
    GOOD = "good"            # 70-84
    FAIR = "fair"            # 55-69
    POOR = "poor"            # 40-54
    BAD = "bad"              # 0-39


@dataclass
class QualityReport:
    """Detailed quality analysis."""
    grade: QualityGrade
    score: float  # 0-100 scale
    factors: dict[str, float]  # Individual factor scores (0-1)
    notes: list[str]  # Human-readable observations


def calculate_quality(puzzle: Puzzle) -> QualityReport:
    """
    Calculate quality score for a puzzle.

    Args:
        puzzle: The puzzle to score (must have solution)

    Returns:
        QualityReport with score and breakdown
    """
    if not puzzle.solution:
        raise ValueError("Puzzle must have solution for quality scoring")

    factors: dict[str, float] = {}
    notes: list[str] = []

    # Factor 1: Fill Ratio (35-65% ideal)
    fill_score, fill_note = _score_fill_ratio(puzzle)
    factors["fill_ratio"] = fill_score
    if fill_note:
        notes.append(fill_note)

    # Factor 2: Aspect Ratio (closer to square is better)
    aspect_score, aspect_note = _score_aspect_ratio(puzzle)
    factors["aspect_ratio"] = aspect_score
    if aspect_note:
        notes.append(aspect_note)

    # Factor 3: Grid Size (8x8 to 25x25 sweet spot)
    size_score, size_note = _score_grid_size(puzzle)
    factors["grid_size"] = size_score
    if size_note:
        notes.append(size_note)

    # Factor 4: Color Effectiveness
    color_score, color_note = _score_color_effectiveness(puzzle)
    factors["color_effectiveness"] = color_score
    if color_note:
        notes.append(color_note)

    # Factor 5: Clue Variety
    clue_score, clue_note = _score_clue_variety(puzzle)
    factors["clue_variety"] = clue_score
    if clue_note:
        notes.append(clue_note)

    # Factor 6: Edge Utilization
    edge_score, edge_note = _score_edge_utilization(puzzle)
    factors["edge_utilization"] = edge_score
    if edge_note:
        notes.append(edge_note)

    # Factor 7: Line Balance
    balance_score, balance_note = _score_line_balance(puzzle)
    factors["line_balance"] = balance_score
    if balance_note:
        notes.append(balance_note)

    # Factor 8: Clue Density (too many clues per line is bad UX)
    clue_density_score, clue_density_note = _score_clue_density(puzzle)
    factors["clue_density"] = clue_density_score
    if clue_density_note:
        notes.append(clue_density_note)

    # Combine factors with weights
    weights = {
        "fill_ratio": 1.5,        # Very important for visual appeal
        "aspect_ratio": 0.8,      # Moderately important
        "grid_size": 1.0,         # Important for playability
        "color_effectiveness": 1.2,  # Important for colored nonograms
        "clue_variety": 1.0,      # Affects solving experience
        "edge_utilization": 1.0,  # Visual composition
        "line_balance": 0.8,      # Solving rhythm
        "clue_density": 1.5,      # Critical for UX - too many clues is unplayable
    }

    weighted_sum = sum(factors[k] * weights[k] for k in factors)
    total_weight = sum(weights.values())
    raw_score = (weighted_sum / total_weight) * 100

    # Determine grade
    grade = _score_to_grade(raw_score)

    return QualityReport(
        grade=grade,
        score=round(raw_score, 1),
        factors=factors,
        notes=notes
    )


def _score_fill_ratio(puzzle: Puzzle) -> tuple[float, str | None]:
    """Score based on fill ratio. 35-65% is ideal."""
    filled = sum(
        1 for row in puzzle.solution
        for cell in row
        if cell != 0
    )
    total = puzzle.width * puzzle.height
    ratio = filled / total if total > 0 else 0

    # Ideal range: 0.35-0.65
    if 0.35 <= ratio <= 0.65:
        score = 1.0
        note = None
    elif ratio < 0.20:
        score = ratio / 0.20 * 0.5  # 0-50% score for very sparse
        note = f"Very sparse ({ratio:.0%} filled)"
    elif ratio < 0.35:
        score = 0.5 + (ratio - 0.20) / 0.15 * 0.5  # 50-100% for sparse
        note = f"Sparse ({ratio:.0%} filled)"
    elif ratio > 0.80:
        score = max(0.3, 1.0 - (ratio - 0.80) / 0.20)  # Penalize very dense
        note = f"Very dense ({ratio:.0%} filled)"
    else:  # 0.65-0.80
        score = 1.0 - (ratio - 0.65) / 0.15 * 0.3  # Slight penalty for dense
        note = None

    return score, note


def _score_aspect_ratio(puzzle: Puzzle) -> tuple[float, str | None]:
    """Score based on aspect ratio. Closer to square is better."""
    ratio = max(puzzle.width, puzzle.height) / min(puzzle.width, puzzle.height)

    if ratio <= 1.5:
        score = 1.0
        note = None
    elif ratio <= 2.0:
        score = 1.0 - (ratio - 1.5) / 0.5 * 0.2  # Small penalty
        note = None
    elif ratio <= 3.0:
        score = 0.8 - (ratio - 2.0) / 1.0 * 0.3  # Moderate penalty
        note = f"Elongated aspect ratio ({ratio:.1f}:1)"
    else:
        score = max(0.3, 0.5 - (ratio - 3.0) / 2.0 * 0.2)  # Heavy penalty
        note = f"Very elongated aspect ratio ({ratio:.1f}:1)"

    return score, note


def _score_grid_size(puzzle: Puzzle) -> tuple[float, str | None]:
    """Score based on grid size. 8x8 to 25x25 is ideal."""
    size = puzzle.width * puzzle.height
    min_dim = min(puzzle.width, puzzle.height)
    max_dim = max(puzzle.width, puzzle.height)

    # Too small
    if min_dim < 5:
        score = 0.3
        note = f"Very small grid ({puzzle.width}x{puzzle.height})"
    elif min_dim < 8:
        score = 0.5 + (min_dim - 5) / 3 * 0.3
        note = f"Small grid ({puzzle.width}x{puzzle.height})"
    # Too large
    elif max_dim > 35:
        score = 0.4
        note = f"Very large grid ({puzzle.width}x{puzzle.height})"
    elif max_dim > 25:
        score = 0.7 - (max_dim - 25) / 10 * 0.3
        note = f"Large grid ({puzzle.width}x{puzzle.height})"
    # Sweet spot
    else:
        score = 1.0
        note = None

    return score, note


def _score_color_effectiveness(puzzle: Puzzle) -> tuple[float, str | None]:
    """Score how effectively colors are used."""
    if len(puzzle.color_map) <= 1:
        return 0.5, "Single color puzzle"

    # Count cells per color
    color_counts = Counter()
    for row in puzzle.solution:
        for cell in row:
            if cell != 0:
                color_counts[cell] += 1

    total_filled = sum(color_counts.values())
    if total_filled == 0:
        return 0.3, "No filled cells"

    # Check for meaningful color distribution
    issues = []

    # 1. Colors with very few cells (<3% of filled)
    tiny_colors = [c for c, count in color_counts.items()
                   if count / total_filled < 0.03 and count < 5]
    if tiny_colors:
        issues.append(f"{len(tiny_colors)} colors with minimal use")

    # 2. Single color dominating (>75% of filled cells)
    max_ratio = max(count / total_filled for count in color_counts.values())
    if max_ratio > 0.85:
        issues.append(f"One color dominates ({max_ratio:.0%})")
    elif max_ratio > 0.75:
        issues.append(f"Color imbalance ({max_ratio:.0%} from one)")

    # Calculate score
    # Start with 1.0 and penalize for issues
    score = 1.0

    if tiny_colors:
        score -= 0.15 * min(len(tiny_colors), 3) / 3  # Up to -0.15

    if max_ratio > 0.75:
        score -= (max_ratio - 0.75) / 0.25 * 0.3  # Up to -0.3 for 100% dominance

    # Bonus for good balance (all colors between 10-60%)
    ratios = [count / total_filled for count in color_counts.values()]
    if all(0.10 <= r <= 0.60 for r in ratios):
        score = min(1.0, score + 0.1)

    score = max(0.2, score)

    note = "; ".join(issues) if issues else None
    return score, note


def _score_clue_variety(puzzle: Puzzle) -> tuple[float, str | None]:
    """Score variety in clue lengths. Mix is better than monotony."""
    all_clue_lengths = []

    for clues in puzzle.row_clues + puzzle.col_clues:
        for clue in clues:
            all_clue_lengths.append(clue.count)

    if not all_clue_lengths:
        return 0.5, "No clues"

    # Calculate variety metrics
    unique_lengths = len(set(all_clue_lengths))
    max_length = max(all_clue_lengths)
    avg_length = statistics.mean(all_clue_lengths)

    # Check for monotony
    if unique_lengths == 1:
        score = 0.3
        note = f"All clues are length {all_clue_lengths[0]}"
    elif unique_lengths <= 2 and max_length <= 2:
        score = 0.5
        note = "Limited clue variety (all short)"
    elif max_length <= 2:
        score = 0.6
        note = "No long clues"
    else:
        # Good variety - calculate coefficient of variation
        if len(all_clue_lengths) > 1:
            std_dev = statistics.stdev(all_clue_lengths)
            cv = std_dev / avg_length if avg_length > 0 else 0
            # CV of 0.5-1.0 is good variety
            if cv < 0.3:
                score = 0.7
                note = "Low clue variety"
            elif cv > 1.5:
                score = 0.8
                note = None  # High variety is fine
            else:
                score = 1.0
                note = None
        else:
            score = 0.5
            note = None

    return score, note


def _score_edge_utilization(puzzle: Puzzle) -> tuple[float, str | None]:
    """Score how well edges are utilized vs empty border."""
    h, w = puzzle.height, puzzle.width

    # Count filled cells in edges vs center
    edge_filled = 0
    edge_total = 0
    center_filled = 0
    center_total = 0

    for r in range(h):
        for c in range(w):
            is_edge = r == 0 or r == h - 1 or c == 0 or c == w - 1
            cell = puzzle.solution[r][c]

            if is_edge:
                edge_total += 1
                if cell != 0:
                    edge_filled += 1
            else:
                center_total += 1
                if cell != 0:
                    center_filled += 1

    if edge_total == 0:
        return 1.0, None

    edge_ratio = edge_filled / edge_total
    center_ratio = center_filled / center_total if center_total > 0 else 0

    # Check for "floating" content (empty edges around filled center)
    if edge_ratio < 0.1 and center_ratio > 0.3:
        score = 0.5
        note = "Content doesn't reach edges (floating)"
    elif edge_ratio < 0.2 and center_ratio > edge_ratio * 2:
        score = 0.7
        note = "Sparse edges"
    else:
        # Calculate how balanced edge vs center is
        if center_ratio > 0:
            balance = min(edge_ratio / center_ratio, center_ratio / edge_ratio)
        else:
            balance = edge_ratio

        score = 0.6 + balance * 0.4
        note = None

    return min(1.0, score), note


def _score_line_balance(puzzle: Puzzle) -> tuple[float, str | None]:
    """Score balance of line complexity across the puzzle."""
    # Estimate line difficulty by number of clue segments
    row_complexities = [len(clues) for clues in puzzle.row_clues]
    col_complexities = [len(clues) for clues in puzzle.col_clues]
    all_complexities = row_complexities + col_complexities

    if not all_complexities or max(all_complexities) == 0:
        return 0.5, "Empty puzzle"

    # Check for imbalance
    avg = statistics.mean(all_complexities)

    # Count "trivial" lines (0 or 1 clue segment)
    trivial_count = sum(1 for c in all_complexities if c <= 1)
    trivial_ratio = trivial_count / len(all_complexities)

    # Count "complex" lines (4+ clue segments)
    complex_count = sum(1 for c in all_complexities if c >= 4)
    complex_ratio = complex_count / len(all_complexities)

    issues = []
    score = 1.0

    # Too many trivial lines
    if trivial_ratio > 0.5:
        score -= 0.3
        issues.append(f"{trivial_ratio:.0%} trivial lines")
    elif trivial_ratio > 0.3:
        score -= 0.1

    # Good mix has both simple and complex lines
    if complex_ratio > 0.1 and trivial_ratio < 0.4:
        score = min(1.0, score + 0.1)  # Bonus for good mix

    # Check variance
    if len(all_complexities) > 1:
        variance = statistics.variance(all_complexities)
        if variance < 0.5 and avg > 1:
            issues.append("Monotonous line complexity")
            score -= 0.15

    score = max(0.3, score)
    note = "; ".join(issues) if issues else None
    return score, note


def _score_clue_density(puzzle: Puzzle) -> tuple[float, str | None]:
    """Score based on clue counts per line. Too many clues = bad UX.

    Thresholds:
    - <= 10 clues max: Excellent (1.0)
    - 11-12 clues max: Good (0.85)
    - 13-15 clues max: Fair (0.65) - getting crowded
    - 16-20 clues max: Poor (0.4) - hard to display
    - > 20 clues max: Bad (0.2) - unplayable UI
    """
    row_counts = [len(clues) for clues in puzzle.row_clues]
    col_counts = [len(clues) for clues in puzzle.col_clues]
    all_counts = row_counts + col_counts

    if not all_counts:
        return 0.5, "No clues"

    max_clues = max(all_counts)
    lines_with_many = sum(1 for c in all_counts if c >= 10)
    total_lines = len(all_counts)
    many_ratio = lines_with_many / total_lines

    # Score based on max clues per line
    if max_clues <= 8:
        score = 1.0
        note = None
    elif max_clues <= 10:
        score = 0.95
        note = None
    elif max_clues <= 12:
        score = 0.85
        note = f"Dense clues (max {max_clues}/line)"
    elif max_clues <= 15:
        score = 0.65
        note = f"Very dense clues (max {max_clues}/line)"
    elif max_clues <= 20:
        score = 0.4
        note = f"Overcrowded clues (max {max_clues}/line)"
    else:
        score = 0.2
        note = f"Unplayable clue density (max {max_clues}/line)"

    # Additional penalty if many lines have 10+ clues
    if many_ratio > 0.3 and max_clues > 10:
        score *= 0.9
        if note:
            note += f"; {many_ratio:.0%} lines have 10+ clues"
        else:
            note = f"{many_ratio:.0%} lines have 10+ clues"

    return max(0.1, score), note


def _score_to_grade(score: float) -> QualityGrade:
    """Convert score (0-100) to quality grade."""
    if score >= 85:
        return QualityGrade.EXCELLENT
    elif score >= 70:
        return QualityGrade.GOOD
    elif score >= 55:
        return QualityGrade.FAIR
    elif score >= 40:
        return QualityGrade.POOR
    else:
        return QualityGrade.BAD
