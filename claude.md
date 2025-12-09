# Cozy Garden - Nonogram Puzzle Game

## Project Overview

A colored nonogram puzzle game with a cozy garden theme. Players solve pixel art puzzles of flowers, plants, and garden elements.

**Current Status:** Fully playable PWA with 84 puzzles across 5 difficulty levels.

**Positioning:** The "Stardew Valley of nonograms" - cozy, quality-focused, zen. No timers, no pressure, no competitive features. Target audience is players seeking relaxation, not competition.

## Architecture

```
nonogram/
├── index.html          # Web player entry point
├── css/
│   └── style.css       # Game styles (~1900 lines)
├── js/
│   ├── game.js         # Core gameplay logic (IIFE pattern)
│   ├── screens.js      # Screen management (splash, home, collection, puzzle, victory, settings, tutorial)
│   ├── collection.js   # Collection screen with puzzle cards
│   ├── storage.js      # LocalStorage persistence
│   ├── history.js      # Undo/redo system
│   ├── zoom.js         # Pinch-to-zoom for mobile
│   └── app.js          # PWA initialization, offline handling
├── data/
│   └── puzzles.js      # Puzzle data (window.PUZZLE_DATA) - auto-generated
├── build_puzzles.py    # Main content pipeline
├── solver.py           # Nonogram solver with uniqueness checking
├── validator.py        # Puzzle validation
├── difficulty.py       # Difficulty scoring algorithm
├── palette.py          # Color reduction and image processing
├── generator.py        # Puzzle generation from images
├── models.py           # Data models (Puzzle, Clue, etc.)
├── test_images/        # Source 16x16 pixel art
│   ├── flowers/        # Flower images
│   ├── potted_plants/  # Plant images
│   └── garden_elements/# Garden element images
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
- Victory screen with stamp collection animation
- Stamp animation when returning from puzzle via back button
- Tutorial for first-time users
- Settings (sound/music/vibration toggles, reset progress)
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
84 puzzles is already substantial. Many premium puzzle games ship with less.

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
