set_xmakever("3.0.5")

PROJECT_NAME = "SpellLearning"

set_project(PROJECT_NAME)
set_version("1.2.2")
set_languages("cxx23")
set_toolchains("clang-cl")

includes("plugin/extern/CommonLibSSE-NG")

add_rules("mode.debug", "mode.release")

add_defines("UNICODE", "_UNICODE")

if is_mode("debug") then
    set_optimize("none")
    add_defines("DEBUG")
elseif is_mode("release") then
    set_optimize("fastest")
    add_defines("NDEBUG")
    set_symbols("debug")
end

add_requires("spdlog", { configs = { header_only = false, wchar = true, std_format = true } })
add_requires("nlohmann_json")
add_requires("xbyak")

target(PROJECT_NAME)

    add_deps("commonlibsse-ng")
    add_rules("commonlibsse-ng.plugin", {
        name = PROJECT_NAME,
        author = "DinkelZombie",
        description = "AI-Generated Spell Learning Tree System",
        options = {
            address_library = true,
            signature_scanning = false,
            struct_dependent = false
        }
    })

    add_packages("spdlog")
    add_packages("nlohmann_json")
    add_packages("xbyak")
    add_includedirs("plugin/include/")
    set_pcxxheader("plugin/include/pch.h")
    add_headerfiles("plugin/include/**.h")
    add_files("plugin/src/**.cpp")