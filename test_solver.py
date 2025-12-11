"""Tests for the nonogram solver."""

import pytest

from models import Clue, Grid, EMPTY
from generator import puzzle_from_array, generate_clues
from solver import solve, solve_line
from validator import validate_puzzle, ValidationResult
from difficulty import calculate_difficulty, Difficulty


class TestClueGeneration:
    """Test clue generation from lines."""

    def test_simple_line(self):
        line = [1, 1, 0, 1, 1, 1]
        clues = generate_clues(line)
        assert len(clues) == 2
        assert clues[0] == Clue(count=2, color=1)
        assert clues[1] == Clue(count=3, color=1)

    def test_empty_line(self):
        line = [0, 0, 0, 0]
        clues = generate_clues(line)
        assert len(clues) == 0

    def test_full_line(self):
        line = [1, 1, 1, 1]
        clues = generate_clues(line)
        assert len(clues) == 1
        assert clues[0] == Clue(count=4, color=1)

    def test_multicolor_line(self):
        line = [1, 1, 2, 2, 2, 0, 1]
        clues = generate_clues(line)
        assert len(clues) == 3
        assert clues[0] == Clue(count=2, color=1)
        assert clues[1] == Clue(count=3, color=2)
        assert clues[2] == Clue(count=1, color=1)


class TestLineSolver:
    """Test single line solving."""

    def test_full_overlap(self):
        # Line of 5, clue is 5 -> must fill all
        line = [None, None, None, None, None]
        clues = [Clue(count=5, color=1)]
        result = solve_line(line, clues)
        assert result == [1, 1, 1, 1, 1]

    def test_partial_overlap(self):
        # Line of 5, clue is 3 -> middle cell must be filled
        line = [None, None, None, None, None]
        clues = [Clue(count=3, color=1)]
        result = solve_line(line, clues)
        # Only position 2 is guaranteed (overlap of all valid placements)
        assert result[2] == 1

    def test_no_clues(self):
        # No clues -> all empty
        line = [None, None, None]
        clues = []
        result = solve_line(line, clues)
        assert result == [EMPTY, EMPTY, EMPTY]

    def test_respects_known_cells(self):
        # Known filled cell constrains placement
        line = [None, None, 1, None, None]
        clues = [Clue(count=3, color=1)]
        result = solve_line(line, clues)
        # Clue must cover position 2, so positions 1-3 or 2-4
        assert result[2] == 1  # Known
        # Positions 0 and 4 can be determined based on constraints

    def test_invalid_line(self):
        # Known cell conflicts with clues
        line = [1, None, None]
        clues = []  # No clues but has filled cell
        result = solve_line(line, clues)
        assert result is None


class TestPuzzleSolver:
    """Test full puzzle solving."""

    def test_simple_puzzle(self):
        # Simple 3x3 puzzle - a diagonal line
        puzzle = puzzle_from_array([
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
        ])
        result = solve(puzzle)
        assert result.solved
        assert result.grid.is_complete()

    def test_solid_block(self):
        # 2x2 solid block
        puzzle = puzzle_from_array([
            [1, 1],
            [1, 1],
        ])
        result = solve(puzzle)
        assert result.solved
        for r in range(2):
            for c in range(2):
                assert result.grid.get(r, c) == 1

    def test_checkerboard_small(self):
        # 2x2 checkerboard - has multiple solutions without color!
        # But with single color, it should be solvable
        puzzle = puzzle_from_array([
            [1, 0],
            [0, 1],
        ])
        result = solve(puzzle, check_uniqueness=True)
        # This specific pattern should be uniquely solvable
        assert result.solved

    def test_multicolor_puzzle(self):
        # 3x3 with two colors
        puzzle = puzzle_from_array([
            [1, 2, 1],
            [2, 1, 2],
            [1, 2, 1],
        ])
        result = solve(puzzle)
        assert result.solved


class TestValidator:
    """Test puzzle validation."""

    def test_valid_unique_puzzle(self):
        puzzle = puzzle_from_array([
            [1, 1, 1],
            [1, 0, 1],
            [1, 1, 1],
        ])
        report = validate_puzzle(puzzle)
        assert report.result == ValidationResult.VALID_UNIQUE

    def test_empty_puzzle(self):
        puzzle = puzzle_from_array([
            [0, 0],
            [0, 0],
        ])
        report = validate_puzzle(puzzle)
        assert report.result == ValidationResult.INVALID_EMPTY

    def test_simple_valid(self):
        # L-shape
        puzzle = puzzle_from_array([
            [1, 0],
            [1, 0],
            [1, 1],
        ])
        report = validate_puzzle(puzzle)
        assert report.is_valid


class TestDifficulty:
    """Test difficulty scoring."""

    def test_simple_puzzle(self):
        # Small, simple puzzle should be Easy
        puzzle = puzzle_from_array([
            [1, 1],
            [1, 1],
        ])
        report = calculate_difficulty(puzzle)
        assert report.difficulty == Difficulty.EASY

    def test_larger_puzzle_harder(self):
        # Larger puzzles should generally be harder
        small = puzzle_from_array([[1, 1], [1, 1]])
        large = puzzle_from_array([
            [1, 0, 1, 0, 1],
            [0, 1, 0, 1, 0],
            [1, 0, 1, 0, 1],
            [0, 1, 0, 1, 0],
            [1, 0, 1, 0, 1],
        ])

        small_report = calculate_difficulty(small)
        large_report = calculate_difficulty(large)

        assert large_report.score >= small_report.score

    def test_factors_populated(self):
        puzzle = puzzle_from_array([
            [1, 0, 1],
            [0, 1, 0],
            [1, 0, 1],
        ])
        report = calculate_difficulty(puzzle)

        assert "size" in report.factors
        assert "fill_ratio" in report.factors
        assert "technique_level" in report.factors


class TestGrid:
    """Test grid operations."""

    def test_create_empty(self):
        grid = Grid.create_empty(5, 3)
        assert grid.width == 5
        assert grid.height == 3
        assert grid.unknown_count() == 15

    def test_set_and_get(self):
        grid = Grid.create_empty(3, 3)
        grid.set(1, 1, 1)
        assert grid.get(1, 1) == 1
        assert grid.get(0, 0) is None

    def test_is_complete(self):
        grid = Grid.create_empty(2, 2)
        assert not grid.is_complete()

        for r in range(2):
            for c in range(2):
                grid.set(r, c, 1)

        assert grid.is_complete()

    def test_copy(self):
        grid = Grid.create_empty(2, 2)
        grid.set(0, 0, 1)

        copy = grid.copy()
        copy.set(1, 1, 2)

        assert grid.get(1, 1) is None  # Original unchanged
        assert copy.get(1, 1) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
