# love2d-types

[Nebra](https://github.com/nebra-lang/nebra) type declarations for **[LÖVE](https://love2d.org)**, the 2D game framework.

Types-only package: it emits no Lua. The declarations are auto-discovered from `nebra_modules/`
once the package is installed.

## Install

```bash
nebra add github:nebra-lang/love2d-types
```

Or scaffold a fresh game that already has everything wired up:

```bash
nebra create https://raw.githubusercontent.com/nebra-lang/love2d-types/main/setup.lua my-game
```

The setup script writes a `nebra.toml` targeting LuaJIT, a `conf.neb` and a `main.neb`.
`nebra build` compiles them to `out/`, which LÖVE runs with `love out`.

## What you get

**The full API** of LÖVE 11.5 in `src/love2d.d.neb`, generated from the
[love-api](https://github.com/love2d-community/love-api) tables: every module under `love`,
every object type with its methods and inheritance (`Image` extends `Texture`, `Drawable` and
`Object`), and the documentation of each function.

**Typed callbacks.** `love.update`, `love.keypressed` and the other callbacks are fields of
`love` typed as the function LÖVE calls, so their parameters are typed without annotations:

```lua
function love.update(dt)                    -- dt: number
end

function love.keypressed(key, scancode, isrepeat)
    if key == "escape" then love.event.quit() end
end
```

**String enums as literal types.** LÖVE's enums are strings, so a draw mode is `"fill" | "line"`
and a typo is a compile error rather than a runtime one:

```lua
love.graphics.rectangle("fill", 10, 10, 32, 32)
love.graphics.rectangle("filled", 10, 10, 32, 32)   -- error: no overload takes ("filled", ...)
```

Enums with very many values, such as `KeyConstant` and `Scancode`, are typed `string`.

**Overloads.** A function with several variants, such as `love.graphics.rectangle` with or
without rounded corners, is declared once per variant.

## Regenerating the declarations

The API tables live in `api/`, a git submodule of love-api. To update them and regenerate:

```bash
git submodule update --remote api
cd generate
node generate.js
```

The generator reads the tables as data, without running them, and rewrites
`src/love2d.d.neb`. Do not hand-edit that file, the next generator run will overwrite it.

## Related

- [Nebra](https://github.com/nebra-lang/nebra) - the compiler and toolchain
- [Documentation](https://nebra-lang.github.io) - language reference and guides
