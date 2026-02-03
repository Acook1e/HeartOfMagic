/**
 * SpellLearning Main Entry Point
 * 
 * Initializes all modules and sets up event listeners.
 * This should be loaded LAST after all other modules.
 * 
 * Load order:
 * 1. constants.js - Default prompts, profiles, palettes
 * 2. config.js - TREE_CONFIG
 * 3. state.js - settings, state objects
 * 4. spellCache.js - SpellCache
 * 5. colorUtils.js - Color management
 * 6. uiHelpers.js - UI utilities
 * 7. growthDSL.js - Growth recipe system
 * 8. treeParser.js - TreeParser
 * 9. script.js - WheelRenderer and all app logic (temporary until fully modularized)
 * 10. main.js - This file (initialization)
 */

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('[SpellLearning] Panel initializing (modular)...');
    
    // Initialize all components
    try {
        // Core UI
        if (typeof initializePanel === 'function') initializePanel();
        if (typeof initializeTabs === 'function') initializeTabs();
        if (typeof initializePromptEditor === 'function') initializePromptEditor();
        
        // Drag and resize
        if (typeof initializeDragging === 'function') initializeDragging();
        if (typeof initializeResizing === 'function') initializeResizing();
        
        // Tree viewer
        if (typeof initializeTreeViewer === 'function') initializeTreeViewer();
        
        // Settings
        if (typeof initializeSettings === 'function') initializeSettings();
        
        // Growth style generator
        if (typeof initializeGrowthStyleGenerator === 'function') initializeGrowthStyleGenerator();
        
        // Textarea enter key handling
        if (typeof initializeTextareaEnterKey === 'function') initializeTextareaEnterKey();
        
        console.log('[SpellLearning] Panel initialized successfully');
    } catch (e) {
        console.error('[SpellLearning] Initialization error:', e);
    }
});

// =============================================================================
// MODULE VERIFICATION
// =============================================================================

// Verify all required globals exist
(function verifyModules() {
    var required = [
        'DEFAULT_TREE_RULES',
        'DIFFICULTY_PROFILES', 
        'DEFAULT_COLOR_PALETTE',
        'KEY_CODES',
        'TREE_CONFIG',
        'settings',
        'state',
        'SpellCache',
        'TreeParser',
        'GROWTH_DSL'
    ];
    
    var missing = required.filter(function(name) {
        return typeof window[name] === 'undefined';
    });
    
    if (missing.length > 0) {
        console.warn('[SpellLearning] Missing globals:', missing.join(', '));
    } else {
        console.log('[SpellLearning] All required modules loaded');
    }
})();
