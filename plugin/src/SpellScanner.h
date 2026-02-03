#pragma once

#include "PCH.h"

namespace SpellScanner
{
    // Field output configuration
    struct FieldConfig {
        bool editorId = true;
        bool magickaCost = true;
        bool minimumSkill = false;
        bool castingType = false;
        bool delivery = false;
        bool chargeTime = false;
        bool plugin = false;
        bool effects = false;
        bool effectNames = false;
        bool keywords = false;
    };

    // Scan configuration (fields + user prompt)
    struct ScanConfig {
        FieldConfig fields;
        std::string treeRulesPrompt;
    };

    // Parse scan config from JSON string (includes fields and treeRulesPrompt)
    ScanConfig ParseScanConfig(const std::string& jsonConfig);

    // Parse field config from JSON string (legacy support)
    FieldConfig ParseFieldConfig(const std::string& jsonConfig);

    // Scan all spells and return JSON output with spell data + prompts
    std::string ScanAllSpells(const ScanConfig& config);
    std::string ScanAllSpells(const FieldConfig& config = FieldConfig{});

    // Scan spells via spell tomes (avoids duplicates, only learnable spells)
    std::string ScanSpellTomes(const ScanConfig& config);

    // Get the system instructions for LLM output format (hidden from user)
    std::string GetSystemInstructions();

    // Get spell info by FormID (for Tree Viewer)
    // Returns JSON with: formId, name, editorId, school, level, cost, type, effects, description
    std::string GetSpellInfoByFormId(const std::string& formIdStr);

    // Helper functions
    std::string GetSchoolName(RE::ActorValue school);
    std::string GetCastingTypeName(RE::MagicSystem::CastingType type);
    std::string GetDeliveryName(RE::MagicSystem::Delivery delivery);
    std::string GetSkillLevelName(uint32_t minimumSkill);
    std::string GetPluginName(RE::FormID formId);
}
