"""Data structures for the nonogram solver."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# Color 0 is reserved for empty/transparent cells
EMPTY = 0


@dataclass
class Clue:
    """A single clue entry: count of consecutive cells of a color."""
    count: int
    color: int  # Color ID (1+), EMPTY (0) not used in clues

    def __repr__(self) -> str:
        return f"{self.count}c{self.color}"


@dataclass
class Puzzle:
    """A nonogram puzzle definition."""
    width: int
    height: int
    row_clues: list[list[Clue]]  # Clues for each row
    col_clues: list[list[Clue]]  # Clues for each column
    color_map: dict[int, tuple[int, int, int]]  # Color ID -> RGB
    solution: Optional[list[list[int]]] = None  # Original image (for validation)

    def __repr__(self) -> str:
        return f"Puzzle({self.width}x{self.height}, {len(self.color_map)} colors)"


class CellState(Enum):
    """State of a cell during solving."""
    UNKNOWN = "?"
    EMPTY = "."  # Confirmed empty (marked X)
    # Filled states are represented by color IDs directly


@dataclass
class SolverMetrics:
    """
    Metrics collected during solving for difficulty scoring.

    Note: The solver uses arrangement enumeration which implicitly handles
    overlap, edge, and gap analysis in one unified approach. These techniques
    aren't tracked separately because the algorithm doesn't distinguish between
    them - it simply finds all valid arrangements and intersects them.

    The stuck_count metric serves as a proxy for cross-reference complexity:
    when the solver can't make progress on any single line, it indicates that
    information from perpendicular lines is needed.
    """
    total_steps: int = 0  # Total line-solving attempts
    cells_solved: int = 0  # Total cells determined
    overlap_uses: int = 0  # Lines where progress was made
    stuck_count: int = 0  # Iterations with no single-line progress (needs cross-reference)
    backtrack_depth: int = 0  # Max depth of guessing tree
    backtrack_count: int = 0  # Number of guesses made

    def max_technique_level(self) -> int:
        """
        Return the highest technique level required.

        Levels:
            1 - Simple overlap (single-line deduction sufficient)
            2 - Cross-reference (needed info from perpendicular lines)
            3 - Backtracking/guessing (logic alone insufficient)
        """
        if self.backtrack_count > 0:
            return 3  # Backtracking/guessing
        if self.stuck_count > 0:
            return 2  # Cross-reference needed
        return 1  # Simple overlap only


class Difficulty(Enum):
    """Difficulty bucket for a puzzle."""
    TRIVIAL = "trivial"
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    CHALLENGING = "challenging"
    EXPERT = "expert"
    MASTER = "master"


@dataclass
class Grid:
    """Working grid state during solving."""
    width: int
    height: int
    cells: list[list[int | None]]  # None=unknown, 0=empty, 1+=color

    @classmethod
    def create_empty(cls, width: int, height: int) -> "Grid":
        """Create a grid with all cells unknown."""
        cells = [[None for _ in range(width)] for _ in range(height)]
        return cls(width, height, cells)

    def get(self, row: int, col: int) -> int | None:
        """Get cell value. None=unknown, 0=empty, 1+=color."""
        return self.cells[row][col]

    def set(self, row: int, col: int, value: int | None) -> bool:
        """Set cell value. Returns True if this was a change."""
        if self.cells[row][col] == value:
            return False
        if self.cells[row][col] is not None and value is not None:
            # Conflict - cell already set to different value
            raise ValueError(f"Conflict at ({row}, {col}): {self.cells[row][col]} vs {value}")
        self.cells[row][col] = value
        return True

    def get_row(self, row: int) -> list[int | None]:
        """Get a row as a list."""
        return self.cells[row][:]

    def get_col(self, col: int) -> list[int | None]:
        """Get a column as a list."""
        return [self.cells[row][col] for row in range(self.height)]

    def set_row(self, row: int, values: list[int | None]) -> int:
        """Set row values, returns count of changes."""
        changes = 0
        for col, val in enumerate(values):
            if val is not None and self.cells[row][col] is None:
                self.cells[row][col] = val
                changes += 1
        return changes

    def set_col(self, col: int, values: list[int | None]) -> int:
        """Set column values, returns count of changes."""
        changes = 0
        for row, val in enumerate(values):
            if val is not None and self.cells[row][col] is None:
                self.cells[row][col] = val
                changes += 1
        return changes

    def is_complete(self) -> bool:
        """Check if all cells are determined."""
        return all(
            cell is not None
            for row in self.cells
            for cell in row
        )

    def copy(self) -> "Grid":
        """Create a deep copy of the grid."""
        new_cells = [row[:] for row in self.cells]
        return Grid(self.width, self.height, new_cells)

    def unknown_count(self) -> int:
        """Count unknown cells."""
        return sum(
            1 for row in self.cells
            for cell in row
            if cell is None
        )

    def __repr__(self) -> str:
        lines = []
        for row in self.cells:
            line = ""
            for cell in row:
                if cell is None:
                    line += "?"
                elif cell == 0:
                    line += "."
                else:
                    line += str(cell % 10)  # Single digit for display
            lines.append(line)
        return "\n".join(lines)
