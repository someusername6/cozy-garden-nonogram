"""Validate nonogram puzzles for solvability and uniqueness."""

from dataclasses import dataclass
from enum import Enum

from models import Puzzle, Grid
from solver import solve, SolveResult


class ValidationResult(Enum):
    """Result of puzzle validation."""
    VALID_UNIQUE = "valid_unique"  # Exactly one solution
    VALID_MULTIPLE = "valid_multiple"  # Solvable but not unique
    UNSOLVABLE = "unsolvable"  # No valid solution exists
    INVALID_EMPTY = "invalid_empty"  # Degenerate puzzle (zero size or all empty clues)
    TOO_COMPLEX = "too_complex"  # Solver timed out


@dataclass
class ValidationReport:
    """Detailed validation results."""
    result: ValidationResult
    solve_result: SolveResult | None
    message: str

    @property
    def is_valid(self) -> bool:
        """Check if puzzle is valid for use (unique solution)."""
        return self.result == ValidationResult.VALID_UNIQUE


def validate_puzzle(puzzle: Puzzle) -> ValidationReport:
    """
    Validate a puzzle for solvability and uniqueness.

    Returns:
        ValidationReport with detailed results
    """
    # Quick checks
    if puzzle.width == 0 or puzzle.height == 0:
        return ValidationReport(
            result=ValidationResult.INVALID_EMPTY,
            solve_result=None,
            message="Empty puzzle (zero dimensions)"
        )

    # Check if all clues are empty (fully transparent image)
    all_empty = all(
        len(clues) == 0
        for clues in puzzle.row_clues + puzzle.col_clues
    )
    if all_empty:
        return ValidationReport(
            result=ValidationResult.INVALID_EMPTY,
            solve_result=None,
            message="All clues empty (fully transparent image)"
        )

    # Attempt to solve and check uniqueness
    result = solve(puzzle, check_uniqueness=True)

    if result.timed_out:
        return ValidationReport(
            result=ValidationResult.TOO_COMPLEX,
            solve_result=result,
            message="Puzzle too complex (solver timed out)"
        )

    if result.solutions_found == 0:
        return ValidationReport(
            result=ValidationResult.UNSOLVABLE,
            solve_result=result,
            message="No valid solution exists"
        )

    if result.solutions_found == 1:
        # Verify solution matches original if available
        if puzzle.solution is not None:
            if not _grids_match(result.grid, puzzle.solution):
                return ValidationReport(
                    result=ValidationResult.UNSOLVABLE,
                    solve_result=result,
                    message="Solution does not match original image"
                )

        return ValidationReport(
            result=ValidationResult.VALID_UNIQUE,
            solve_result=result,
            message="Puzzle has exactly one solution"
        )

    return ValidationReport(
        result=ValidationResult.VALID_MULTIPLE,
        solve_result=result,
        message=f"Puzzle has multiple solutions (found {result.solutions_found}+)"
    )


def _grids_match(grid: Grid, solution: list[list[int]]) -> bool:
    """Check if solved grid matches expected solution."""
    for row in range(grid.height):
        for col in range(grid.width):
            if grid.get(row, col) != solution[row][col]:
                return False
    return True


def is_uniquely_solvable(puzzle: Puzzle) -> bool:
    """Quick check if puzzle has a unique solution."""
    return validate_puzzle(puzzle).is_valid


def validate_image_for_puzzle(
    grid: list[list[int]],
    color_map: dict[int, tuple[int, int, int]]
) -> ValidationReport:
    """
    Validate an image grid for use as a nonogram puzzle.

    This is a convenience function that creates a puzzle and validates it.
    """
    from generator import puzzle_from_grid
    puzzle = puzzle_from_grid(grid, color_map)
    return validate_puzzle(puzzle)
