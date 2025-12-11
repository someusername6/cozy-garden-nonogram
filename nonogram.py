"""
Nonogram puzzle generator and validator.

Main entry point for processing AI-generated images into validated puzzles.
"""

from pathlib import Path
from dataclasses import dataclass

from models import Puzzle, Difficulty
from generator import puzzle_from_image, puzzle_from_array, puzzle_from_grid
from validator import validate_puzzle, ValidationResult, ValidationReport
from difficulty import calculate_difficulty, DifficultyReport
from solver import solve, SolveResult


@dataclass
class PuzzleAnalysis:
    """Complete analysis of a puzzle candidate."""
    puzzle: Puzzle
    validation: ValidationReport
    difficulty: DifficultyReport | None

    @property
    def is_valid(self) -> bool:
        """Check if puzzle is valid (uniquely solvable)."""
        return self.validation.is_valid

    @property
    def difficulty_level(self) -> Difficulty | None:
        """Get difficulty level if valid."""
        return self.difficulty.difficulty if self.difficulty else None

    def summary(self) -> str:
        """Human-readable summary."""
        lines = [
            f"Puzzle: {self.puzzle.width}x{self.puzzle.height}, {len(self.puzzle.color_map)} colors",
            f"Status: {self.validation.result.value}",
            f"Message: {self.validation.message}",
        ]
        if self.difficulty:
            lines.append(f"Difficulty: {self.difficulty.difficulty.value} (score: {self.difficulty.score})")
        return "\n".join(lines)


def analyze_image(path: str | Path) -> PuzzleAnalysis:
    """
    Load an image and analyze it as a nonogram puzzle.

    Args:
        path: Path to image file (PNG, etc.)

    Returns:
        PuzzleAnalysis with validation and difficulty results
    """
    puzzle = puzzle_from_image(path)
    return analyze_puzzle(puzzle)


def analyze_puzzle(puzzle: Puzzle) -> PuzzleAnalysis:
    """
    Analyze a puzzle for validity and difficulty.

    Args:
        puzzle: Puzzle to analyze

    Returns:
        PuzzleAnalysis with results
    """
    validation = validate_puzzle(puzzle)

    difficulty = None
    if validation.is_valid and validation.solve_result:
        difficulty = calculate_difficulty(puzzle, validation.solve_result.metrics)

    return PuzzleAnalysis(
        puzzle=puzzle,
        validation=validation,
        difficulty=difficulty
    )


def process_batch(
    image_paths: list[str | Path],
    min_difficulty: Difficulty | None = None,
    max_difficulty: Difficulty | None = None,
) -> list[PuzzleAnalysis]:
    """
    Process multiple images, filtering to valid puzzles.

    Args:
        image_paths: List of image paths
        min_difficulty: Minimum difficulty to include
        max_difficulty: Maximum difficulty to include

    Returns:
        List of valid PuzzleAnalysis objects
    """
    difficulty_order = [
        Difficulty.EASY,
        Difficulty.MEDIUM,
        Difficulty.HARD,
        Difficulty.EXPERT,
    ]

    results = []
    for path in image_paths:
        try:
            analysis = analyze_image(path)

            if not analysis.is_valid:
                continue

            if analysis.difficulty_level:
                level_idx = difficulty_order.index(analysis.difficulty_level)

                if min_difficulty:
                    min_idx = difficulty_order.index(min_difficulty)
                    if level_idx < min_idx:
                        continue

                if max_difficulty:
                    max_idx = difficulty_order.index(max_difficulty)
                    if level_idx > max_idx:
                        continue

            results.append(analysis)

        except Exception as e:
            print(f"Error processing {path}: {e}")
            continue

    return results


# Convenience re-exports
__all__ = [
    "analyze_image",
    "analyze_puzzle",
    "process_batch",
    "puzzle_from_image",
    "puzzle_from_array",
    "puzzle_from_grid",
    "solve",
    "validate_puzzle",
    "calculate_difficulty",
    "Puzzle",
    "Difficulty",
    "ValidationResult",
    "PuzzleAnalysis",
]
