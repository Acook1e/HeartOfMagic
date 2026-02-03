# Heart of Magic — Overview

*Product name: **Heart of Magic**. Project/codebase: SpellLearning (unchanged for compatibility).*

## System Summary

A Skyrim SKSE mod that creates an AI-generated spell learning tree with an active, XP-based progression system. Players must practice prerequisite spells and study spell tomes to unlock new spells through a structured learning path.

---

## Core Concept

**Traditional Skyrim:** Find spell tome → Instantly learn spell

**This System:** 
- AI generates a logical spell tree with prerequisites
- Players set learning targets for spells they want to learn
- Gain XP by casting prerequisite spells and studying tomes
- Bonus XP for effective usage (hitting targets, damaging enemies, healing allies)
- Spells unlock automatically when XP reaches 100%

---

## System Architecture

### 1. Spell Scanner & Tree Generation
- Scans all spells from loaded plugins
- Extracts spell properties (school, tier, effects, cost, etc.)
- Sends data to LLM with prompt to generate learning tree
- LLM creates prerequisite chains grouped by magic school
- **LLM determines XP requirements** for each spell based on:
  - Spell complexity and tier
  - Expected casts needed (considering player will hit targets 70% of time, deal damage 50% of time)
  - Difficulty setting (easy/normal/hard/expert/master) - affects XP multiplier
  - Base XP per cast from configuration
  - Hit/damage/heal/buff bonus multipliers
  - Formula: `requiredXP = (ExpectedCasts * BaseXPPerCast * TierMultiplier) * DifficultyMultiplier`
- **LLM can mark spells as orphaned** (don't fit tree structure)
  - Orphaned spells appear floating in their school (separate from main tree)
  - No prerequisites required - can be learned immediately
  - Still have XP requirements (determined by LLM)
  - Examples: Unique quest reward spells, standalone utility spells, spells with unique mechanics
- Tree saved as JSON for in-game use (includes requiredXP and orphanedSpells)

### 2. Tree Visualization (PrismaUI)
- Interactive spell tree display (F9 hotkey)
- Shows nodes for each spell with connections
- Visual states: Locked, Available, Learning, Learned, Orphaned
- School tabs (Destruction, Conjuration, Alteration, Illusion, Restoration)
- Progress bars showing XP advancement
- **Orphaned spells** appear floating separately (no tree connections)

### 3. Progression System
- **Learning Targets**: Player selects spells to learn (one per school)
- **XP Tracking**: Per-spell XP progress, saved in cosave
- **Prerequisites**: Must unlock prerequisite spells before learning new ones
- **Automatic Learning**: Spell added to player when XP reaches 100%

### 4. XP Sources
- **Casting Prerequisites**: Base XP per cast (scaled by tier)
- **Tier Mastery Bonus**: Learning more spells from previous tier boosts next tier learning (+5% per spell, max +50%)
- **Spell Hits**: +50% bonus when spell hits target
- **Damage Effects**: +100% bonus when spell damages enemy
- **Healing Effects**: +100% bonus when spell heals ally
- **Buff Effects**: +75% bonus when spell applies beneficial effect
- **Tome Study**: Passive +50% XP bonus while tome owned
- **Active Study**: Large XP boost from studying tome (ISL integration)

---

## Progression Flow

### Example: Learning Fireball

1. **Prerequisites**: Must learn "Flames" and "Firebolt" first
2. **Set Target**: Player sets "Fireball" as learning target
   - LLM determined: 600 XP required (based on spell complexity and difficulty)
   - Player has learned 6/8 Apprentice Destruction spells → +37.5% mastery bonus
3. **Gain XP**:
   - Cast "Firebolt" 40 times → 40 * 7.5 XP = 300 XP (base)
   - With mastery bonus (+37.5%): 40 * 10.31 XP = 412.4 XP
   - All casts hit enemies → 40 * 20.63 XP = 825 XP (with damage bonus)
   - Own "Fireball" tome → +50% passive bonus = 1237.5 XP total
4. **Learn Spell**: XP exceeds 600 → "Fireball" automatically learned (much faster!)

### Example: Learning Orphaned Spell

1. **No Prerequisites**: Orphaned spell "UniqueQuestSpell" has no prerequisites
2. **Set Target**: Player sets "UniqueQuestSpell" as learning target
   - LLM determined: 400 XP required (standalone spell, moderate complexity)
3. **Gain XP**: Cast any spells from same school to gain XP
   - Or cast the spell itself if already known from quest
4. **Learn Spell**: XP reaches 400 → Spell automatically learned

### Key Mechanics

- **One Target Per School**: Can learn multiple spells simultaneously (one per magic school)
- **Progress Saved**: Can switch targets freely, progress is preserved
- **LLM-Determined XP**: Each spell's XP requirement is calculated by LLM based on complexity, difficulty, and expected casts
- **Orphaned Spells**: Some spells don't fit the tree (marked by LLM) - appear floating, no prerequisites needed
- **Tier Mastery**: Learning more spells from previous tier boosts next tier learning (+5% per spell, max +50%)
- **Effective Usage Rewarded**: Combat usage grants more XP than practice casting
- **Broad Exploration Rewarded**: Learning many spells from one tier makes the next tier easier

---

## Technical Implementation

### Event Tracking

**1. Spell Cast Tracking** (`TESSpellCastEvent`)
- Detects when player casts spells
- Grants base XP to learning targets
- Filters for prerequisite spells only

**2. Spell Hit Tracking** (`TESHitEvent`)
- Detects when player spells hit targets
- Grants +50% bonus XP for successful hits
- Distinguishes spell hits from weapon hits

**3. Effect Application Tracking** (`TESMagicEffectApplyEvent`)
- Detects when spell effects are applied
- Identifies effect types (damage, heal, buff)
- Grants appropriate bonus XP (+100% damage/heal, +75% buff)

**4. Recent Cast Tracking**
- Maintains queue of recently cast spells (5 second window)
- Matches hits/effects to originating spells
- Prevents false positives from NPC casts

### ISL Integration

**Immersive Spell Learning (ISL) Compatibility:**
- Detects ISL mod installation
- Monitors ISL global variables (`hoursStudiedTotal`, `hoursToMaster`)
- Converts study time to XP (configurable rate)
- Dual progression: ISL study + casting prerequisites

**Integration Methods:**
1. Global variable polling (initial implementation)
2. Direct API integration (if ISL exposes functions)
3. DLL hook (advanced, most reliable)

### Data Persistence

**Save Game Data:**
- Per-spell XP progress (all spells, not just active targets)
- Current learning targets per school
- Learned spell FormIDs
- Tome ownership/study status

**Storage:**
- SKSE cosave (serialization interface)
- JSON backup (optional)
- Version tracking for updates

---

## Configuration

### XP System
```yaml
baseXPPerCast: 5.0              # Base XP per spell cast
directPrereqMultiplier: 1.0      # Full XP for direct prerequisites
indirectPrereqMultiplier: 0.5    # 50% XP for indirect prerequisites

# Tier Mastery Bonus
enableTierMasteryBonus: true     # Enable mastery bonus system
tierMasteryMaxBonus: 0.5        # Maximum +50% XP gain from mastery
tierMasteryPerSpellBonus: 0.05  # +5% per spell learned (10 spells = 50%)

bonusXPOnHit: 0.5                # +50% when spell hits target
bonusXPOnDamage: 1.0             # +100% when spell damages enemy
bonusXPOnHeal: 1.0               # +100% when spell heals ally
bonusXPOnBuff: 0.75              # +75% when spell applies buff

tierMultipliers:
  novice: 1.0
  apprentice: 1.5
  adept: 2.0
  expert: 2.5
  master: 3.0
```

### XP Requirements & Difficulty
```yaml
# XP requirements are determined by LLM, not fixed values
# These are fallback defaults if LLM doesn't provide requiredXP
baseXPRequirements:
  novice: 100
  apprentice: 250
  adept: 500
  expert: 1000
  master: 2000

# Difficulty setting passed to LLM for XP calculation
difficulty: "normal"  # easy, normal, hard, expert, master
difficultyMultipliers:
  easy: 0.5      # LLM calculates 50% of normal XP requirements
  normal: 1.0    # Standard XP requirements
  hard: 1.5      # LLM calculates 150% of normal XP requirements
  expert: 2.0    # LLM calculates 200% of normal XP requirements
  master: 2.5    # LLM calculates 250% of normal XP requirements
```

### ISL Integration
```yaml
enableISLIntegration: true
islXPPerMinute: 0.5              # XP per minute of study time
islRealTimeMode: true            # Use real-time study
```

---

## User Experience

### Discovery
- **F9 Hotkey**: Opens Heart of Magic panel
- **First-Time Notification**: Brief tutorial message
- **MCM Integration**: Optional menu entry

### Learning Process
1. Open panel (F9)
2. Browse spell tree by school
3. Select spell to learn:
   - Tree spells: Must have prerequisites unlocked
   - Orphaned spells: No prerequisites needed (can learn immediately)
4. Cast prerequisite spells (or any spells from same school for orphaned spells) to gain XP
5. Find spell tome for bonus XP
6. Spell automatically learned when XP reaches requiredXP (determined by LLM)

### Visual Feedback
- **Locked**: Greyed out, prerequisites not met
- **Available**: Can be set as learning target
- **Learning**: Progress bar showing XP advancement
- **Learned**: Checkmark, spell known
- **Orphaned**: Floating position, standalone badge, no prerequisites needed

### Benefits
- **Structured Progression**: Clear learning path
- **Active Engagement**: Must practice to learn
- **Strategic Choices**: Choose which spells to learn
- **Tier Mastery Rewarded**: Learning broadly from one tier speeds up the next
- **Effective Usage Rewarded**: Combat grants more XP
- **Non-Intrusive**: Works alongside vanilla learning

---

## File Structure

```
SpellLearning/
├── plugin/              # SKSE C++ plugin
│   ├── src/
│   │   ├── Main.cpp              # Entry point, event registration
│   │   ├── SpellScanner.cpp      # Spell enumeration
│   │   ├── TreeBuilder.cpp       # LLM response parser
│   │   ├── ProgressionManager.cpp # XP tracking, spell learning
│   │   └── EventHandlers.cpp      # Spell cast/hit/effect tracking
│   └── CMakeLists.txt
├── PrismaUI/            # In-game UI
│   └── views/SpellLearningPanel/
│       ├── index.html
│       ├── script.js
│       └── styles.css
├── docs/
│   ├── DESIGN.md                 # Detailed system design
│   ├── PROGRESSION_DESIGN.md     # Progression mechanics
│   ├── TECHNICAL_RESEARCH.md     # Implementation details
│   └── OVERVIEW.md               # This file
└── data/
    ├── spell_scan_output.json    # Scanned spell data
    ├── spell_tree.json           # Generated learning tree
    └── progression.json          # Player progress (save-specific)
```

---

## Development Tiers

### Tier 1: Foundation ✅
- [x] PrismaUI panel setup
- [x] Spell scanning
- [x] LLM prompt generation
- [x] Basic UI display

### Tier 2: Tree Building (In Progress)
- [ ] LLM response parser
- [ ] Tree validation
- [ ] Tree persistence
- [ ] Import functionality

### Tier 3: Visualization
- [ ] Interactive tree rendering
- [ ] Node states (locked/available/learning/learned)
- [ ] Progress bars
- [ ] School filtering

### Tier 4: Progression System
- [ ] Learning target selection
- [ ] Spell cast tracking
- [ ] Spell hit/effect tracking
- [ ] XP calculation and granting
- [ ] Automatic spell learning

### Tier 5: Integration
- [ ] ISL mod compatibility
- [ ] Save game persistence
- [ ] Mod compatibility handling
- [ ] Performance optimization

---

## Key APIs Used

### CommonLibSSE-NG
- `RE::TESSpellCastEvent` - Spell cast detection
- `RE::TESHitEvent` - Spell hit detection
- `RE::TESMagicEffectApplyEvent` - Effect application detection
- `RE::ScriptEventSourceHolder` - Event registration
- `RE::PlayerCharacter` - Player reference
- `RE::SpellItem` - Spell data access
- `RE::Actor::VisitSpells()` - Spell knowledge checking

### SKSE
- `SKSE::SerializationInterface` - Save game persistence
- `SKSE::MessagingInterface` - Game lifecycle events
- `SKSE::GetTaskInterface()` - Main thread execution

### PrismaUI
- View registration and management
- JavaScript ↔ C++ communication
- Hotkey handling

---

## Summary

Heart of Magic transforms spell acquisition from random discovery into a structured, skill-based progression. Players actively practice prerequisite spells and study tomes to unlock new spells, with bonus XP rewarding effective combat usage. The system integrates seamlessly with existing Skyrim mechanics and optional mods like Immersive Spell Learning, providing a flexible and engaging learning experience.

**Core Philosophy:** Practice makes perfect - the more you use spells effectively, the faster you learn new ones.
