# Cozy Garden - Nonogram Puzzle Game

## Project Overview

A colored nonogram puzzle game with a cozy garden theme. Players solve pixel art puzzles of flowers, plants, and garden elements.

**Current Status:** Fully playable PWA with 122 puzzles across 5 difficulty levels.

**Positioning:** The "Stardew Valley of nonograms" - cozy, quality-focused, zen. No timers, no pressure, no competitive features. Target audience is players seeking relaxation, not competition.

## Architecture

```
nonogram/
├── index.html          # Web player entry point
├── css/
│   └── style.css       # Game styles (~1900 lines)
├── js/
│   ├── game.js         # Core gameplay logic (IIFE pattern) + puzzle normalization
│   ├── screens.js      # Screen management (splash, home, collection, puzzle, victory, settings, tutorial)
│   ├── collection.js   # Collection screen with puzzle cards + search
│   ├── storage.js      # LocalStorage persistence
│   ├── history.js      # Undo/redo system
│   ├── zoom.js         # Pinch-to-zoom for mobile
│   └── app.js          # PWA initialization, offline handling
├── data/
│   └── puzzles.js      # Puzzle data (window.PUZZLE_DATA) - auto-generated, concise format
├── images/
│   └── input/          # Source pixel art sprites (122 PNG files)
├── build_puzzles.py    # Main content pipeline
├── solver.py           # Nonogram solver with uniqueness checking
├── validator.py        # Puzzle validation
├── difficulty.py       # Difficulty scoring algorithm
├── palette.py          # Color reduction and image processing
├── generator.py        # Puzzle generation from images
├── models.py           # Data models (Puzzle, Clue, etc.)
├── GAME_DESIGN.md      # Full design document
├── prompts.txt         # Retrodiffusion prompts used
└── report.txt          # Latest build report
```

## Key Commands

### Build all puzzles and update website
```bash
python3 build_puzzles.py images/input --report report.txt
```
This outputs puzzle data to `data/puzzles.js` by default (~175KB for 122 puzzles).

### View the game
```bash
open index.html
```

## Game Features

### Implemented
- Colored nonogram gameplay with pen/pencil modes
- Clue satisfaction indicators (dim + strikethrough when line is complete)
- Win detection via clue validation (not solution comparison)
- Winning without explicitly marking empty cells
- Undo/redo with full history
- Progress persistence (localStorage)
- Collection view with puzzle cards showing completion status and partial progress
- Collection search (substring matching on puzzle names)
- Victory screen with stamp collection animation
- Stamp animation when returning from puzzle via back button
- Tutorial for first-time users
- Settings (sound/music/vibration toggles, reset progress)
- Settings: "Solve All Puzzles" debug button (for testing)
- PWA support (offline capable, installable)
- Pinch-to-zoom on mobile
- Crosshair hover effect on desktop

### Not Yet Implemented
- Sound effects
- Daily puzzle feature

### Deliberately Not Adding
- **Hint system**: Doesn't fit the zen philosophy. Players already have pencil mode, undo/redo, clue satisfaction indicators, and "Show Solution" for when truly stuck. Hints would undermine the satisfaction of genuine solving.
- **Timers or time tracking**: Contradicts the relaxation focus.
- **Leaderboards or competitive features**: Not aligned with cozy positioning.
- **Energy systems**: Dark pattern, avoid entirely.

## Market Context

### Target Audience
- 75% of puzzle game players are women aged 25-44 seeking stress relief
- Players wanting "me time" and escapism, not competition
- Cottagecore/garden aesthetic appeals strongly to this demographic

### Competitive Differentiation
| Competitors | Cozy Garden |
|-------------|-------------|
| Thousands of generic puzzles | Curated, themed collection |
| Tournaments, leaderboards | No pressure, no timers |
| Energy systems, aggressive ads | Respectful, ethical |
| Random pixel art | Coherent garden theme |
| Basic completion | Stamp collection animation |

### Technical Advantages
- Guaranteed unique solutions (solver validates)
- Sophisticated difficulty scoring algorithm
- PWA = no app store friction, works offline
- Quality-of-life features competitors lack (clue satisfaction, pen/pencil modes)

## Monetization Strategy

### Recommended Model: Simple Level Sectioning
- **Free tier**: ~25-30 puzzles across ALL difficulty levels (not just easy)
- **Premium** ($3.99-4.99 one-time): Full collection + future updates

This is clean, honest, and respects players. Mixing difficulties in free tier sets accurate expectations.

### Optional Enhancement
- Free tier: "Show Solution" has a brief delay (30-60 seconds) encouraging one more attempt
- Premium: Instant solution reveal

### Avoid
- Aggressive ads or interstitials during gameplay
- Pay-to-win hint consumables
- Progressive unlock gates ("solve X to unlock Y")
- Subscription models (first thing players cancel)

## Publishing Strategy

### Phase 1: itch.io (Lowest Friction)
- Create pseudonymous account
- Upload HTML5 build
- Set price (pay-what-you-want or fixed $3.99-4.99)
- itch.io handles payments, takes 10%
- Post once to r/nonograms, r/WebGames, r/CozyGamers

### Phase 2 (Optional): Own Domain
- Buy domain (~$12/year)
- Host on Netlify/Vercel (free)
- Gumroad or itch.io widget for payments

### Phase 3 (Optional): Mobile Stores
- Use Capacitor to wrap PWA (same codebase)
- Google Play: $25 one-time fee
- iOS App Store: $99/year, requires Mac

### Marketing Approach
Given no marketing experience and preference for minimal social interaction:
- Post to relevant subreddits once at launch
- Let it exist and grow organically
- Use analytics (Plausible, not Google) for passive "playtesting"
- No need for active social media presence

## Content Strategy

### Current State
130 puzzles across 6 difficulty levels:
- Easy: 38 puzzles
- Medium: 38 puzzles
- Hard: 22 puzzles
- Challenging: 18 puzzles
- Expert: 11 puzzles
- Master: 3 puzzles (placeholder - may be modified or removed)

### Puzzle Collection by Series
Major flower series (3+ puzzles each):
- Red tulip (8), Iris (8), Sunflower (7), Zinnia (7), Carnation (7)
- Peony bloom (6), Poppy (5)
- Yellow marigold (4), Wild blue (4), Potted flower (4), Dandelion (4)
- Pink rose (3), Orange marigold (3), Wild pink (3), Lily (3), Ivory bloom (3), Daffodil (3), Coral rose (3), Bonsai (3), Bee (3)

Smaller series (2 puzzles): Violet, Terracotta pot, Red camellia, Cosmos, Cherry blossom, Azalea, Magenta tulip, Daisy

### Expansion Approach
1. Generate more puzzles using AI sprite pipeline
2. Filter aggressively by quality criteria:
   - Puzzle quality (visual appeal of revealed image)
   - Difficulty distribution (balanced across levels)
   - Color balance (good palette variety)
3. Quality over quantity - 100-150 excellent puzzles better than 500 mediocre ones

### Content Sustainability
The AI sprite → puzzle pipeline has limits but isn't exhausted. Options for future:
- Different themes (ocean life, space, food - not just garden)
- Manually drawn or commissioned pixel art
- Community submissions (validation pipeline can filter)
- The game can be "done" whenever - no obligation for infinite content

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
| Master | 600+ | Yes (placeholder - revisit later) |

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

## Puzzle Data Format

The `data/puzzles.js` file uses a concise format to reduce file size (~33% smaller than verbose):

```javascript
// Concise format (what's stored)
{
  "t": "Pink Rose 1 (8x7, easy)",  // title
  "w": 8, "h": 7,                   // dimensions
  "r": [[[2,0],[3,1]], ...],       // row_clues: [count, colorIndex] pairs
  "c": [[[1,0]], ...],             // col_clues
  "p": ["#943129","#c57283","#eddbe1"], // palette as hex
  "s": [[0,0,1,1,1,0,0], ...]      // solution: 0-indexed colors, -1 for empty
}
```

The `normalizePuzzle()` function in `js/game.js` converts to verbose format at runtime:
- Keys: t→title, w→width, h→height, r→row_clues, c→col_clues, p→color_map, s→solution
- Colors: 0-indexed → 1-indexed
- Palette: hex strings → RGB arrays in color_map object

## Sprite Naming and Organization

### Naming Convention
Files in `images/input/` follow: `[subject]_[number].png` or `[color]_[subject]_[number].png`
- Examples: `zinnia_5.png`, `iris_3.png`, `pink_rose_1.png`, `coral_rose_2.png`
- Numbers indicate difficulty order within series (1 = easiest)
- Single items have no number: `sunflower.png`, `red_rose.png`
- Color prefix only needed when multiple color variants exist (e.g., pink_rose vs coral_rose vs red_rose)

### Color Palette Unification
Flower series should share consistent color palettes. Common pattern:

```python
from PIL import Image
import colorsys

def get_lightness(rgb):
    r, g, b = rgb
    _, l, _ = colorsys.rgb_to_hls(r/255, g/255, b/255)
    return l

# Match colors by lightness between images
# Sort source/target colors by lightness, then map 1:1
```

Example unified palettes:
- **Coral rose**: dark green (40,80,45), green (85,140,75), medium coral (204,97,76), light coral (235,150,130)
- **Wild pink**: brown (89,0,0), pink (255,14,227), light pink (255,155,255), white (255,255,255)

### Common Color Operations
```python
# Remap a specific color
old_color = (178, 155, 185)
new_color = (235, 150, 130)
img = Image.open(path).convert('RGBA')
for y in range(img.height):
    for x in range(img.width):
        px = img.getpixel((x, y))
        if px[3] > 0 and px[:3] == old_color:
            img.putpixel((x, y), (*new_color, px[3]))
img.save(path)

# Detect color type by hue
def is_green(rgb):
    r, g, b = rgb
    h, l, s = colorsys.rgb_to_hls(r/255, g/255, b/255)
    hue_deg = h * 360
    return 60 < hue_deg < 180 and s > 0.1

def is_pink(rgb):
    r, g, b = rgb
    h, l, s = colorsys.rgb_to_hls(r/255, g/255, b/255)
    hue_deg = h * 360
    return ((hue_deg >= 300 or hue_deg <= 40) and s > 0.15 and r > g and r > b)
```

### Series Creation Workflow
1. Generate or acquire source sprites
2. Name files following convention
3. Analyze colors: `get_colors()` to see palette
4. Unify palette across series by lightness matching
5. Run `python3 build_puzzles.py images/input` to rebuild
6. Review difficulty scores in report, renumber if needed

## Known Issue: Pan when zoomed not working on mobile

**Problem:** When zoomed in on a puzzle, dragging to pan causes the page to scroll instead of panning the puzzle.

**Relevant files:**
- `js/zoom.js` - handles pinch-to-zoom and pan via touch events
- `js/game.js` - cell touch handlers use `stopPropagation()` to allow drawing
- `css/style.css` - `.zoom-container` has `touch-action: none`, `.app-main` has `overflow-y: auto`

**What was attempted (none worked):**
1. Added epsilon (0.001) to float comparisons
2. Added `e.preventDefault()` and `e.stopPropagation()` to touch handlers
3. Changed touchstart listener from `passive: true` to `passive: false`
4. Added `.app-main.zoom-locked` CSS class toggled by JS when zoomed

**Next steps to investigate:**
- Verify if `handleTouchStart` is being called via console.log
- Check if touch events are captured elsewhere before reaching zoom-container
- Consider using `document.addEventListener` with capture phase
- Test on actual mobile device vs Chrome DevTools
