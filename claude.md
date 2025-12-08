# Cozy Garden - Nonogram Puzzle Game

## Project Overview

A colored nonogram puzzle game with a cozy garden theme. Players solve pixel art puzzles of flowers, plants, and garden elements.

**Current Status:** Phase 1 (Prototype) complete with 57 playable puzzles.

## Architecture

```
nonogram/
├── index.html          # Web player entry point
├── css/
│   └── style.css       # Game styles
├── js/
│   └── game.js         # Game logic (IIFE pattern)
├── data/
│   └── puzzles.js      # Puzzle data (window.PUZZLE_DATA)
├── build_puzzles.py    # Main content pipeline
├── solver.py           # Nonogram solver with uniqueness checking
├── validator.py        # Puzzle validation
├── difficulty.py       # Difficulty scoring algorithm
├── palette.py          # Color reduction and image processing
├── generator.py        # Puzzle generation from images
├── models.py           # Data models (Puzzle, Clue, etc.)
├── test_images/        # Source 16x16 pixel art
│   ├── flowers/        # 59 flower images
│   ├── potted_plants/  # 31 plant images
│   └── garden_elements/# 22 garden element images
├── GAME_DESIGN.md      # Full design document
├── prompts.txt         # Retrodiffusion prompts used
└── report.txt          # Latest build report
```

## Key Commands

### Build all puzzles and update website
```bash
python build_puzzles.py test_images/flowers test_images/potted_plants test_images/garden_elements --report report.txt
```
This outputs puzzle data to `data/puzzles.js` by default.

### Legacy: Update old monolithic HTML (deprecated)
```bash
python build_puzzles.py ... --html play.html
```

### Test a single image
```python
from build_puzzles import process_single_image
result = process_single_image(Path("image.png"), Path("output.png"), 100.0, 6, timeout_seconds=30)
```

### View the game
```bash
open index.html
```

## Important Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| MIN_COLOR_DISTANCE | 35 | build_puzzles.py:46 | Minimum perceptual distance between palette colors |
| max_colors | 6 | build_puzzles.py CLI | Maximum colors per puzzle |
| timeout_seconds | 30 | build_puzzles.py CLI | Solver timeout |
| max_clues_per_line | 15 | build_puzzles.py:113 | Rejects puzzles with too many clues |

## Difficulty Thresholds (difficulty.py)

| Difficulty | Score Range | Included in Game |
|------------|-------------|------------------|
| Trivial | < 3 | No |
| Easy | 3-10 | Yes |
| Medium | 10-20 | Yes |
| Hard | 20-50 | Yes |
| Challenging | 50-200 | Yes |
| Expert | 200-600 | Yes |
| Master | 600+ | No (too hard) |

## Common Issues and Fixes

### "colors_too_similar" rejection
Source image has colors that look too similar after palette reduction.
**Fix:** Increase contrast on the source image using PIL:
```python
from PIL import Image, ImageEnhance
img = Image.open("image.png")
enhanced = ImageEnhance.Contrast(img).enhance(1.3)  # Try 1.1-1.5
enhanced.save("image.png")
```

### "valid_multiple" rejection
Puzzle has multiple valid solutions.
**Fix:** Modify the pixel art to add asymmetry or distinctive features.

### "timeout" rejection
Solver takes >30s (puzzle is computationally complex).
**Fix:** Try reducing max_colors, or simplify the image.

### "too_dense" rejection
More than 15 clues in a single row/column.
**Fix:** Simplify the image or increase min_distance for palette reduction.

## Perceptual Color Distance Formula
```python
def perceptual_color_distance(c1, c2):
    r1, g1, b1 = c1
    r2, g2, b2 = c2
    return ((r1-r2)**2 * 0.30 + (g1-g2)**2 * 0.59 + (b1-b2)**2 * 0.11) ** 0.5
```
Weights: Green (0.59) > Red (0.30) > Blue (0.11) to match human perception.

## Image Generation

Images are generated with Retrodiffusion using model `rd_plus__low_res` at 16x16.
See `prompts.txt` for example prompts. Tips:
- Asymmetric designs work better for unique solutions
- Strong color contrast helps pass color similarity checks
- Simple silhouettes are more recognizable at small sizes

## Next Steps (Phase 2)

1. Add garden collection screen (show unlocked puzzles)
2. Implement progress saving with localStorage
3. Add sound effects
4. Improve mobile touch controls
5. Generate more garden elements variety

## Files Modified Recently

- Source images with contrast enhancement applied:
  - white_lily_1.png, white_lily_2.png
  - pink_rose_bloom_1/2/3.png
  - purple_iris_1/2/5.png
  - purple_lavender_sprig_1/2/4.png
  - blue_morning_glory_vine_1/2.png
  - red_carnation_8.png
  - hanging_basket_4.png, terracota_pot_2.png, vine_7.png
  - bird_on_fence_1.png, butterfly_1.png
