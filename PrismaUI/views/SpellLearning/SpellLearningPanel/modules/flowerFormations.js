/**
 * Flower Formations Module
 * 
 * Flowers are special nodes that claim a region and generate their own
 * sub-layout for child nodes. This creates visual clusters/patterns.
 * 
 * Formation types:
 * - burst: Radial explosion outward from center
 * - cube: Isometric 3D cube projection
 * - spiral: Fibonacci/golden spiral
 * - grid: Regular rectangular grid
 * - hub: Converging lines toward center
 * 
 * Depends on: layoutGenerator.js
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

// Flower config - proportional to node size (web harness uses ~1x nodeSize for radius)
// Web: nodeSize=32, flowerRadius=30 → ratio ~0.94
// In-game: nodeSize=75 → flowerRadius should be ~70
var FLOWER_CONFIG = {
    defaultSize: 70,          // ~1x nodeSize (web ratio)
    minChildren: 3,           // Same as web
    maxChildren: 6,           // Web uses 4-8 depending on type
    spacing: 55               // ~nodeSize * 0.75
};

// =============================================================================
// FORMATION GENERATORS
// =============================================================================

/**
 * Generate positions for a flower formation.
 * 
 * @param {Object} center - The flower center position {x, y, tier, ...}
 * @param {number} childCount - Number of child positions to generate
 * @param {string} formationType - 'burst', 'cube', 'spiral', 'grid', 'hub'
 * @param {Object} options - {size, seed, ...}
 * @returns {Array} - Array of child positions
 */
function generateFlowerFormation(center, childCount, formationType, options) {
    options = options || {};
    var size = options.size || FLOWER_CONFIG.defaultSize;
    
    var generator = FORMATIONS[formationType] || FORMATIONS.burst;
    var positions = generator(center, childCount, size, options);
    
    // Mark all positions as flower children
    positions.forEach(function(pos, i) {
        pos.isFlowerChild = true;
        pos.parentFlower = center;
        pos.flowerIndex = i;
        pos.tier = (center.tier || 0) + 1;  // Children are one tier higher
    });
    
    return positions;
}

var FORMATIONS = {
    
    /**
     * Burst: Radial explosion outward from center
     * Classic "starburst" pattern
     */
    burst: function(center, count, size, opts) {
        var positions = [];
        var angleStep = 360 / count;
        var startAngle = opts.startAngle || 0;
        
        for (var i = 0; i < count; i++) {
            var angle = startAngle + (i * angleStep);
            var rad = angle * Math.PI / 180;
            
            // Slight radius variation for organic feel
            var radiusVar = opts.radiusVariance || 0.15;
            var radius = size * (1 + (Math.random() - 0.5) * radiusVar);
            
            positions.push({
                x: center.x + Math.cos(rad) * radius,
                y: center.y + Math.sin(rad) * radius,
                angle: angle,
                radius: radius,
                gridAngle: center.gridAngle || center.angle,
                gridRadius: (center.gridRadius || center.radius) + radius
            });
        }
        
        return positions;
    },
    
    /**
     * Cube: Isometric 3D cube projection
     * Creates depth illusion with hexagonal arrangement
     */
    cube: function(center, count, size, opts) {
        // Isometric cube vertices (projected to 2D)
        // Using 30° isometric projection
        var iso30 = Math.PI / 6;  // 30 degrees
        
        var cubePoints = [
            // Top face (lighter)
            { x: 0, y: -size * 0.8 },                    // Top vertex
            { x: -size * 0.7, y: -size * 0.4 },          // Top-left
            { x: size * 0.7, y: -size * 0.4 },           // Top-right
            
            // Middle vertices
            { x: -size * 0.7, y: size * 0.2 },           // Mid-left
            { x: size * 0.7, y: size * 0.2 },            // Mid-right
            
            // Bottom
            { x: 0, y: size * 0.6 },                     // Bottom vertex
            
            // Center point
            { x: 0, y: -size * 0.1 },                    // Center
            
            // Edge midpoints for more positions
            { x: -size * 0.35, y: -size * 0.6 },         // Top-left edge
            { x: size * 0.35, y: -size * 0.6 },          // Top-right edge
            { x: -size * 0.7, y: -size * 0.1 },          // Left edge
            { x: size * 0.7, y: -size * 0.1 },           // Right edge
            { x: -size * 0.35, y: size * 0.4 },          // Bottom-left edge
            { x: size * 0.35, y: size * 0.4 }            // Bottom-right edge
        ];
        
        var positions = [];
        for (var i = 0; i < Math.min(count, cubePoints.length); i++) {
            var p = cubePoints[i];
            positions.push({
                x: center.x + p.x,
                y: center.y + p.y,
                cubeVertex: i,
                gridAngle: center.gridAngle || center.angle,
                gridRadius: center.gridRadius || center.radius
            });
        }
        
        return positions;
    },
    
    /**
     * Spiral: Fibonacci/golden spiral outward
     * Creates natural-looking organic spiral
     */
    spiral: function(center, count, size, opts) {
        var positions = [];
        var goldenAngle = 137.508;  // Golden angle in degrees
        var startRadius = size * 0.3;
        var radiusGrowth = size * 0.15;
        
        for (var i = 0; i < count; i++) {
            var angle = i * goldenAngle;
            var radius = startRadius + (i * radiusGrowth);
            var rad = angle * Math.PI / 180;
            
            positions.push({
                x: center.x + Math.cos(rad) * radius,
                y: center.y + Math.sin(rad) * radius,
                angle: angle % 360,
                radius: radius,
                spiralIndex: i,
                gridAngle: center.gridAngle || center.angle,
                gridRadius: (center.gridRadius || center.radius) + radius
            });
        }
        
        return positions;
    },
    
    /**
     * Grid: Regular rectangular grid
     * Clean, organized arrangement
     */
    grid: function(center, count, size, opts) {
        var positions = [];
        
        // Calculate grid dimensions
        var cols = Math.ceil(Math.sqrt(count));
        var rows = Math.ceil(count / cols);
        var cellSize = size * 2 / Math.max(cols, rows);
        
        var startX = center.x - (cols - 1) * cellSize / 2;
        var startY = center.y - (rows - 1) * cellSize / 2;
        
        var idx = 0;
        for (var row = 0; row < rows && idx < count; row++) {
            for (var col = 0; col < cols && idx < count; col++) {
                positions.push({
                    x: startX + col * cellSize,
                    y: startY + row * cellSize,
                    gridRow: row,
                    gridCol: col,
                    gridAngle: center.gridAngle || center.angle,
                    gridRadius: center.gridRadius || center.radius
                });
                idx++;
            }
        }
        
        return positions;
    },
    
    /**
     * Hub: Converging pattern toward center
     * Lines come in from outside, meeting at the flower
     */
    hub: function(center, count, size, opts) {
        var positions = [];
        var angleStep = 360 / count;
        var startAngle = opts.startAngle || -90;  // Start from top
        
        // Hub positions are OUTSIDE the center, pointing inward
        for (var i = 0; i < count; i++) {
            var angle = startAngle + (i * angleStep);
            var rad = angle * Math.PI / 180;
            
            // Position outside the center
            var radius = size * 1.2;
            
            positions.push({
                x: center.x + Math.cos(rad) * radius,
                y: center.y + Math.sin(rad) * radius,
                angle: angle,
                radius: radius,
                hubDirection: 'inward',
                gridAngle: center.gridAngle || center.angle,
                gridRadius: (center.gridRadius || center.radius) + radius
            });
        }
        
        return positions;
    }
};

// =============================================================================
// FLOWER SELECTION & APPLICATION
// =============================================================================

/**
 * Select which positions become flowers and generate their children.
 * 
 * @param {Array} positions - Selected grid positions
 * @param {Object} config - {flower_chance, flower_type, ...}
 * @param {Array} spells - Available spells to assign to flower children
 * @param {number} seed - Random seed
 * @returns {Object} - {positions, flowerPositions, allPositions}
 */
function applyFlowers(positions, config, spells, seed) {
    var flowerChance = config.flower_chance || 0.15;
    var flowerType = config.flower_type || 'burst';
    
    var rng = seededRandom(seed);
    
    // Filter candidates (tier 1-3 are best for flowers)
    var candidates = positions.filter(function(p) {
        return p.tier >= 1 && p.tier <= 3;
    });
    
    // Determine how many flowers
    var maxFlowers = Math.floor(candidates.length * flowerChance);
    var targetFlowers = Math.max(0, Math.min(maxFlowers, Math.floor(positions.length * 0.15)));
    
    // Shuffle and select flower centers
    shuffle(candidates, rng);
    var flowerCenters = candidates.slice(0, targetFlowers);
    
    // Track all positions (original + flower children)
    var allPositions = positions.slice();  // Copy original
    var flowerPositions = [];
    
    // Calculate how many spells we have for flower children
    var spellsForFlowers = spells ? Math.floor(spells.length * flowerChance) : 0;
    var spellsPerFlower = targetFlowers > 0 ? Math.floor(spellsForFlowers / targetFlowers) : 0;
    
    flowerCenters.forEach(function(center, idx) {
        center.isFlower = true;
        center.flowerType = flowerType;
        
        // Generate children (3-6 typically)
        var childCount = Math.min(
            FLOWER_CONFIG.minChildren + Math.floor(rng() * 4),
            FLOWER_CONFIG.maxChildren,
            spellsPerFlower || 4
        );
        
        var children = generateFlowerFormation(center, childCount, flowerType, {
            size: FLOWER_CONFIG.defaultSize,
            seed: seed + idx
        });
        
        center.flowerChildren = children;
        flowerPositions = flowerPositions.concat(children);
        allPositions = allPositions.concat(children);
    });
    
    console.log('[FlowerFormations] Created', flowerCenters.length, 'flowers with',
                flowerPositions.length, 'total children using', flowerType, 'formation');
    
    return {
        positions: positions,           // Original positions (some now marked as flowers)
        flowerPositions: flowerPositions,  // Just the flower children
        allPositions: allPositions,     // Everything combined
        flowerCenters: flowerCenters    // Just the flower center nodes
    };
}

/**
 * Fisher-Yates shuffle with seeded RNG.
 */
function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
    return arr;
}

/**
 * Seeded random number generator.
 */
function seededRandom(seed) {
    var state = seed || Date.now();
    return function() {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

// =============================================================================
// EXPORTS
// =============================================================================

window.FlowerFormations = {
    generateFlowerFormation: generateFlowerFormation,
    applyFlowers: applyFlowers,
    FORMATIONS: FORMATIONS,
    FLOWER_CONFIG: FLOWER_CONFIG
};

window.generateFlowerFormation = generateFlowerFormation;
window.applyFlowers = applyFlowers;
