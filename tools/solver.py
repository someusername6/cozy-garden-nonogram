"""Core nonogram solver with support for colored puzzles."""

from dataclasses import dataclass
from typing import Iterator

from models import Clue, Puzzle, Grid, SolverMetrics, EMPTY


@dataclass
class SolveResult:
    """Result of a solve attempt."""
    solved: bool
    grid: Grid
    metrics: SolverMetrics
    solutions_found: int = 1  # For uniqueness checking
    timed_out: bool = False  # True if solver hit iteration limit


def solve_line(line: list[int | None], clues: list[Clue]) -> list[int | None] | None:
    """
    Solve a single line given current state and clues.

    Returns:
        Updated line with any newly determined cells, or None if invalid.
    """
    if not clues:
        # No clues means entire line must be empty
        result = []
        for cell in line:
            if cell is not None and cell != EMPTY:
                return None  # Conflict: has colored cell but no clues
            result.append(EMPTY)
        return result

    # Generate all valid arrangements and find intersection
    valid_arrangements = list(generate_arrangements(line, clues))

    if not valid_arrangements:
        return None  # No valid arrangement exists

    # Find cells that are the same in ALL valid arrangements
    result = line[:]
    for i in range(len(line)):
        if result[i] is not None:
            continue  # Already known

        # Check if all arrangements agree on this cell
        values = set(arr[i] for arr in valid_arrangements)
        if len(values) == 1:
            result[i] = values.pop()

    return result


def generate_arrangements(
    line: list[int | None],
    clues: list[Clue]
) -> Iterator[list[int]]:
    """
    Generate all valid arrangements of clues in a line.

    Respects already-placed cells in the line.
    """
    length = len(line)

    def recurse(pos: int, clue_idx: int, current: list[int]) -> Iterator[list[int]]:
        """Recursively build valid arrangements."""
        if clue_idx == len(clues):
            # All clues placed, fill rest with empty
            remaining = [EMPTY] * (length - pos)
            # Verify against known cells
            full = current + remaining
            if is_compatible(line, full):
                yield full
            return

        clue = clues[clue_idx]
        # Calculate minimum space needed for remaining clues
        # Only count separators between same-colored adjacent clues
        min_remaining = sum(c.count for c in clues[clue_idx:])
        for i in range(clue_idx, len(clues) - 1):
            if clues[i].color == clues[i + 1].color:
                min_remaining += 1  # Need separator between same colors

        # Try placing this clue at each valid position
        for start in range(pos, length - min_remaining + 1):
            # Fill empty cells before this clue
            prefix = current + [EMPTY] * (start - pos)

            # Check if we can place the clue here
            end = start + clue.count
            if end > length:
                break

            # Verify placement is compatible with known cells
            can_place = True
            for i in range(start, end):
                if line[i] is not None and line[i] != clue.color:
                    can_place = False
                    break

            if not can_place:
                # Check if we MUST place here (known cell requires this color)
                must_stop = False
                for i in range(pos, start):
                    if line[i] is not None and line[i] == clue.color:
                        must_stop = True
                        break
                if must_stop:
                    break
                continue

            # Check prefix compatibility
            prefix_ok = True
            for i, val in enumerate(prefix[len(current):], start=pos):
                if line[i] is not None and line[i] != EMPTY:
                    prefix_ok = False
                    break
            if not prefix_ok:
                # Must stop if we passed a cell that needs this color
                must_stop = False
                for i in range(pos, start):
                    if line[i] is not None and line[i] == clue.color:
                        must_stop = True
                        break
                if must_stop:
                    break
                continue

            # Place the clue
            placed = prefix + [clue.color] * clue.count

            # If not last clue, need separator (empty or different color)
            next_pos = end
            if clue_idx < len(clues) - 1:
                next_clue = clues[clue_idx + 1]
                if next_clue.color == clue.color:
                    # Same color: need at least one empty between
                    if end < length:
                        if line[end] is not None and line[end] != EMPTY:
                            continue  # Can't place separator
                        placed = placed + [EMPTY]
                        next_pos = end + 1
                    else:
                        continue  # No room for separator

            yield from recurse(next_pos, clue_idx + 1, placed)

    yield from recurse(0, 0, [])


def is_compatible(line: list[int | None], arrangement: list[int]) -> bool:
    """Check if an arrangement is compatible with known cells."""
    for known, arr in zip(line, arrangement):
        if known is not None and known != arr:
            return False
    return True


class Solver:
    """Nonogram solver with metrics tracking."""

    def __init__(self, puzzle: Puzzle):
        self.puzzle = puzzle
        self.grid = Grid.create_empty(puzzle.width, puzzle.height)
        self.metrics = SolverMetrics()

    def solve(self) -> SolveResult:
        """
        Attempt to solve the puzzle using constraint propagation.

        Returns solved grid and metrics.
        """
        changed = True
        iterations = 0
        max_iterations = self.puzzle.width * self.puzzle.height * 10

        while changed and iterations < max_iterations:
            changed = False
            iterations += 1

            # Process all rows
            for row_idx in range(self.puzzle.height):
                row_changed = self._solve_row(row_idx)
                if row_changed is None:
                    # Invalid state
                    return SolveResult(
                        solved=False,
                        grid=self.grid,
                        metrics=self.metrics,
                        solutions_found=0
                    )
                changed = changed or row_changed

            # Process all columns
            for col_idx in range(self.puzzle.width):
                col_changed = self._solve_col(col_idx)
                if col_changed is None:
                    return SolveResult(
                        solved=False,
                        grid=self.grid,
                        metrics=self.metrics,
                        solutions_found=0
                    )
                changed = changed or col_changed

            if not changed and not self.grid.is_complete():
                self.metrics.stuck_count += 1

        if self.grid.is_complete():
            self.metrics.cells_solved = self.puzzle.width * self.puzzle.height
            return SolveResult(
                solved=True,
                grid=self.grid,
                metrics=self.metrics
            )

        # Not complete - would need backtracking
        return SolveResult(
            solved=False,
            grid=self.grid,
            metrics=self.metrics,
            solutions_found=0
        )

    def _solve_row(self, row_idx: int) -> bool | None:
        """Solve a single row. Returns True if changed, None if invalid."""
        line = self.grid.get_row(row_idx)
        clues = self.puzzle.row_clues[row_idx]

        result = solve_line(line, clues)
        if result is None:
            return None

        changes = self.grid.set_row(row_idx, result)
        self.metrics.total_steps += 1
        if changes > 0:
            self.metrics.overlap_uses += 1
        return changes > 0

    def _solve_col(self, col_idx: int) -> bool | None:
        """Solve a single column. Returns True if changed, None if invalid."""
        line = self.grid.get_col(col_idx)
        clues = self.puzzle.col_clues[col_idx]

        result = solve_line(line, clues)
        if result is None:
            return None

        changes = self.grid.set_col(col_idx, result)
        self.metrics.total_steps += 1
        if changes > 0:
            self.metrics.overlap_uses += 1
        return changes > 0


class BacktrackingSolver(Solver):
    """Solver with backtracking for puzzles that need guessing."""

    def __init__(self, puzzle: Puzzle, max_solutions: int = 2, max_backtracks: int = 500):
        super().__init__(puzzle)
        self.max_solutions = max_solutions
        self.max_backtracks = max_backtracks
        self.solutions: list[Grid] = []
        self.timed_out = False

    def solve(self) -> SolveResult:
        """Solve with backtracking, counting solutions up to max_solutions."""
        self._solve_recursive(self.grid)

        if self.timed_out:
            return SolveResult(
                solved=False,
                grid=self.grid,
                metrics=self.metrics,
                solutions_found=0,
                timed_out=True
            )
        elif len(self.solutions) == 1:
            return SolveResult(
                solved=True,
                grid=self.solutions[0],
                metrics=self.metrics,
                solutions_found=1
            )
        elif len(self.solutions) > 1:
            return SolveResult(
                solved=True,
                grid=self.solutions[0],
                metrics=self.metrics,
                solutions_found=len(self.solutions)
            )
        else:
            return SolveResult(
                solved=False,
                grid=self.grid,
                metrics=self.metrics,
                solutions_found=0
            )

    def _solve_recursive(self, grid: Grid) -> bool:
        """Recursively solve with backtracking."""
        if len(self.solutions) >= self.max_solutions:
            return True  # Found enough solutions

        if self.metrics.backtrack_count >= self.max_backtracks:
            self.timed_out = True
            return True  # Stop - too complex

        # Apply constraint propagation
        working_grid = grid.copy()
        solver = Solver(self.puzzle)
        solver.grid = working_grid

        changed = True
        while changed:
            changed = False
            for row_idx in range(self.puzzle.height):
                result = solver._solve_row(row_idx)
                if result is None:
                    return False  # Invalid
                changed = changed or result

            for col_idx in range(self.puzzle.width):
                result = solver._solve_col(col_idx)
                if result is None:
                    return False
                changed = changed or result

        self.metrics.total_steps += solver.metrics.total_steps

        if working_grid.is_complete():
            self.solutions.append(working_grid.copy())
            return True

        # Find first unknown cell
        guess_cell = None
        for row in range(self.puzzle.height):
            for col in range(self.puzzle.width):
                if working_grid.get(row, col) is None:
                    guess_cell = (row, col)
                    break
            if guess_cell:
                break

        if not guess_cell:
            return False

        row, col = guess_cell
        self.metrics.backtrack_count += 1
        self.metrics.backtrack_depth = max(self.metrics.backtrack_depth, 1)

        # Try each possible value
        possible_colors = set(self.puzzle.color_map.keys()) | {EMPTY}

        for color in possible_colors:
            try:
                test_grid = working_grid.copy()
                test_grid.set(row, col, color)
                self._solve_recursive(test_grid)
                if len(self.solutions) >= self.max_solutions:
                    return True
            except ValueError:
                continue  # Conflict, try next

        return len(self.solutions) > 0


def solve(puzzle: Puzzle, check_uniqueness: bool = False) -> SolveResult:
    """
    Solve a puzzle.

    Args:
        puzzle: The puzzle to solve
        check_uniqueness: If True, verify solution is unique

    Returns:
        SolveResult with solution and metrics
    """
    if check_uniqueness:
        solver = BacktrackingSolver(puzzle, max_solutions=2)
    else:
        solver = BacktrackingSolver(puzzle, max_solutions=1)

    return solver.solve()
