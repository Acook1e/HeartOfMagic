#include "PCH.h"
#include "SpellScanner.h"
#include "SpellEffectivenessHook.h"

namespace SpellScanner
{
    // =============================================================================
    // UTF-8 SANITIZATION - Fixes invalid characters from Windows-1252 encoded names
    // =============================================================================
    
    /**
     * Sanitize a string to valid UTF-8 by replacing invalid bytes with ASCII equivalents.
     * Windows-1252 characters (0x80-0x9F) are common in mod text and break JSON parsing.
     */
    std::string SanitizeToUTF8(const std::string& input)
    {
        std::string result;
        result.reserve(input.size());
        
        for (unsigned char c : input) {
            if (c < 0x80) {
                // ASCII - always valid
                result += static_cast<char>(c);
            } else if (c >= 0x80 && c <= 0x9F) {
                // Windows-1252 control characters - replace with ASCII equivalents
                switch (c) {
                    case 0x91: result += '\''; break;  // Left single quote
                    case 0x92: result += '\''; break;  // Right single quote
                    case 0x93: result += '"'; break;   // Left double quote
                    case 0x94: result += '"'; break;   // Right double quote
                    case 0x96: result += '-'; break;   // En dash
                    case 0x97: result += '-'; break;   // Em dash
                    case 0x85: result += "..."; break; // Ellipsis
                    case 0x99: result += "(TM)"; break; // Trademark
                    default: result += '?'; break;     // Unknown - replace with ?
                }
            } else {
                // Extended ASCII (0xA0-0xFF) or valid UTF-8 continuation bytes
                // These are usually safe, but let's be conservative
                result += static_cast<char>(c);
            }
        }
        
        return result;
    }

    // =============================================================================
    // SYSTEM INSTRUCTIONS (Hidden from user - defines output format)
    // =============================================================================

    std::string GetSystemInstructions()
    {
        return R"(
## OUTPUT FORMAT REQUIREMENTS (CRITICAL - Follow exactly)

You MUST return ONLY valid JSON matching this exact schema. No explanations, no markdown code blocks, just raw JSON.

```json
{
  "version": "1.0",
  "schools": {
    "Alteration": {
      "root": "0xFORMID_OF_ROOT_SPELL",
      "nodes": [
        {
          "formId": "0xFORMID",
          "children": ["0xCHILD_FORMID_1", "0xCHILD_FORMID_2"],
          "prerequisites": ["0xPREREQ_FORMID"],
          "tier": 1
        }
      ]
    },
    "Conjuration": { ... },
    "Destruction": { ... },
    "Illusion": { ... },
    "Restoration": { ... }
  }
}
```

### Field Requirements:
- **formId**: The hex FormID from the spell data (e.g., "0x00012FCD"). MUST match exactly.
- **children**: Array of formIds that this spell unlocks. Empty array [] if none.
- **prerequisites**: Array of formIds required before learning. Empty array [] for root spells.
- **tier**: Integer depth in tree. Root = 1, children of root = 2, etc.
- **root**: The formId of the single root spell for each school.

### Critical Rules:
1. Use ONLY formIds in the output - names/descriptions are NOT needed (retrieved in-game)
2. Every spell from the input MUST appear exactly once in the output
3. Each school has exactly ONE root spell (prerequisites = [])
4. FormIds must be EXACT matches from the spell data - no modifications
5. Return raw JSON only - no markdown, no explanations, no code fences

## SPELL DATA:
)";
    }

    // =============================================================================
    // CONFIG PARSING
    // =============================================================================

    ScanConfig ParseScanConfig(const std::string& jsonConfig)
    {
        ScanConfig config;
        
        if (jsonConfig.empty()) {
            return config;
        }

        try {
            json j = json::parse(jsonConfig);
            
            // Parse fields object
            if (j.contains("fields")) {
                auto& f = j["fields"];
                if (f.contains("editorId")) config.fields.editorId = f["editorId"].get<bool>();
                if (f.contains("magickaCost")) config.fields.magickaCost = f["magickaCost"].get<bool>();
                if (f.contains("minimumSkill")) config.fields.minimumSkill = f["minimumSkill"].get<bool>();
                if (f.contains("castingType")) config.fields.castingType = f["castingType"].get<bool>();
                if (f.contains("delivery")) config.fields.delivery = f["delivery"].get<bool>();
                if (f.contains("chargeTime")) config.fields.chargeTime = f["chargeTime"].get<bool>();
                if (f.contains("plugin")) config.fields.plugin = f["plugin"].get<bool>();
                if (f.contains("effects")) config.fields.effects = f["effects"].get<bool>();
                if (f.contains("effectNames")) config.fields.effectNames = f["effectNames"].get<bool>();
                if (f.contains("keywords")) config.fields.keywords = f["keywords"].get<bool>();
            }
            
            // Parse tree rules prompt
            if (j.contains("treeRulesPrompt")) {
                config.treeRulesPrompt = j["treeRulesPrompt"].get<std::string>();
            }
            
            logger::info("SpellScanner: ScanConfig parsed - editorId:{}, treeRulesPrompt length:{}", 
                config.fields.editorId, config.treeRulesPrompt.length());
        } catch (const std::exception& e) {
            logger::warn("SpellScanner: Failed to parse scan config: {}", e.what());
        }

        return config;
    }

    FieldConfig ParseFieldConfig(const std::string& jsonConfig)
    {
        FieldConfig config;
        
        if (jsonConfig.empty()) {
            return config;
        }

        try {
            json j = json::parse(jsonConfig);
            
            if (j.contains("editorId")) config.editorId = j["editorId"].get<bool>();
            if (j.contains("magickaCost")) config.magickaCost = j["magickaCost"].get<bool>();
            if (j.contains("minimumSkill")) config.minimumSkill = j["minimumSkill"].get<bool>();
            if (j.contains("castingType")) config.castingType = j["castingType"].get<bool>();
            if (j.contains("delivery")) config.delivery = j["delivery"].get<bool>();
            if (j.contains("chargeTime")) config.chargeTime = j["chargeTime"].get<bool>();
            if (j.contains("plugin")) config.plugin = j["plugin"].get<bool>();
            if (j.contains("effects")) config.effects = j["effects"].get<bool>();
            if (j.contains("effectNames")) config.effectNames = j["effectNames"].get<bool>();
            if (j.contains("keywords")) config.keywords = j["keywords"].get<bool>();
            
            logger::info("SpellScanner: FieldConfig parsed - editorId:{}, magickaCost:{}", 
                config.editorId, config.magickaCost);
        } catch (const std::exception& e) {
            logger::warn("SpellScanner: Failed to parse field config: {}", e.what());
        }

        return config;
    }

    // =============================================================================
    // HELPER FUNCTIONS
    // =============================================================================

    std::string GetSchoolName(RE::ActorValue school)
    {
        switch (school) {
            case RE::ActorValue::kAlteration: return "Alteration";
            case RE::ActorValue::kConjuration: return "Conjuration";
            case RE::ActorValue::kDestruction: return "Destruction";
            case RE::ActorValue::kIllusion: return "Illusion";
            case RE::ActorValue::kRestoration: return "Restoration";
            default: return "Unknown";
        }
    }

    std::string GetCastingTypeName(RE::MagicSystem::CastingType type)
    {
        switch (type) {
            case RE::MagicSystem::CastingType::kConstantEffect: return "Constant Effect";
            case RE::MagicSystem::CastingType::kFireAndForget: return "Fire and Forget";
            case RE::MagicSystem::CastingType::kConcentration: return "Concentration";
            case RE::MagicSystem::CastingType::kScroll: return "Scroll";
            default: return "Unknown";
        }
    }

    std::string GetDeliveryName(RE::MagicSystem::Delivery delivery)
    {
        switch (delivery) {
            case RE::MagicSystem::Delivery::kSelf: return "Self";
            case RE::MagicSystem::Delivery::kTouch: return "Touch";
            case RE::MagicSystem::Delivery::kAimed: return "Aimed";
            case RE::MagicSystem::Delivery::kTargetActor: return "Target Actor";
            case RE::MagicSystem::Delivery::kTargetLocation: return "Target Location";
            default: return "Unknown";
        }
    }

    std::string GetSkillLevelName(uint32_t minimumSkill)
    {
        if (minimumSkill < 25) return "Novice";
        if (minimumSkill < 50) return "Apprentice";
        if (minimumSkill < 75) return "Adept";
        if (minimumSkill < 100) return "Expert";
        return "Master";
    }

    std::string GetPluginName(RE::FormID formId)
    {
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) return "Unknown";

        uint8_t modIndex = (formId >> 24) & 0xFF;
        
        if (modIndex == 0xFE) {
            uint16_t lightIndex = (formId >> 12) & 0xFFF;
            const auto* file = dataHandler->LookupLoadedLightModByIndex(lightIndex);
            if (file) {
                return file->fileName;
            }
        } else {
            const auto* file = dataHandler->LookupLoadedModByIndex(modIndex);
            if (file) {
                return file->fileName;
            }
        }

        return "Unknown";
    }

    // =============================================================================
    // SPELL SCANNING
    // =============================================================================

    json ScanSpellsToJson(const FieldConfig& fields)
    {
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) {
            logger::error("SpellScanner: Failed to get TESDataHandler");
            return json::array();
        }

        const auto& allSpells = dataHandler->GetFormArray<RE::SpellItem>();
        logger::info("SpellScanner: Found {} total spell forms", allSpells.size());

        json spellArray = json::array();
        int scannedCount = 0;
        int skippedCount = 0;
        int filteredCount = 0;

        // Helper function to check if editorId indicates a non-player spell
        auto isNonPlayerSpell = [](const std::string& editorId) -> bool {
            // Lowercase for comparison
            std::string lower = editorId;
            std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
            
            // Skip trap spells
            if (lower.find("trap") != std::string::npos) return true;
            
            // Skip creature abilities (start with "cr")
            if (lower.substr(0, 2) == "cr") return true;
            
            // Skip shrine/altar blessings
            if (lower.find("altar") != std::string::npos) return true;
            if (lower.find("shrine") != std::string::npos) return true;
            if (lower.find("blessing") != std::string::npos && lower.find("spell") != std::string::npos) return true;
            
            // Skip dungeon-specific spells (usually not learnable)
            if (lower.substr(0, 3) == "dun") return true;
            
            // Skip perk-related spells
            if (lower.substr(0, 4) == "perk") return true;
            
            // Skip hazard effects
            if (lower.find("hazard") != std::string::npos) return true;
            
            // Skip NPC powers
            if (lower.substr(0, 5) == "power") return true;
            
            // Skip test spells
            if (lower.substr(0, 4) == "test") return true;
            
            // Skip quest-specific spells (MGxx pattern for college quests)
            if (lower.length() >= 4 && lower.substr(0, 2) == "mg" && 
                std::isdigit(lower[2]) && std::isdigit(lower[3])) return true;
            
            // Skip specific NPC abilities
            if (lower.find("mgr") == 0) return true;  // MGR prefix spells
            if (lower.find("voice") != std::string::npos) return true;  // Dragon shout variants
            if (lower.find("teleport") != std::string::npos && lower.find("pet") != std::string::npos) return true;
            
            // Skip hand-specific variants (keep only base spell to avoid duplicates)
            // e.g., FlamesLeftHand, FlamesRightHand -> keep only Flames
            if (lower.find("lefthand") != std::string::npos) return true;
            if (lower.find("righthand") != std::string::npos) return true;
            
            // Skip _Copy variants
            if (lower.find("copy") != std::string::npos) return true;
            
            // Skip DLC-specific reused base game spells (usually have DLC1/DLC2 prefix + same name)
            // These are often duplicates for DLC NPCs
            
            return false;
        };

        for (auto* spell : allSpells) {
            if (!spell) continue;

            if (spell->data.spellType != RE::MagicSystem::SpellType::kSpell) {
                skippedCount++;
                continue;
            }

            const char* editorId = spell->GetFormEditorID();
            std::string name = spell->GetFullName();
            RE::FormID formId = spell->GetFormID();

            if (name.empty() || !editorId || strlen(editorId) == 0) {
                skippedCount++;
                continue;
            }
            
            // Filter out spells where name looks like a FormID (broken/missing data)
            // These show up as "0x000A26FF" or similar hex strings
            if (name.length() >= 2 && (name.substr(0, 2) == "0x" || name.substr(0, 2) == "0X")) {
                logger::info("SpellScanner: Filtering FormID-named spell: {}", name);
                filteredCount++;
                continue;
            }
            
            // Also filter if name is all digits/hex (no actual name)
            bool allHex = true;
            for (char c : name) {
                if (!std::isxdigit(static_cast<unsigned char>(c)) && c != ' ') {
                    allHex = false;
                    break;
                }
            }
            if (allHex && name.length() >= 6) {
                logger::info("SpellScanner: Filtering hex-named spell: {}", name);
                filteredCount++;
                continue;
            }

            // Filter out non-player spells based on editorId patterns
            std::string editorIdStr(editorId);
            if (isNonPlayerSpell(editorIdStr)) {
                filteredCount++;
                continue;
            }

            RE::ActorValue school = RE::ActorValue::kNone;
            uint32_t minimumSkill = 0;

            if (spell->effects.size() > 0) {
                auto* firstEffect = spell->effects[0];
                if (firstEffect && firstEffect->baseEffect) {
                    school = firstEffect->baseEffect->GetMagickSkill();
                    minimumSkill = firstEffect->baseEffect->GetMinimumSkillLevel();
                }
            }

            if (school == RE::ActorValue::kNone) {
                skippedCount++;
                continue;
            }
            
            // Filter out spells with absurdly high magicka costs (usually NPC-only)
            float magickaCost = spell->CalculateMagickaCost(nullptr);
            if (magickaCost > 1000.0f) {
                logger::info("SpellScanner: Filtering high-cost spell: {} ({} magicka)", editorIdStr, magickaCost);
                filteredCount++;
                continue;
            }
            
            // Filter out spells with no effects or broken effect data
            bool hasValidEffect = false;
            for (auto* effect : spell->effects) {
                if (effect && effect->baseEffect) {
                    std::string effectName = effect->baseEffect->GetFullName();
                    // Check effect has a real name (not empty or FormID-like)
                    if (!effectName.empty() && effectName.length() > 2 && 
                        effectName.substr(0, 2) != "0x" && effectName.substr(0, 2) != "0X") {
                        hasValidEffect = true;
                        break;
                    }
                }
            }
            if (!hasValidEffect) {
                logger::info("SpellScanner: Filtering spell with no valid effects: {}", name);
                filteredCount++;
                continue;
            }

            json spellJson;
            
            // Essential fields (always included)
            spellJson["formId"] = std::format("0x{:08X}", formId);
            spellJson["name"] = SanitizeToUTF8(name);  // Sanitize for valid UTF-8 JSON
            spellJson["school"] = GetSchoolName(school);
            spellJson["skillLevel"] = GetSkillLevelName(minimumSkill);

            // Optional fields
            if (fields.editorId) {
                spellJson["editorId"] = editorId;
            }
            if (fields.magickaCost) {
                spellJson["magickaCost"] = spell->CalculateMagickaCost(nullptr);
            }
            if (fields.minimumSkill) {
                spellJson["minimumSkill"] = minimumSkill;
            }
            if (fields.castingType) {
                spellJson["castingType"] = GetCastingTypeName(spell->data.castingType);
            }
            if (fields.delivery) {
                spellJson["delivery"] = GetDeliveryName(spell->data.delivery);
            }
            if (fields.chargeTime) {
                spellJson["chargeTime"] = spell->data.chargeTime;
            }
            if (fields.plugin) {
                spellJson["plugin"] = GetPluginName(formId);
            }

            // Effects
            if (fields.effects) {
                json effectsArray = json::array();
                for (auto* effect : spell->effects) {
                    if (!effect || !effect->baseEffect) continue;

                    json effectJson;
                    effectJson["name"] = SanitizeToUTF8(effect->baseEffect->GetFullName());
                    effectJson["magnitude"] = effect->effectItem.magnitude;
                    effectJson["duration"] = effect->effectItem.duration;
                    effectJson["area"] = effect->effectItem.area;

                    const char* description = effect->baseEffect->magicItemDescription.c_str();
                    if (description && strlen(description) > 0) {
                        effectJson["description"] = SanitizeToUTF8(description);
                    }
                    effectsArray.push_back(effectJson);
                }
                spellJson["effects"] = effectsArray;
            } else if (fields.effectNames) {
                json effectNamesArray = json::array();
                for (auto* effect : spell->effects) {
                    if (effect && effect->baseEffect) {
                        effectNamesArray.push_back(SanitizeToUTF8(effect->baseEffect->GetFullName()));
                    }
                }
                spellJson["effectNames"] = effectNamesArray;
            }

            // Keywords
            if (fields.keywords && spell->keywords) {
                json keywordsArray = json::array();
                for (uint32_t i = 0; i < spell->numKeywords; i++) {
                    if (spell->keywords[i]) {
                        const char* kwEditorId = spell->keywords[i]->GetFormEditorID();
                        if (kwEditorId && strlen(kwEditorId) > 0) {
                            keywordsArray.push_back(kwEditorId);
                        }
                    }
                }
                spellJson["keywords"] = keywordsArray;
            }

            spellArray.push_back(spellJson);
            scannedCount++;
        }

        logger::info("SpellScanner: Scanned {} player spells, skipped {} (non-spell), filtered {} (non-player)", 
                     scannedCount, skippedCount, filteredCount);
        return spellArray;
    }

    // =============================================================================
    // MAIN SCAN FUNCTIONS
    // =============================================================================

    std::string ScanAllSpells(const ScanConfig& config)
    {
        logger::info("SpellScanner: Starting spell scan with ScanConfig...");

        json spellArray = ScanSpellsToJson(config.fields);

        // Build timestamp
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        std::stringstream ss;
        ss << std::put_time(std::gmtime(&time), "%Y-%m-%dT%H:%M:%SZ");

        // Build output JSON
        json output;
        output["scanTimestamp"] = ss.str();
        output["spellCount"] = spellArray.size();
        output["spells"] = spellArray;

        // Combine prompts: User's tree rules + System instructions + Spell data
        std::string combinedPrompt;
        
        // Add user's tree rules prompt (visible/editable)
        if (!config.treeRulesPrompt.empty()) {
            combinedPrompt += "## TREE CREATION RULES\n\n";
            combinedPrompt += config.treeRulesPrompt;
            combinedPrompt += "\n\n";
        }
        
        // Add system instructions (hidden from user)
        combinedPrompt += GetSystemInstructions();

        output["llmPrompt"] = combinedPrompt;

        return output.dump(2);
    }

    std::string ScanAllSpells(const FieldConfig& config)
    {
        // Legacy function - create ScanConfig with empty tree rules
        ScanConfig scanConfig;
        scanConfig.fields = config;
        scanConfig.treeRulesPrompt = "";
        
        return ScanAllSpells(scanConfig);
    }

    // =============================================================================
    // SCAN SPELL TOMES (Avoids duplicates - only learnable spells)
    // =============================================================================

    std::string ScanSpellTomes(const ScanConfig& config)
    {
        logger::info("SpellScanner: Starting spell TOME scan...");

        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) {
            logger::error("SpellScanner: Failed to get TESDataHandler");
            return "{}";
        }

        const auto& allBooks = dataHandler->GetFormArray<RE::TESObjectBOOK>();
        logger::info("SpellScanner: Found {} total book forms", allBooks.size());

        json spellArray = json::array();
        std::set<RE::FormID> seenSpellIds;  // Track unique spells
        int tomeCount = 0;
        int skippedDuplicates = 0;
        const FieldConfig& fields = config.fields;

        for (auto* book : allBooks) {
            if (!book) continue;

            // Check if this book teaches a spell
            if (!book->TeachesSpell()) continue;

            RE::SpellItem* spell = book->GetSpell();
            if (!spell) continue;

            // Skip if we've already seen this spell
            RE::FormID spellFormId = spell->GetFormID();
            if (seenSpellIds.count(spellFormId) > 0) {
                skippedDuplicates++;
                continue;
            }
            seenSpellIds.insert(spellFormId);

            // Get spell info
            const char* spellEditorId = spell->GetFormEditorID();
            std::string spellName = spell->GetFullName();

            if (spellName.empty()) continue;

            // Get school from first effect
            RE::ActorValue school = RE::ActorValue::kNone;
            uint32_t minimumSkill = 0;

            if (spell->effects.size() > 0) {
                auto* firstEffect = spell->effects[0];
                if (firstEffect && firstEffect->baseEffect) {
                    school = firstEffect->baseEffect->GetMagickSkill();
                    minimumSkill = firstEffect->baseEffect->GetMinimumSkillLevel();
                }
            }

            // Skip non-magic spells
            if (school == RE::ActorValue::kNone) continue;

            // Build spell JSON (same format as ScanSpellsToJson)
            json spellJson;
            
            // Essential fields (always included)
            spellJson["formId"] = std::format("0x{:08X}", spellFormId);
            spellJson["name"] = SanitizeToUTF8(spellName);  // Sanitize for valid UTF-8 JSON
            spellJson["school"] = GetSchoolName(school);
            spellJson["skillLevel"] = GetSkillLevelName(minimumSkill);

            // Also include tome info for reference (sanitize - mods like DynDOLOD can have invalid UTF-8 in book names)
            spellJson["tomeFormId"] = std::format("0x{:08X}", book->GetFormID());
            spellJson["tomeName"] = SanitizeToUTF8(book->GetFullName());

            // Optional fields
            if (fields.editorId && spellEditorId) {
                spellJson["editorId"] = spellEditorId;
            }
            if (fields.magickaCost) {
                spellJson["magickaCost"] = spell->CalculateMagickaCost(nullptr);
            }
            if (fields.minimumSkill) {
                spellJson["minimumSkill"] = minimumSkill;
            }
            if (fields.castingType) {
                spellJson["castingType"] = GetCastingTypeName(spell->data.castingType);
            }
            if (fields.delivery) {
                spellJson["delivery"] = GetDeliveryName(spell->data.delivery);
            }
            if (fields.chargeTime) {
                spellJson["chargeTime"] = spell->data.chargeTime;
            }
            if (fields.plugin) {
                spellJson["plugin"] = GetPluginName(spellFormId);
            }

            // Effects
            if (fields.effects) {
                json effectsArray = json::array();
                for (auto* effect : spell->effects) {
                    if (!effect || !effect->baseEffect) continue;

                    json effectJson;
                    effectJson["name"] = SanitizeToUTF8(effect->baseEffect->GetFullName());
                    effectJson["magnitude"] = effect->effectItem.magnitude;
                    effectJson["duration"] = effect->effectItem.duration;
                    effectJson["area"] = effect->effectItem.area;

                    const char* description = effect->baseEffect->magicItemDescription.c_str();
                    if (description && strlen(description) > 0) {
                        effectJson["description"] = SanitizeToUTF8(description);
                    }
                    effectsArray.push_back(effectJson);
                }
                spellJson["effects"] = effectsArray;
            } else if (fields.effectNames) {
                json effectNamesArray = json::array();
                for (auto* effect : spell->effects) {
                    if (effect && effect->baseEffect) {
                        effectNamesArray.push_back(SanitizeToUTF8(effect->baseEffect->GetFullName()));
                    }
                }
                spellJson["effectNames"] = effectNamesArray;
            }

            // Keywords
            if (fields.keywords && spell->keywords) {
                json keywordsArray = json::array();
                for (uint32_t i = 0; i < spell->numKeywords; i++) {
                    if (spell->keywords[i]) {
                        const char* kwEditorId = spell->keywords[i]->GetFormEditorID();
                        if (kwEditorId && strlen(kwEditorId) > 0) {
                            keywordsArray.push_back(kwEditorId);
                        }
                    }
                }
                spellJson["keywords"] = keywordsArray;
            }

            spellArray.push_back(spellJson);
            tomeCount++;
        }

        logger::info("SpellScanner: Found {} unique spells from tomes, skipped {} duplicates", 
                     tomeCount, skippedDuplicates);

        // Build timestamp
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        std::stringstream ss;
        ss << std::put_time(std::gmtime(&time), "%Y-%m-%dT%H:%M:%SZ");

        // Build output JSON
        json output;
        output["scanTimestamp"] = ss.str();
        output["scanMode"] = "spell_tomes";
        output["spellCount"] = spellArray.size();
        output["spells"] = spellArray;

        // Combine prompts
        std::string combinedPrompt;
        if (!config.treeRulesPrompt.empty()) {
            combinedPrompt += "## TREE CREATION RULES\n\n";
            combinedPrompt += config.treeRulesPrompt;
            combinedPrompt += "\n\n";
        }
        combinedPrompt += GetSystemInstructions();
        output["llmPrompt"] = combinedPrompt;

        return output.dump(2);
    }

    // =============================================================================
    // GET SPELL INFO BY FORMID (For Tree Viewer)
    // =============================================================================

    std::string GetSpellInfoByFormId(const std::string& formIdStr)
    {
        // Parse formId from hex string (e.g., "0x00012FCC" or "00012FCC")
        RE::FormID formId = 0;
        try {
            std::string cleanId = formIdStr;
            if (cleanId.length() >= 2 && (cleanId.substr(0, 2) == "0x" || cleanId.substr(0, 2) == "0X")) {
                cleanId = cleanId.substr(2);
            }
            
            // Validate: FormIDs should be max 8 hex characters
            if (cleanId.length() > 8) {
                logger::warn("SpellScanner: FormId too long ({}), truncating: {}", cleanId.length(), formIdStr);
                cleanId = cleanId.substr(0, 8);  // Truncate to 8 chars
            }
            
            // Validate hex characters only
            for (char c : cleanId) {
                if (!std::isxdigit(static_cast<unsigned char>(c))) {
                    logger::error("SpellScanner: Invalid hex character in formId: {}", formIdStr);
                    return "";
                }
            }
            
            formId = std::stoul(cleanId, nullptr, 16);
        } catch (const std::exception& e) {
            logger::error("SpellScanner: Invalid formId format: {} ({})", formIdStr, e.what());
            return "";
        }

        // Look up the spell form
        auto* form = RE::TESForm::LookupByID(formId);
        if (!form) {
            logger::warn("SpellScanner: Form not found for ID: {} (parsed: 0x{:08X})", formIdStr, formId);
            return "";
        }

        auto* spell = form->As<RE::SpellItem>();
        if (!spell) {
            logger::warn("SpellScanner: Form {} is not a spell", formIdStr);
            return "";
        }

        // Build spell info JSON
        json spellInfo;
        spellInfo["formId"] = formIdStr;
        spellInfo["name"] = SanitizeToUTF8(spell->GetFullName());  // Sanitize for valid UTF-8 JSON
        
        const char* editorId = spell->GetFormEditorID();
        spellInfo["editorId"] = editorId ? editorId : "";

        // Get school and level from first effect
        std::string school = "Unknown";
        std::string level = "Unknown";
        uint32_t minimumSkill = 0;

        if (spell->effects.size() > 0) {
            auto* firstEffect = spell->effects[0];
            if (firstEffect && firstEffect->baseEffect) {
                RE::ActorValue schoolAV = firstEffect->baseEffect->GetMagickSkill();
                school = GetSchoolName(schoolAV);
                minimumSkill = firstEffect->baseEffect->GetMinimumSkillLevel();
                level = GetSkillLevelName(minimumSkill);
            }
        }

        spellInfo["school"] = school;
        spellInfo["level"] = level;
        spellInfo["skillLevel"] = level;  // Alias
        spellInfo["minimumSkill"] = minimumSkill;
        
        spellInfo["cost"] = spell->CalculateMagickaCost(nullptr);
        spellInfo["magickaCost"] = spellInfo["cost"];  // Alias
        
        spellInfo["type"] = GetCastingTypeName(spell->data.castingType);
        spellInfo["castingType"] = spellInfo["type"];  // Alias
        
        spellInfo["delivery"] = GetDeliveryName(spell->data.delivery);
        spellInfo["chargeTime"] = spell->data.chargeTime;
        spellInfo["plugin"] = GetPluginName(formId);

        // Effects
        json effectsArray = json::array();
        json effectNamesArray = json::array();
        std::string description;

        for (auto* effect : spell->effects) {
            if (!effect || !effect->baseEffect) continue;

            std::string effectName = SanitizeToUTF8(effect->baseEffect->GetFullName());
            effectNamesArray.push_back(effectName);

            json effectJson;
            effectJson["name"] = effectName;
            effectJson["magnitude"] = effect->effectItem.magnitude;
            effectJson["duration"] = effect->effectItem.duration;
            effectJson["area"] = effect->effectItem.area;

            const char* desc = effect->baseEffect->magicItemDescription.c_str();
            if (desc && strlen(desc) > 0) {
                std::string descSanitized = SanitizeToUTF8(desc);
                effectJson["description"] = descSanitized;
                if (description.empty()) {
                    description = descSanitized;  // Use first effect's description as spell description
                }
            }
            effectsArray.push_back(effectJson);
        }

        spellInfo["effects"] = effectsArray;
        spellInfo["effectNames"] = effectNamesArray;
        spellInfo["description"] = description;
        
        // Add effectiveness info for early-learned spells
        auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
        if (effectivenessHook && effectivenessHook->IsEarlyLearnedSpell(formId)) {
            float effectiveness = effectivenessHook->CalculateEffectiveness(formId);
            spellInfo["isWeakened"] = true;
            spellInfo["effectiveness"] = static_cast<int>(effectiveness * 100);  // As percentage
            
            // Add scaled effect values
            json scaledEffectsArray = json::array();
            for (auto* effect : spell->effects) {
                if (!effect || !effect->baseEffect) continue;
                
                json scaledEffect;
                scaledEffect["name"] = SanitizeToUTF8(effect->baseEffect->GetFullName());
                scaledEffect["originalMagnitude"] = effect->effectItem.magnitude;
                scaledEffect["scaledMagnitude"] = static_cast<int>(effect->effectItem.magnitude * effectiveness);
                scaledEffect["duration"] = effect->effectItem.duration;
                scaledEffectsArray.push_back(scaledEffect);
            }
            spellInfo["scaledEffects"] = scaledEffectsArray;
        } else {
            spellInfo["isWeakened"] = false;
            spellInfo["effectiveness"] = 100;
        }

        return spellInfo.dump();
    }
}
