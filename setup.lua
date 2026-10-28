-- Setup script for fresh LÖVE games.
--
-- Usage:
--   nebra create https://raw.githubusercontent.com/nebra-lang/love2d-types/main/setup.lua my-game
--
-- Writes a nebra.toml targeting LuaJIT, installs love2d-types for the LÖVE API and adds a
-- conf.neb and main.neb to start from. `nebra build` compiles them to out/, which LÖVE runs
-- with `love out`.

local function projectNameFromCwd()
    local cwd = project.cwd() or "."
    if cwd:sub(-1) == "/" then cwd = cwd:sub(1, -2) end
    local name = cwd:match("([^/\\]+)$") or "love-game"
    return (name:gsub("[^%w%-_]", "-"))
end

local projectName = projectNameFromCwd()
print("Scaffolding LÖVE game: " .. projectName)

project.writeConfig("nebra.toml", {
    name = projectName,
    version = "0.1.0",
    target = "jit",
    source = "src",
    output = "out",
    generate_declarations = false,
    dependencies = {
        ["love2d-types"] = "github:nebra-lang/love2d-types",
    },
    code = {
        index_base = 1,
    },
})

project.writeFile("src/conf.neb", [[
function love.conf(t)
    t.window.title = "]] .. projectName .. [["
    t.window.width = 800
    t.window.height = 600
end
]])

project.writeFile("src/main.neb", [[
local mut x = 100

function love.update(dt)
    if love.keyboard.isDown("right") then
        x = x + 200 * dt
    end
end

function love.draw()
    love.graphics.circle("fill", x, 300, 20)
    love.graphics.print("Hello from Nebra", 10, 10)
end
]])

project.writeGitignore(".gitignore", {})

local installOk = project.installDeps(nil, false)
if not installOk then
    print("Installing the dependencies failed; run `nebra install` once the network is reachable.")
end

print("")
print("Created:")
print("  nebra.toml       -- Nebra build config, targeting LuaJIT")
print("  src/conf.neb     -- love.conf, the window settings")
print("  src/main.neb     -- the game")
print("")
print("Build with `nebra build`, then run it with `love out`.")
