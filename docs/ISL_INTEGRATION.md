# ISL-DESTified Integration

This document describes how SpellLearning integrates with the ISL-DESTified (Immersive Spell Learning - Don't Eat Spell Tomes) mod.

## Overview

When ISL-DESTified is detected, SpellLearning can optionally intercept spell tome reading events and convert them to XP for our progression system instead of using ISL's built-in learning mechanics.

## How It Works

### Detection

On game data load, `ISLIntegration::Initialize()` checks for:
- `DEST_ISL.esp`
- `DEST_ISL.esl`

If either is found, ISL integration becomes available.

### Event Flow

```
Player reads spell tome
        ↓
ISL's DontEatSpellTomes.dll fires OnSpellTomeRead
        ↓
Our SpellLearning_ISL_Handler.psc receives event
        ↓
Calls native SpellLearning_ISL.OnTomeRead()
        ↓
ISLIntegration::OnSpellTomeRead() processes
        ↓
If spell is learnable: Grant XP
If not learnable: Show "insufficient knowledge" message
```

### XP Calculation

```cpp
float studyHours = CalculateStudyHours(spell);  // Based on spell tier
float baseXP = studyHours * xpPerHour;          // Default 50 XP/hour

// Apply tome bonus if player has the tome in inventory
if (PlayerHasTomeForSpell(spell)) {
    baseXP *= (1.0f + tomeInventoryBonus);  // Default +25%
}
```

Study hours by tier (approximation of ISL's formula):
- Novice: 1 hour
- Apprentice: 2 hours
- Adept: 4 hours
- Expert: 8 hours
- Master: 16 hours

## Configuration

Settings available in the UI under "Mod Integrations":

| Setting | Default | Description |
|---------|---------|-------------|
| Enable ISL Integration | On | Toggle integration on/off |
| XP Per Study Hour | 50 | XP gained per hour of tome study |
| Tome Inventory Bonus | 25% | Extra XP when learning spell's tome is in inventory |

## File Structure

### C++ Code

- `plugin/src/ISLIntegration.h` - Header with config struct and function declarations
- `plugin/src/ISLIntegration.cpp` - Implementation

### Papyrus Scripts

- `Scripts/Source/SpellLearning_ISL.psc` - Native function stubs
- `Scripts/Source/SpellLearning_ISL_Handler.psc` - ReferenceAlias event handler

### ESP Setup

See `esp/ESP_SETUP_GUIDE.md` for instructions on creating the required ESP file in xEdit.

The ESP requires:
1. Quest: `SpellLearning_ISL_Quest` (Start Game Enabled)
2. Player Alias with `SpellLearning_ISL_Handler` script attached

## Papyrus API

### SpellLearning_ISL (Native Functions)

```papyrus
; Called when a spell tome is read
; Returns true if we handled it, false otherwise
bool Function OnTomeRead(Book akBook, Spell akSpell, ObjectReference akContainer) global native

; Check if integration is active (ISL detected AND enabled in settings)
bool Function IsIntegrationActive() global native

; Get current settings
float Function GetXPPerHour() global native
float Function GetTomeBonus() global native

; Enable/disable integration
Function SetEnabled(bool enabled) global native
```

## Integration Requirements

1. **ISL-DESTified mod installed** - The `DEST_ISL.esp` must be loaded
2. **SpellLearning_ISL.esp patch** - Our quest with player alias
3. **Integration enabled** - Toggle in settings must be on
4. **Spell in our tree** - The spell must exist in the loaded spell tree

## Behavior

### When ISL Integration is Active

- Tome reading triggers our XP system
- ISL's default "study time" menu is bypassed (our alias gets the event first)
- Player sees XP gain notification
- Progress updates in SpellLearning UI

### When Spell is Not Available

If the player reads a tome for a spell not in our tree:
- Message: "Your knowledge is insufficient to grasp this tome."
- ISL's default behavior takes over (study time system)

### When Integration is Disabled

- ISL's normal behavior applies
- Study time menu appears
- No XP granted through our system

## Troubleshooting

### "ISL not detected"
- Ensure DEST_ISL.esp is enabled and loaded
- Check load order (should be before SpellLearning_ISL.esp)

### "No XP granted on tome read"
- Verify integration is enabled in settings
- Check if spell is in your loaded tree
- Review SpellLearning.log for error messages

### "Script not found" errors
- Compile the Papyrus scripts
- Ensure .pex files are in Scripts folder
- Check script names match exactly

## Future Improvements

- Read ISL's actual calculated study hours instead of approximating
- Option to use both systems simultaneously (ISL study time + our XP)
- Unregister ISL's alias to fully disable their handler
