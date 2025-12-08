# Cozy Garden - Game Design Document

## Concept

A relaxing colored nonogram puzzle game where players reveal pixel art of flowers, plants, and garden elements. Each completed puzzle "grows" a piece of the player's virtual garden collection.

## Theme: Cozy Garden

**Tagline:** "Solve puzzles. Grow your garden."

**Mood:** Calm, satisfying, wholesome

**Color Palette:** Soft pastels, natural greens, warm earth tones, bright flower accents

---

## Target Audience

- **Primary:** Casual puzzle fans, 25-55 years old
- **Secondary:** Plant/garden enthusiasts, pixel art fans
- **Play Style:** Short sessions (5-15 min), low stress, progression-focused

---

## Core Mechanics

### Colored Nonograms
- Grid-based logic puzzles
- Clues indicate runs of colored cells per row/column
- Players deduce cell colors using logic (no guessing required)
- All puzzles have unique solutions (validated by solver)

### Controls
- Tap clue to select color
- Tap or drag to fill cells
- Right-click/long-press to mark empty
- Auto-fill completed lines (optional setting)

---

## Content Categories

Current inventory: **112 source images** → **57 valid puzzles**

### Flowers (59 images → ~35 valid)
Generated varieties: cherry blossom, lavender, poppy, marigold, morning glory, daffodil, lily, peony, carnation, iris, tulip, rose, daisy, sunflower

### Potted Plants (31 images → ~15 valid)
Generated varieties: terracotta pots, hanging baskets, mixed herbs, bonsai, vines

### Garden Elements (22 images → ~7 valid)
Generated varieties: birds on fence, butterflies, bees, snails, vegetables (tomato, strawberry, carrot, corn)

### Current Puzzle Distribution
| Difficulty | Count | Score Range |
|------------|-------|-------------|
| Easy | 15 | 3-10 |
| Medium | 16 | 10-20 |
| Hard | 9 | 20-50 |
| Challenging | 10 | 50-200 |
| Expert | 7 | 200-600 |

### Content Not Yet Implemented
- Seasonal collections (spring, summer, autumn, winter themes)
- More garden items (watering can, gnome, birdhouse)
- Expanded vegetable garden

---

## Progression System

### Garden Collection
- Each completed puzzle adds the flower/plant to player's garden
- Garden is a visual collection screen showing all unlocked items
- Items can be arranged/decorated (light customization)

### Difficulty Curve
1. **Seedling (Tutorial):** 5x5 to 6x6, 2-3 colors
2. **Sprout:** 8x8, 3-4 colors
3. **Budding:** 10x10, 4-5 colors
4. **Blooming:** 12x12, 5-6 colors
5. **Master Gardener:** 14x14+, 6+ colors

### Unlock Flow
- Linear progression with optional side puzzles
- Daily puzzle (free)
- Seasonal event puzzles (limited time)

---

## Monetization (Optional)

### Free-to-Play Model
- Energy system (5 hearts, recharge over time)
- Hints (reveal a cell/row)
- Ad-supported (watch ad for extra heart)

### Premium Model
- One-time purchase ($2.99-$4.99)
- All puzzles unlocked
- No ads, no energy

### Hybrid
- Free base game with ads
- IAP to remove ads ($1.99)
- Expansion packs ($0.99 each)

---

## Art Direction

### Pixel Art Style
- Clean, grid-aligned pixels
- Limited palettes (4-8 colors per puzzle)
- No anti-aliasing or gradients
- Clear silhouettes at small sizes

### Color Guidelines
- Flowers: Saturated, cheerful
- Leaves/stems: Natural greens (2-3 shades)
- Backgrounds: Transparent (empty cells)
- Pots/items: Warm earth tones

### Reference Palettes
- **Spring:** `#F8B4C4`, `#7EC8A3`, `#FFF5BA`, `#C5E8B7`
- **Summer:** `#FFD93D`, `#FF6B6B`, `#4ECDC4`, `#95E1D3`
- **Autumn:** `#F4A460`, `#CD853F`, `#8B4513`, `#DAA520`
- **Winter:** `#DC143C`, `#228B22`, `#FFFAFA`, `#B0C4DE`

---

## Technical Requirements

### Puzzle Validation
- All puzzles must have exactly one solution
- Solver validates before publishing (30s timeout)
- Difficulty scored automatically based on solving techniques
- Colors must be visually distinct (MIN_COLOR_DISTANCE = 35 perceptual)
- Max 15 clues per line (too_dense rejection)

### Difficulty Scoring
Score is calculated from: grid size, fill ratio, color count, clue fragmentation, technique level, and backtracking requirements.

| Difficulty | Score Range | Included |
|------------|-------------|----------|
| Trivial | < 3 | No |
| Easy | 3-10 | Yes |
| Medium | 10-20 | Yes |
| Hard | 20-50 | Yes |
| Challenging | 50-200 | Yes |
| Expert | 200-600 | Yes |
| Master | 600+ | No |

### Content Pipeline
1. Generate 16x16 pixel art with Retrodiffusion (rd_plus__low_res)
2. Place PNGs in `test_images/<category>/`
3. Run `python build_puzzles.py test_images/<dirs>...`
4. Pipeline automatically: trims, reduces palette (max 6 colors), validates, scores
5. Valid puzzles (easy-expert) are written to `data/puzzles.js`
6. Review report.txt for failures

### Failure Reasons
- **valid_multiple**: Multiple solutions exist (needs art adjustment)
- **timeout**: Solver took >30s (too complex)
- **too_dense**: >15 clues per line
- **colors_too_similar**: Colors not visually distinct (increase source contrast)
- **too_complex**: Solver couldn't complete

### Supported Platforms
- iOS (primary)
- Android
- Web (secondary) - currently implemented

---

## MVP Scope

### Phase 1: Prototype - COMPLETE
- [x] Core nonogram solver
- [x] Uniqueness validator
- [x] Difficulty scoring (7 levels: trivial → master)
- [x] Web-based player (modular: index.html + css/ + js/ + data/)
- [x] Content pipeline (build_puzzles.py → data/puzzles.js)
- [x] 57 puzzles across 5 difficulty levels
- [x] Color similarity validation (MIN_COLOR_DISTANCE = 35)
- [x] Automatic palette reduction (max 6 colors)

### Phase 2: Vertical Slice
- [ ] Garden collection screen
- [ ] Progress saving (localStorage)
- [ ] Sound effects
- [ ] Mobile-friendly touch controls
- [ ] More garden elements variety

### Phase 3: Launch
- [ ] 100+ puzzles
- [ ] Seasonal content system
- [ ] Daily puzzle
- [ ] Monetization
- [ ] App store submission

---

## Prompt Templates for Retrodiffusion

Use `rd_plus__low_res` at 16x16 with these prompts:

```
red rose flower, pixel art, side view, green stem
yellow sunflower, pixel art, front view, brown center
pink tulip flower, pixel art, side view, green leaves
purple lavender sprig, pixel art, vertical
white daisy flower, pixel art, front view, yellow center
green succulent plant, pixel art, top view, rosette shape
terracotta pot with cactus, pixel art, front view
orange butterfly, pixel art, top view, wings spread
red ladybug, pixel art, top view, black spots
```

---

## Open Questions

1. ~~Should empty cells be transparent or a background color?~~ → Transparent (index 0 = empty)
2. Include a "zen mode" with no timers/scores? (Current implementation has no timer)
3. Add achievements/badges for completion milestones?
4. Support user-generated puzzles in future?
5. Should Master difficulty (score 600+) be included or remain excluded?
6. Mobile touch control improvements needed?
