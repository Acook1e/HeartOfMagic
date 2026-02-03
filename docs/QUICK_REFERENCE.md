# Spell Learning System - Quick Reference

**For LLMs:** Quick lookup for system structure, data formats, and implementation status.

---

## System Components

| Component | File | Status | Purpose |
|-----------|------|--------|---------|
| **SpellScanner** | `SpellScanner.cpp/h` | ✅ Done | Scan spells, generate LLM prompt |
| **UIManager** | `UIManager.cpp/h` | ✅ Done | PrismaUI bridge, hotkey handling |
| **TreeBuilder** | `TreeBuilder.cpp/h` | ❌ TODO | Parse LLM JSON, build tree graph |
| **ProgressionManager** | `ProgressionManager.cpp/h` | ❌ TODO | Track XP, manage learning targets |
| **EventHandlers** | `EventHandlers.cpp/h` | ❌ TODO | Listen to events, grant XP |
| **ISLIntegration** | `ISLIntegration.cpp/h` | ❌ TODO | ISL mod compatibility |

---

## Data Formats

### LLM Tree Output
```json
{
  "version": "1.0",
  "difficulty": "normal",
  "schools": {
    "Destruction": {
      "root": "Flames",
      "nodes": [{
        "spellId": "Flames",
        "formId": "0x00012FCD",
        "prerequisites": [],
        "children": ["Firebolt"],
        "requiredXP": 100,
        "isOrphaned": false
      }],
      "orphanedSpells": [{
        "spellId": "SpecialSpell",
        "formId": "0x000ABCDE",
        "requiredXP": 500,
        "isOrphaned": true
      }]
    }
  }
}
```

### Progression Save
```json
{
  "version": 1,
  "learnedSpells": ["0x00012FCD"],
  "spellProgress": {
    "0x00012FCD": { "currentXP": 100, "requiredXP": 100, "isLearned": true }
  },
  "learningTargets": { "Destruction": "0x0001C78A" }
}
```

---

## XP Calculation

```
Base XP = baseXPPerCast (5.0) * tierMultiplier
  - Novice: 1.0x
  - Apprentice: 1.5x
  - Adept: 2.0x
  - Expert: 2.5x
  - Master: 3.0x

Bonuses:
  - Hit: +50% base XP
  - Damage/Heal: +100% base XP
  - Buff: +75% base XP
  - Mastery: +5% per previous tier spell (max +50%)
  - Tome passive: +50% XP while owned

Direct prerequisite: Full XP
Indirect prerequisite (2+ steps): 50% XP
```

---

## Key Functions

### SpellScanner
- `ScanAllSpells(config)` → JSON string
- `GetSpellInfoByFormId(formId)` → Spell details JSON

### TreeBuilder (TODO)
- `ParseTreeFromLLM(json)` → Tree structure
- `ValidateTree()` → bool
- `SaveTree(path)` / `LoadTree(path)`

### ProgressionManager (TODO)
- `SetLearningTarget(school, spellId)`
- `GrantXP(spellId, amount)`
- `GetProgress(spellId)` → {currentXP, requiredXP}
- `CheckAutoLearn()` → Learn spells at 100%

### EventHandlers (TODO)
- `OnSpellCast(event)` → Grant base XP
- `OnSpellHit(event)` → Grant hit bonus
- `OnEffectApply(event)` → Grant damage/heal/buff bonuses

---

## Event Flow

```
Spell Cast → OnSpellCast()
  → Check if prerequisite for learning target
  → Calculate base XP (tier, mastery)
  → GrantXP()

Spell Hits → OnSpellHit()
  → Match to recent cast (5s window)
  → Grant hit bonus (+50%)

Effect Applied → OnEffectApply()
  → Match to recent cast
  → Grant damage/heal/buff bonus
  → GrantXP()

XP Reaches 100% → CheckAutoLearn()
  → Add spell to player
  → Mark as learned
  → Update UI
```

---

## Configuration

```yaml
progression:
  baseXPPerCast: 5.0
  tierMultipliers: { novice: 1.0, apprentice: 1.5, adept: 2.0, expert: 2.5, master: 3.0 }
  enableTierMasteryBonus: true
  tierMasteryMaxBonus: 0.5
  bonusXPOnHit: 0.5
  bonusXPOnDamage: 1.0
  bonusXPOnHeal: 1.0
  bonusXPOnBuff: 0.75
```

---

## Implementation Checklist

### Tier 2: Tree Building
- [ ] Parse LLM JSON response
- [ ] Validate spell references
- [ ] Build graph structure
- [ ] Handle orphaned spells
- [ ] Save/load tree

### Tier 3: Visualization
- [ ] Render tree (nodes/edges)
- [ ] Node states (locked/available/learning/learned/orphaned)
- [ ] Progress bars
- [ ] School filters

### Tier 4: Progression
- [ ] Learning target selection
- [ ] XP tracking (per spell)
- [ ] Event listeners (cast/hit/effect)
- [ ] Auto-learn at 100%
- [ ] Save/load progression

### Tier 5: Integration
- [ ] ISL mod detection
- [ ] Study time → XP conversion
- [ ] Tome ownership tracking
- [ ] Tome passive bonus

---

## Key Concepts

- **LLM determines XP requirements** - Not hardcoded, based on difficulty/complexity
- **Orphaned spells** - Don't fit tree, appear floating, no prerequisites
- **One target per school** - Can learn multiple spells (one per school)
- **Progress saved per spell** - All spells track XP, not just targets
- **Mastery bonus** - +5% per previous tier spell learned (max +50%)
- **Effective usage rewarded** - Combat grants more XP than practice

---

## File Locations

- **C++ Source:** `plugin/src/`
- **UI Views:** `PrismaUI/views/`
- **Config:** `SKSE/Plugins/SpellLearning/settings.yaml`
- **Tree Data:** `SKSE/Plugins/SpellLearning/spell_tree.json`
- **Progression:** `SKSE/Plugins/SpellLearning/progression.json` (or cosave)
