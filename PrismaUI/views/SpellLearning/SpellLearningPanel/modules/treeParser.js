/**
 * SpellLearning Tree Parser Module
 * 
 * Parses spell tree JSON data, detects cycles, fixes orphaned nodes.
 * Depends on: config.js (TREE_CONFIG), spellCache.js (SpellCache), state.js (settings)
 */

// =============================================================================
// LOGGING HELPER
// =============================================================================

function logTreeParser(message, isWarning) {
    var prefix = '[TreeParser] ';
    var fullMsg = prefix + message;
    
    if (isWarning) {
        console.warn(fullMsg);
    } else {
        console.log(fullMsg);
    }
    
    // Send to C++ for SKSE log
    if (window.callCpp) {
        window.callCpp('LogMessage', JSON.stringify({
            level: isWarning ? 'warn' : 'info',
            message: fullMsg
        }));
    }
}

// =============================================================================
// TREE PARSER
// =============================================================================

var TreeParser = {
    nodes: new Map(),
    edges: [],
    schools: {},

    parse: function(data) {
        this.nodes.clear();
        this.edges = [];
        this.schools = {};

        if (typeof data === 'string') {
            try { data = JSON.parse(data); }
            catch (e) { return { success: false, error: e.message }; }
        }

        if (!data.schools) return { success: false, error: 'Missing schools' };

        var allFormIds = [];
        var self = this;

        for (var schoolName in data.schools) {
            var schoolData = data.schools[schoolName];
            if (!schoolData.root || !schoolData.nodes) continue;
            
            // Extract layoutStyle from LLM response
            var layoutStyle = schoolData.layoutStyle || 'radial';
            if (!TREE_CONFIG.layoutStyles[layoutStyle]) {
                logTreeParser('Unknown layout style "' + layoutStyle + '" for ' + schoolName + ', using radial', true);
                layoutStyle = 'radial';
            }
            logTreeParser(schoolName + ' using layout style: ' + layoutStyle);
            
            this.schools[schoolName] = { 
                root: schoolData.root, 
                nodeIds: [], 
                maxDepth: 0, 
                maxWidth: 0,
                layoutStyle: layoutStyle,
                // Pass through sliceInfo for wheelRenderer to use exact sector angles
                sliceInfo: schoolData.sliceInfo,
                config: schoolData.config_used
            };

            schoolData.nodes.forEach(function(nd) {
                var id = nd.formId || nd.spellId;
                if (!id) return;

                allFormIds.push(id);
                
                // Preserve pre-computed positions from visual-first builder
                var hasPrecomputed = nd._fromVisualFirst || (nd.x !== undefined && nd.y !== undefined && nd.x !== 0 && nd.y !== 0);
                
                self.nodes.set(id, {
                    id: id,
                    formId: id,
                    name: null,
                    school: schoolName,
                    level: null,
                    cost: null,
                    type: null,
                    effects: [],
                    desc: null,
                    children: nd.children || [],
                    prerequisites: nd.prerequisites || [],
                    tier: nd.tier || 0,
                    state: 'locked',
                    depth: 0,
                    // Preserve positions if pre-computed, otherwise default to 0
                    x: hasPrecomputed ? nd.x : 0,
                    y: hasPrecomputed ? nd.y : 0,
                    angle: nd.angle || 0,
                    radius: nd.radius || 0,
                    // Preserve visual-first flags
                    _fromVisualFirst: nd._fromVisualFirst || false,
                    isFlower: nd.isFlower || false,
                    flowerType: nd.flowerType,
                    isRoot: nd.isRoot || false,  // CRITICAL: Preserve root flag for origin lines
                    // Preserve hard/soft prerequisite data
                    hardPrereqs: nd.hardPrereqs || [],
                    softPrereqs: nd.softPrereqs || [],
                    softNeeded: nd.softNeeded || 0
                });
                self.schools[schoolName].nodeIds.push(id);
            });
        }

        // Build edges from children
        this.nodes.forEach(function(node) {
            node.children.forEach(function(childId) {
                var child = self.nodes.get(childId);
                if (child) {
                    self.edges.push({ from: node.id, to: childId });
                    if (child.prerequisites.indexOf(node.id) === -1) {
                        child.prerequisites.push(node.id);
                    }
                }
            });
        });

        // Also build edges from prerequisites (handles LLM inconsistencies)
        this.nodes.forEach(function(node) {
            node.prerequisites.forEach(function(prereqId) {
                var parent = self.nodes.get(prereqId);
                if (parent) {
                    var edgeExists = self.edges.some(function(e) {
                        return e.from === prereqId && e.to === node.id;
                    });
                    if (!edgeExists) {
                        logTreeParser('Adding missing edge: ' + prereqId + ' -> ' + node.id);
                        self.edges.push({ from: prereqId, to: node.id });
                        if (parent.children.indexOf(node.id) === -1) {
                            parent.children.push(node.id);
                        }
                    }
                }
            });
        });

        // Detect and fix prerequisite cycles per school
        for (var schoolName in this.schools) {
            var schoolData = this.schools[schoolName];
            var cyclesFixed = this.detectAndFixCycles(schoolName, schoolData.root);
            if (cyclesFixed > 0) {
                logTreeParser('Fixed ' + cyclesFixed + ' prerequisite cycles in ' + schoolName, true);
            }
        }

        // Calculate depths
        for (var sName in this.schools) {
            var sData = this.schools[sName];
            var root = this.nodes.get(sData.root);
            if (!root) continue;

            var queue = [{ node: root, depth: 0 }];
            var visited = new Set();
            var depthCounts = {};
            
            while (queue.length) {
                var item = queue.shift();
                var node = item.node;
                var depth = item.depth;
                if (visited.has(node.id)) continue;
                visited.add(node.id);
                node.depth = depth;
                sData.maxDepth = Math.max(sData.maxDepth, depth);
                depthCounts[depth] = (depthCounts[depth] || 0) + 1;
                
                node.children.forEach(function(cid) {
                    var c = self.nodes.get(cid);
                    if (c) queue.push({ node: c, depth: depth + 1 });
                });
            }

            sData.maxWidth = Math.max.apply(null, Object.values(depthCounts).concat([1]));

            // Find and fix orphaned nodes
            var orphanedNodes = [];
            sData.nodeIds.forEach(function(nodeId) {
                if (!visited.has(nodeId)) {
                    orphanedNodes.push(nodeId);
                }
            });
            
            if (orphanedNodes.length > 0) {
                logTreeParser('Found ' + orphanedNodes.length + ' orphaned nodes in ' + sName + ' - attempting to fix', true);
                this._fixOrphanedNodes(orphanedNodes, sName, sData, root, visited);
            }

            // Root nodes are AVAILABLE (learnable starting points), not auto-unlocked
            // Children stay locked until root is actually learned
            root.state = 'available';
        }

        return {
            success: true,
            nodes: Array.from(this.nodes.values()),
            edges: this.edges,
            schools: this.schools,
            allFormIds: allFormIds
        };
    },

    _fixOrphanedNodes: function(orphanedNodes, schoolName, schoolData, root, visited) {
        var self = this;
        
        orphanedNodes.forEach(function(orphanId) {
            var orphan = self.nodes.get(orphanId);
            if (!orphan) return;
            
            var orphanTier = orphan.tier || 0;
            var potentialParents = [];
            
            visited.forEach(function(connectedId) {
                var connected = self.nodes.get(connectedId);
                if (connected && connected.school === schoolName) {
                    var connectedTier = connected.tier || 0;
                    if (connectedTier <= orphanTier && connectedTier >= orphanTier - 1) {
                        var childCount = connected.children.length;
                        potentialParents.push({ node: connected, childCount: childCount, tierDiff: orphanTier - connectedTier });
                    }
                }
            });
            
            potentialParents.sort(function(a, b) {
                if (a.tierDiff !== b.tierDiff) return a.tierDiff - b.tierDiff;
                return a.childCount - b.childCount;
            });
            
            var bestParent = potentialParents.length > 0 ? potentialParents[0].node : root;
            
            logTreeParser('Connecting orphan ' + orphanId + ' (tier ' + orphanTier + ') to ' + bestParent.id);
            
            if (bestParent.children.indexOf(orphanId) === -1) {
                bestParent.children.push(orphanId);
            }
            if (orphan.prerequisites.indexOf(bestParent.id) === -1) {
                orphan.prerequisites.push(bestParent.id);
            }
            self.edges.push({ from: bestParent.id, to: orphanId });
            
            orphan.depth = bestParent.depth + 1;
            schoolData.maxDepth = Math.max(schoolData.maxDepth, orphan.depth);
            visited.add(orphanId);
        });
        
        // Re-process children of newly connected nodes
        orphanedNodes.forEach(function(orphanId) {
            var orphan = self.nodes.get(orphanId);
            if (!orphan) return;
            
            var childQueue = [{ node: orphan, depth: orphan.depth }];
            while (childQueue.length > 0) {
                var item = childQueue.shift();
                item.node.children.forEach(function(cid) {
                    var child = self.nodes.get(cid);
                    if (child && !visited.has(cid)) {
                        visited.add(cid);
                        child.depth = item.depth + 1;
                        schoolData.maxDepth = Math.max(schoolData.maxDepth, child.depth);
                        childQueue.push({ node: child, depth: child.depth });
                    }
                });
            }
        });
        
        logTreeParser('Fixed ' + orphanedNodes.length + ' orphaned nodes in ' + schoolName);
    },

    detectAndFixCycles: function(schoolName, rootId) {
        var self = this;
        var fixesMade = 0;
        
        var rootNode = this.nodes.get(rootId);
        if (!rootNode) return 0;
        
        var schoolNodeIds = this.schools[schoolName].nodeIds;
        var totalNodes = schoolNodeIds.length;
        
        function simulateUnlocks() {
            var unlocked = new Set();
            unlocked.add(rootId);
            
            var changed = true;
            var iterations = 0;
            var maxIterations = totalNodes + 10;
            
            while (changed && iterations < maxIterations) {
                changed = false;
                iterations++;
                
                schoolNodeIds.forEach(function(nodeId) {
                    if (unlocked.has(nodeId)) return;
                    
                    var node = self.nodes.get(nodeId);
                    if (!node) return;
                    
                    var prereqs = node.prerequisites;
                    if (prereqs.length === 0) return;
                    
                    var allPrereqsUnlocked = prereqs.every(function(prereqId) {
                        return unlocked.has(prereqId);
                    });
                    
                    if (allPrereqsUnlocked) {
                        unlocked.add(nodeId);
                        changed = true;
                    }
                });
            }
            
            return unlocked;
        }
        
        var unlockable = simulateUnlocks();
        
        var unobtainable = [];
        schoolNodeIds.forEach(function(nodeId) {
            if (!unlockable.has(nodeId)) {
                unobtainable.push(nodeId);
            }
        });
        
        if (unobtainable.length === 0) {
            logTreeParser(schoolName + ': All ' + totalNodes + ' spells are obtainable');
            return 0;
        }
        
        logTreeParser(schoolName + ': Found ' + unobtainable.length + ' unobtainable spells - analyzing prerequisites', true);
        
        // Log blocking prereqs
        unobtainable.forEach(function(nodeId) {
            var node = self.nodes.get(nodeId);
            if (!node) return;
            
            var blockingPrereqs = node.prerequisites.filter(function(prereqId) {
                return !unlockable.has(prereqId);
            });
            
            if (blockingPrereqs.length > 0) {
                logTreeParser('  ' + nodeId + ' blocked by unobtainable prereqs: ' + blockingPrereqs.join(', '), true);
            }
        });
        
        // Fix cycles
        var fixedThisPass = true;
        var passCount = 0;
        var maxPasses = 10;
        
        while (fixedThisPass && passCount < maxPasses) {
            fixedThisPass = false;
            passCount++;
            
            unlockable = simulateUnlocks();
            
            schoolNodeIds.forEach(function(nodeId) {
                if (unlockable.has(nodeId)) return;
                
                var node = self.nodes.get(nodeId);
                if (!node) return;
                
                var prereqs = node.prerequisites.slice();
                var obtainablePrereqs = prereqs.filter(function(pid) { return unlockable.has(pid); });
                var unobtainablePrereqs = prereqs.filter(function(pid) { return !unlockable.has(pid); });
                
                if (obtainablePrereqs.length > 0 && unobtainablePrereqs.length > 0) {
                    if (settings.preserveMultiPrereqs) {
                        logTreeParser('Node ' + nodeId + ' has multi-prereqs (' + obtainablePrereqs.length + ' obtainable, ' + 
                                      unobtainablePrereqs.length + ' pending) - preserving structure');
                    } else {
                        // For aggressive validation: REPLACE bad prereqs with valid ones
                        var nodeTier = node.tier || 0;
                        
                        unobtainablePrereqs.forEach(function(badPrereqId) {
                            var idx = node.prerequisites.indexOf(badPrereqId);
                            if (idx !== -1) {
                                // Remove the bad prereq
                                node.prerequisites.splice(idx, 1);
                                
                                var badParent = self.nodes.get(badPrereqId);
                                if (badParent) {
                                    var childIdx = badParent.children.indexOf(nodeId);
                                    if (childIdx !== -1) badParent.children.splice(childIdx, 1);
                                }
                                
                                self.edges = self.edges.filter(function(e) {
                                    return !(e.from === badPrereqId && e.to === nodeId);
                                });
                                
                                // Find a REPLACEMENT prereq from unlockable nodes
                                var replacement = null;
                                var bestScore = -Infinity;
                                
                                unlockable.forEach(function(unlockableId) {
                                    // Skip if already a prereq
                                    if (node.prerequisites.indexOf(unlockableId) !== -1) return;
                                    if (unlockableId === nodeId) return;
                                    
                                    var candidate = self.nodes.get(unlockableId);
                                    if (!candidate || candidate.school !== schoolName) return;
                                    
                                    var candidateTier = candidate.tier || 0;
                                    if (candidateTier < nodeTier) {
                                        var tierDiff = nodeTier - candidateTier;
                                        var score = (tierDiff === 1 ? 20 : tierDiff === 2 ? 10 : 5) - (candidate.children ? candidate.children.length : 0);
                                        if (score > bestScore) {
                                            bestScore = score;
                                            replacement = candidate;
                                        }
                                    }
                                });
                                
                                if (replacement) {
                                    // Add replacement prereq
                                    node.prerequisites.push(replacement.id);
                                    if (!replacement.children) replacement.children = [];
                                    if (replacement.children.indexOf(nodeId) === -1) {
                                        replacement.children.push(nodeId);
                                    }
                                    self.edges.push({ from: replacement.id, to: nodeId });
                                    
                                    logTreeParser('REPLACED prereq: ' + badPrereqId + ' -> ' + replacement.id + ' for ' + nodeId);
                                } else {
                                    logTreeParser('Removed blocking prereq ' + badPrereqId + ' from ' + nodeId + ' (no replacement found)');
                                }
                                
                                fixesMade++;
                                fixedThisPass = true;
                            }
                        });
                    }
                } else if (obtainablePrereqs.length === 0 && unobtainablePrereqs.length > 0) {
                    var nodeTier = node.tier || 0;
                    var bestParent = null;
                    var bestScore = -Infinity;
                    
                    unlockable.forEach(function(unlockableId) {
                        var candidate = self.nodes.get(unlockableId);
                        if (!candidate || candidate.school !== schoolName) return;
                        
                        var candidateTier = candidate.tier || 0;
                        if (candidateTier <= nodeTier) {
                            var tierDiff = nodeTier - candidateTier;
                            var score = (tierDiff === 0 ? 20 : tierDiff === 1 ? 10 : 5) - candidate.children.length;
                            if (score > bestScore) {
                                bestScore = score;
                                bestParent = candidate;
                            }
                        }
                    });
                    
                    if (!bestParent) bestParent = rootNode;
                    
                    unobtainablePrereqs.forEach(function(badPrereqId) {
                        var idx = node.prerequisites.indexOf(badPrereqId);
                        if (idx !== -1) node.prerequisites.splice(idx, 1);
                        
                        var badParent = self.nodes.get(badPrereqId);
                        if (badParent) {
                            var childIdx = badParent.children.indexOf(nodeId);
                            if (childIdx !== -1) badParent.children.splice(childIdx, 1);
                        }
                        
                        self.edges = self.edges.filter(function(e) {
                            return !(e.from === badPrereqId && e.to === nodeId);
                        });
                    });
                    
                    if (bestParent.children.indexOf(nodeId) === -1) {
                        bestParent.children.push(nodeId);
                    }
                    node.prerequisites.push(bestParent.id);
                    self.edges.push({ from: bestParent.id, to: nodeId });
                    
                    logTreeParser('Reconnected ' + nodeId + ' from cycle to ' + bestParent.id, true);
                    fixesMade++;
                    fixedThisPass = true;
                }
            });
        }
        
        // Final verification
        unlockable = simulateUnlocks();
        var stillUnobtainable = schoolNodeIds.filter(function(nid) { return !unlockable.has(nid); });
        
        if (stillUnobtainable.length > 0) {
            logTreeParser(schoolName + ': WARNING - Still have ' + stillUnobtainable.length + ' unobtainable spells after fixes!', true);
            stillUnobtainable.forEach(function(nodeId) {
                var node = self.nodes.get(nodeId);
                if (!node) return;
                
                // GENTLER FIX: Add a connection to an obtainable node instead of removing all prereqs
                // This preserves the LLM's intent while making the node reachable
                var nodeTier = node.tier || 0;
                var bestParent = null;
                var bestScore = -Infinity;
                
                // Find best obtainable parent to add as prereq
                unlockable.forEach(function(unlockableId) {
                    var candidate = self.nodes.get(unlockableId);
                    if (!candidate || candidate.school !== schoolName) return;
                    if (candidate.id === nodeId) return; // Can't be own prereq
                    if (node.prerequisites.indexOf(candidate.id) !== -1) return; // Already a prereq
                    
                    var candidateTier = candidate.tier || 0;
                    if (candidateTier < nodeTier) {
                        // Prefer lower tier, fewer children
                        var tierDiff = nodeTier - candidateTier;
                        var score = (tierDiff === 1 ? 20 : tierDiff === 2 ? 10 : 5) - (candidate.children ? candidate.children.length : 0);
                        if (score > bestScore) {
                            bestScore = score;
                            bestParent = candidate;
                        }
                    }
                });
                
                if (!bestParent) bestParent = rootNode;
                
                // ADD the new prereq (keep existing prereqs)
                if (node.prerequisites.indexOf(bestParent.id) === -1) {
                    node.prerequisites.push(bestParent.id);
                    if (!bestParent.children) bestParent.children = [];
                    if (bestParent.children.indexOf(nodeId) === -1) {
                        bestParent.children.push(nodeId);
                    }
                    self.edges.push({ from: bestParent.id, to: nodeId });
                    
                    logTreeParser('GENTLE FIX: Added prereq ' + bestParent.id + ' to ' + nodeId + ' (kept ' + (node.prerequisites.length - 1) + ' existing prereqs)', true);
                    fixesMade++;
                }
            });
        } else {
            logTreeParser(schoolName + ': All spells now obtainable after ' + fixesMade + ' fixes');
        }
        
        return fixesMade;
    },
    
    /**
     * Analyze a school's tree and return info about unreachable nodes
     * Used for LLM self-correction
     */
    getUnreachableNodesInfo: function(schoolName, rootId) {
        var self = this;
        var rootNode = this.nodes.get(rootId);
        if (!rootNode) return { valid: true, unreachable: [] };
        
        var schoolNodeIds = this.schools[schoolName].nodeIds;
        var totalNodes = schoolNodeIds.length;
        
        // Simulate unlocks
        function simulateUnlocks() {
            var unlocked = new Set();
            unlocked.add(rootId);
            
            var changed = true;
            var iterations = 0;
            
            while (changed && iterations < totalNodes + 10) {
                changed = false;
                iterations++;
                
                schoolNodeIds.forEach(function(nodeId) {
                    if (unlocked.has(nodeId)) return;
                    
                    var node = self.nodes.get(nodeId);
                    if (!node) return;
                    
                    var prereqs = node.prerequisites;
                    if (prereqs.length === 0) return;
                    
                    var allPrereqsUnlocked = prereqs.every(function(prereqId) {
                        return unlocked.has(prereqId);
                    });
                    
                    if (allPrereqsUnlocked) {
                        unlocked.add(nodeId);
                        changed = true;
                    }
                });
            }
            
            return unlocked;
        }
        
        var unlockable = simulateUnlocks();
        var unreachableInfo = [];
        
        schoolNodeIds.forEach(function(nodeId) {
            if (unlockable.has(nodeId)) return;
            
            var node = self.nodes.get(nodeId);
            if (!node) return;
            
            var blockingPrereqs = node.prerequisites.filter(function(prereqId) {
                return !unlockable.has(prereqId);
            });
            
            unreachableInfo.push({
                formId: nodeId,
                name: node.name || nodeId,
                tier: node.tier || 0,
                currentPrereqs: node.prerequisites.slice(),
                blockingPrereqs: blockingPrereqs
            });
        });
        
        return {
            valid: unreachableInfo.length === 0,
            total: totalNodes,
            reachable: unlockable.size,
            unreachable: unreachableInfo
        };
    },

    updateNodeFromCache: function(node) {
        var spellData = SpellCache.get(node.formId);
        if (spellData) {
            node.name = spellData.name || spellData.editorId || node.formId;
            node.level = spellData.level || spellData.skillLevel || 'Unknown';
            node.cost = spellData.cost || spellData.magickaCost || 0;
            node.type = spellData.type || spellData.castingType || 'Spell';
            node.effects = spellData.effects || spellData.effectNames || [];
            node.desc = spellData.description || '';
            if (spellData.school) node.school = spellData.school;
        }
    }
};

// =============================================================================
// PROCEDURAL PREREQUISITE INJECTION
// =============================================================================

/**
 * Programmatically inject additional prerequisites into the tree
 * This creates more interesting unlock paths by requiring multiple spells
 * Only adds prereqs that are SAFE (already unlockable, no cycles)
 * 
 * Uses settings.proceduralInjection for configuration:
 * - chance: % chance per eligible node (0-100)
 * - maxPrereqs: maximum total prerequisites per node
 * - minTier: minimum tier where injection applies
 * - sameTierPreference: prefer same-tier prereqs for convergence
 */
function injectProceduralPrerequisites() {
    if (!state.treeData || !state.treeData.nodes) {
        console.log('[TreeParser] No tree data for prereq injection');
        return;
    }
    
    // Get settings with defaults
    var config = settings.proceduralInjection || {};
    var chance = config.chance !== undefined ? config.chance : 50;
    var maxPrereqs = config.maxPrereqs !== undefined ? config.maxPrereqs : 3;
    var minTier = config.minTier !== undefined ? config.minTier : 3;
    var sameTierPref = config.sameTierPreference !== false;
    
    console.log('[TreeParser] Injection config: chance=' + chance + '%, maxPrereqs=' + maxPrereqs + ', minTier=' + minTier + ', sameTierPref=' + sameTierPref);
    
    var nodes = state.treeData.nodes;
    var injectedCount = 0;
    
    // Build lookup maps
    var nodeById = {};
    var nodesBySchool = {};
    var nodesByDepth = {};
    
    nodes.forEach(function(node) {
        nodeById[node.id] = node;
        
        var school = node.school || 'Unknown';
        if (!nodesBySchool[school]) nodesBySchool[school] = [];
        nodesBySchool[school].push(node);
        
        var depth = node.depth || 0;
        if (!nodesByDepth[depth]) nodesByDepth[depth] = [];
        nodesByDepth[depth].push(node);
    });
    
    // For each non-root node, try to add extra prereqs
    nodes.forEach(function(node) {
        // Skip roots
        if (!node.prerequisites || node.prerequisites.length === 0) return;
        
        // Skip if already at max prereqs
        if (node.prerequisites.length >= maxPrereqs) return;
        
        // Skip nodes below minimum tier
        var depth = node.depth || 0;
        if (depth < minTier) return;
        
        // Random chance check
        if (Math.random() * 100 >= chance) return;
        
        // Find candidate prereqs from same school, lower or same tier
        var school = node.school || 'Unknown';
        var schoolNodes = nodesBySchool[school] || [];
        
        // Filter to valid candidates
        var candidates = schoolNodes.filter(function(candidate) {
            // Not self
            if (candidate.id === node.id) return false;
            // Not already a prereq
            if (node.prerequisites.indexOf(candidate.id) !== -1) return false;
            // Not a descendant (would create cycle)
            if (isDescendantOf(candidate, node.id, nodeById)) return false;
            // Must be lower or same tier
            var candDepth = candidate.depth || 0;
            if (candDepth >= depth) return false;
            // Must be unlockable (has path to root)
            if (!hasPathToRoot(candidate, nodeById)) return false;
            
            return true;
        });
        
        if (candidates.length === 0) return;
        
        // Apply same-tier preference if enabled
        var pool = candidates;
        if (sameTierPref) {
            // Prefer adjacent tier (depth - 1)
            var adjacentTierCandidates = candidates.filter(function(c) {
                return (c.depth || 0) === depth - 1;
            });
            if (adjacentTierCandidates.length > 0) {
                pool = adjacentTierCandidates;
            }
        }
        
        var selected = pool[Math.floor(Math.random() * pool.length)];
        
        // Add the prerequisite
        node.prerequisites.push(selected.id);
        
        // Add to children of selected node
        if (!selected.children) selected.children = [];
        if (selected.children.indexOf(node.id) === -1) {
            selected.children.push(node.id);
        }
        
        // Add edge
        TreeParser.edges.push({ from: selected.id, to: node.id });
        
        injectedCount++;
        console.log('[TreeParser] Injected prereq: ' + (node.name || node.id) + ' now requires ' + (selected.name || selected.id));
    });
    
    console.log('[TreeParser] Procedural injection complete: ' + injectedCount + ' additional prerequisites added');
    
    // Re-render tree if visible
    if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
        WheelRenderer.render();
    }
    
    // Save the modified tree
    if (window.callCpp && state.treeData.rawData) {
        // Update rawData with new prerequisites
        updateRawDataPrerequisites();
        var treeJson = JSON.stringify(state.treeData.rawData);
        window.callCpp('SaveSpellTree', treeJson);
    }
}

/**
 * Clear injected prerequisites and reroll with current settings
 * This reloads the original tree data and re-applies injection
 */
function rerollProceduralPrerequisites() {
    console.log('[TreeParser] Rerolling procedural prerequisites...');
    
    if (!state.treeData || !state.treeData.rawData) {
        console.log('[TreeParser] No tree data to reroll');
        return;
    }
    
    // Reload the tree from rawData (clears injected prereqs)
    var rawData = state.treeData.rawData;
    
    // Re-parse the tree (this resets to original structure)
    if (typeof loadTreeData === 'function') {
        loadTreeData(rawData);
    } else {
        // Fallback: re-parse manually
        var result = TreeParser.parse(rawData);
        if (result.success) {
            state.treeData = result;
            state.treeData.rawData = rawData;
        }
    }
    
    // Now apply injection with current settings
    if (settings.proceduralPrereqInjection) {
        setTimeout(function() {
            injectProceduralPrerequisites();
        }, 100);
    } else {
        // Just re-render
        if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
            WheelRenderer.render();
        }
    }
}

/**
 * Check if candidate is a descendant of targetId (would create cycle)
 */
function isDescendantOf(candidate, targetId, nodeById) {
    var visited = {};
    var queue = candidate.children ? candidate.children.slice() : [];
    
    while (queue.length > 0) {
        var childId = queue.shift();
        if (childId === targetId) return true;
        if (visited[childId]) continue;
        visited[childId] = true;
        
        var childNode = nodeById[childId];
        if (childNode && childNode.children) {
            queue = queue.concat(childNode.children);
        }
    }
    
    return false;
}

/**
 * Check if node has a valid path to root
 */
function hasPathToRoot(node, nodeById) {
    var visited = {};
    var current = node;
    var maxIterations = 100;
    var iterations = 0;
    
    while (current && iterations < maxIterations) {
        iterations++;
        if (visited[current.id]) return false; // Cycle
        visited[current.id] = true;
        
        if (!current.prerequisites || current.prerequisites.length === 0) {
            return true; // Found root
        }
        
        // Follow first prereq (if any prereq leads to root, it's valid)
        current = nodeById[current.prerequisites[0]];
    }
    
    return false;
}

/**
 * Update the raw tree data with injected prerequisites
 */
function updateRawDataPrerequisites() {
    if (!state.treeData || !state.treeData.rawData || !state.treeData.nodes) return;
    
    var rawData = state.treeData.rawData;
    
    // Build a map of node id to updated prerequisites
    var prereqMap = {};
    state.treeData.nodes.forEach(function(node) {
        prereqMap[node.id] = node.prerequisites || [];
    });
    
    // Update each school's nodes in rawData
    for (var schoolName in rawData.schools) {
        var school = rawData.schools[schoolName];
        if (!school.nodes) continue;
        
        school.nodes.forEach(function(rawNode) {
            var nodeId = rawNode.formId || rawNode.id;
            if (prereqMap[nodeId]) {
                rawNode.prerequisites = prereqMap[nodeId];
            }
        });
    }
}
