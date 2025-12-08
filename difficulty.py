"""Difficulty scoring for nonogram puzzles."""

from dataclasses import dataclass

from models import Puzzle, SolverMetrics, Difficulty
from solver import solve


@dataclass
class DifficultyReport:
    """Detailed difficulty analysis."""
    difficulty: Difficulty
    score: float  # Raw numeric score (0-100+)
    metrics: SolverMetrics
    factors: dict[str, float]  # Breakdown of contributing factors


def calculate_difficulty(puzzle: Puzzle, metrics: SolverMetrics | None = None) -> DifficultyReport:
    """
    Calculate difficulty score for a puzzle.

    Args:
        puzzle: The puzzle to score
        metrics: Pre-computed solver metrics (will solve if not provided)

    Returns:
        DifficultyReport with score and breakdown
    """
    if metrics is None:
        result = solve(puzzle, check_uniqueness=False)
        metrics = result.metrics

    factors: dict[str, float] = {}

    # Factor 1: Grid size (larger = harder)
    size_factor = (puzzle.width * puzzle.height) / 100  # Normalized to 10x10 = 1.0
    factors["size"] = size_factor

    # Factor 2: Fill ratio penalty (40-60% is hardest)
    if puzzle.solution:
        filled = sum(
            1 for row in puzzle.solution
            for cell in row
            if cell != 0
        )
        total = puzzle.width * puzzle.height
        fill_ratio = filled / total if total > 0 else 0
        # Penalty is highest at 50%, lower at extremes
        fill_penalty = 1.0 - abs(fill_ratio - 0.5) * 2
        factors["fill_ratio"] = fill_penalty
    else:
        factors["fill_ratio"] = 0.5  # Default

    # Factor 3: Color complexity
    num_colors = len(puzzle.color_map)
    # More colors can make it easier (more constraints) but also more complex
    color_factor = 1.0 + (num_colors - 1) * 0.1 if num_colors > 1 else 1.0
    factors["colors"] = color_factor

    # Factor 4: Clue fragmentation (many small clues = harder)
    total_clues = sum(len(clues) for clues in puzzle.row_clues + puzzle.col_clues)
    lines = puzzle.width + puzzle.height
    avg_clues_per_line = total_clues / lines if lines > 0 else 0
    clue_factor = avg_clues_per_line / 3  # Normalized to 3 clues/line = 1.0
    factors["clue_fragmentation"] = clue_factor

    # Factor 5: Technique level required
    technique_weights = {
        1: 0.5,   # Simple overlap only
        2: 1.0,   # Edge logic
        3: 1.5,   # Gap analysis
        4: 2.5,   # Cross-reference
        5: 4.0,   # Backtracking
    }
    technique_level = metrics.max_technique_level()
    technique_factor = technique_weights.get(technique_level, 1.0)
    factors["technique_level"] = technique_factor

    # Factor 6: Stuck count (needed cross-line deduction)
    stuck_factor = 1.0 + metrics.stuck_count * 0.3
    factors["stuck_penalty"] = stuck_factor

    # Factor 7: Backtracking penalty
    backtrack_factor = 1.0 + metrics.backtrack_count * 0.5 + metrics.backtrack_depth * 0.2
    factors["backtracking"] = backtrack_factor

    # Calculate raw score
    raw_score = (
        size_factor *
        factors["fill_ratio"] *
        color_factor *
        clue_factor *
        technique_factor *
        stuck_factor *
        backtrack_factor
    ) * 10  # Scale to more readable range

    # Determine difficulty bucket
    difficulty = _score_to_difficulty(raw_score, puzzle)

    return DifficultyReport(
        difficulty=difficulty,
        score=round(raw_score, 2),
        metrics=metrics,
        factors=factors
    )


def _score_to_difficulty(score: float, puzzle: Puzzle) -> Difficulty:
    """Convert raw score to difficulty bucket."""
    if score < 10:
        return Difficulty.EASY
    elif score < 20:
        return Difficulty.MEDIUM
    elif score < 50:
        return Difficulty.HARD
    elif score < 200:
        return Difficulty.CHALLENGING
    elif score < 600:
        return Difficulty.EXPERT
    else:
        return Difficulty.MASTER


def estimate_difficulty_structural(puzzle: Puzzle) -> Difficulty:
    """
    Quick structural estimate without solving.

    Less accurate but much faster - useful for pre-filtering.
    """
    size = puzzle.width * puzzle.height

    # Count clue complexity
    total_clues = sum(len(clues) for clues in puzzle.row_clues + puzzle.col_clues)
    lines = puzzle.width + puzzle.height
    avg_clues = total_clues / lines if lines > 0 else 0

    # Simple heuristic
    structural_score = size * (0.5 + avg_clues * 0.2)

    if structural_score < 20:
        return Difficulty.TRIVIAL
    elif structural_score < 50:
        return Difficulty.EASY
    elif structural_score < 100:
        return Difficulty.MEDIUM
    elif structural_score < 200:
        return Difficulty.HARD
    else:
        return Difficulty.EXPERT
