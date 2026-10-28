#!/usr/bin/env node
'use strict';

// Reads the love-api tables from ../api/ and emits the Nebra declarations for LÖVE at
// ../src/love2d.d.neb. The tables are Lua files, read here as data: they hold nothing but
// table constructors and `require(path .. 'module.name')` references to further files, so
// no Lua code is run to read them.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'api');
const OUT_PATH = path.join(ROOT, 'src', 'love2d.d.neb');

// Enums with more constants than this are typed `string` instead of a union of their values,
// which would make every signature using them unreadable (KeyConstant has over a hundred).
const MAX_LITERAL_UNION = 40;

const NEBRA_KEYWORDS = new Set([
    'abstract', 'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'constructor',
    'continue', 'declare', 'defer', 'do', 'else', 'elseif', 'end', 'enum', 'export', 'extend',
    'extends', 'false', 'finally', 'for', 'from', 'function', 'goto', 'guard', 'if', 'implements',
    'import', 'in', 'instanceof', 'interface', 'keyof', 'local', 'match', 'meta', 'module', 'mut',
    'new', 'nil', 'not', 'or', 'override', 'protected', 'repeat', 'return', 'static', 'super',
    'then', 'true', 'try', 'typeof', 'until', 'when', 'while',
]);

// Reads a Lua file of the love-api: everything after its `return` is one value.
function readLuaFile(file) {
    const text = fs.readFileSync(file, 'utf8');
    const start = text.indexOf('return');
    if (start < 0) throw new Error(`${file}: no return`);
    const reader = new LuaReader(text, start + 'return'.length, path.dirname(file));
    return reader.value();
}

// A reader for the subset of Lua the love-api is written in: tables, strings, numbers,
// booleans, nil, and `(require(path .. 'name'))`, which reads the file it names instead.
class LuaReader {
    constructor(text, position, directory) {
        this.text = text;
        this.pos = position;
        this.directory = directory;
    }

    skipBlank() {
        for (;;) {
            while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
            if (!this.text.startsWith('--', this.pos)) return;
            if (this.text.startsWith('--[[', this.pos)) {
                const end = this.text.indexOf(']]', this.pos);
                this.pos = end < 0 ? this.text.length : end + 2;
            } else {
                const end = this.text.indexOf('\n', this.pos);
                this.pos = end < 0 ? this.text.length : end + 1;
            }
        }
    }

    peek() {
        this.skipBlank();
        return this.text[this.pos];
    }

    expect(token) {
        this.skipBlank();
        if (!this.text.startsWith(token, this.pos)) {
            throw new Error(`expected '${token}' at ${this.pos}: ${this.text.slice(this.pos, this.pos + 40)}`);
        }
        this.pos += token.length;
    }

    value() {
        const next = this.peek();
        if (next === '{') return this.table();
        if (next === '\'' || next === '"') return this.string();
        if (next === '(') return this.require();
        if (next === '[' && this.text[this.pos + 1] === '[') return this.longString();

        const word = this.text.slice(this.pos).match(/^(-?[0-9][0-9.eExX]*|true|false|nil)/);
        if (!word) throw new Error(`unexpected value at ${this.pos}: ${this.text.slice(this.pos, this.pos + 40)}`);
        this.pos += word[0].length;
        if (word[0] === 'true') return true;
        if (word[0] === 'false') return false;
        if (word[0] === 'nil') return null;
        return Number(word[0]);
    }

    table() {
        this.expect('{');
        const named = {};
        const positional = [];
        while (this.peek() !== '}') {
            const key = this.text.slice(this.pos).match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/);
            if (key) {
                this.pos += key[0].length;
                named[key[1]] = this.value();
            } else {
                positional.push(this.value());
            }
            if (this.peek() === ',' || this.peek() === ';') this.pos++;
        }
        this.expect('}');
        return Object.keys(named).length > 0 ? named : positional;
    }

    string() {
        const quote = this.text[this.pos++];
        let result = '';
        while (this.text[this.pos] !== quote) {
            const character = this.text[this.pos++];
            if (character !== '\\') {
                result += character;
                continue;
            }
            const escaped = this.text[this.pos++];
            result += { n: '\n', t: '\t', r: '\r' }[escaped] ?? escaped;
        }
        this.pos++;
        return result;
    }

    longString() {
        const end = this.text.indexOf(']]', this.pos);
        const result = this.text.slice(this.pos + 2, end);
        this.pos = end + 2;
        return result;
    }

    require() {
        this.expect('(');
        this.expect('require');
        this.expect('(');
        this.expect('path');
        this.expect('..');
        this.skipBlank();
        const name = this.string();
        this.expect(')');
        this.expect(')');
        return readLuaFile(path.join(this.directory, ...name.split('.')) + '.lua');
    }
}

const api = readLuaFile(path.join(API_DIR, 'love_api.lua'));
const modules = api.modules || [];

const ENUMS = new Map();
const TYPES = new Map();
for (const type of api.types || []) TYPES.set(type.name, type);
for (const module of modules) {
    for (const type of module.types || []) TYPES.set(type.name, type);
    for (const enumeration of module.enums || []) ENUMS.set(enumeration.name, enumeration);
}

function safeIdent(name) {
    let ident = String(name || '_').replace(/[^A-Za-z0-9_]/g, '_');
    if (/^[0-9]/.test(ident)) ident = '_' + ident;
    return NEBRA_KEYWORDS.has(ident) ? ident + '_' : ident;
}

function fieldLabel(name) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !NEBRA_KEYWORDS.has(name) ? name : JSON.stringify(name);
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function grouped(type) {
    return /[|>]/.test(type) ? `(${type})` : type;
}

// The Nebra type for a type name as the love-api writes it, such as `number`, `Image`,
// `DrawMode` or `Data or string`.
function mapType(raw) {
    const text = String(raw || 'any').trim();
    const alternatives = text.split(/\s+or\s+|\s*\|\s*/).filter(Boolean);
    if (alternatives.length > 1) return unique(alternatives.map(mapType)).join(' | ');

    switch (text) {
        case 'number': case 'string': case 'boolean': case 'nil': case 'any': case 'function':
            return text;
        case 'table':
            return '{ [any]: any }';
        case 'light userdata':
            return 'userdata';
        default:
            break;
    }

    if (ENUMS.has(text)) {
        const constants = ENUMS.get(text).constants || [];
        if (constants.length === 0 || constants.length > MAX_LITERAL_UNION) return 'string';
        return unique(constants.map(constant => JSON.stringify(constant.name))).join(' | ');
    }
    return TYPES.has(text) ? text : 'any';
}

function unique(items) {
    return [...new Set(items)];
}

// The type of an argument, return value or table field, which may describe a table by its
// fields (`table`), its elements (`arraytype`) or its keys and values (`tabletype`).
function entryType(entry) {
    if (Array.isArray(entry.table) && entry.table.length > 0) {
        const fields = entry.table.map(field => {
            const optional = 'default' in field && !mapType(field.type).includes('nil');
            return `${fieldLabel(field.name)}: ${entryType(field)}${optional ? ' | nil' : ''}`;
        });
        return `{ ${fields.join(', ')} }`;
    }
    if (entry.arraytype) return `${grouped(mapType(entry.arraytype))}[]`;
    if (Array.isArray(entry.tabletype) && entry.tabletype.length === 2) {
        return `{ [${mapType(entry.tabletype[0])}]: ${mapType(entry.tabletype[1])} }`;
    }
    return mapType(entry.type);
}

function optionalType(type) {
    return type.split(' | ').includes('nil') ? type : `${type} | nil`;
}

function parameterList(variant) {
    return (variant.arguments || []).map(argument => {
        if (argument.name === '...') return `...: ${entryType(argument)}`;
        const type = entryType(argument);
        return `${safeIdent(argument.name)}: ${'default' in argument ? optionalType(type) : type}`;
    }).join(', ');
}

function returnType(variant) {
    const returns = variant.returns || [];
    if (returns.length === 0) return 'nil';
    const types = returns.map(value => value.name === '...' ? `...${grouped(entryType(value))}` : entryType(value));
    return types.length === 1 ? types[0] : `(${types.join(', ')})`;
}

function cleanText(text) {
    return String(text || '').replace(/\r/g, '').trim();
}

// The documentation comment of a function variant: the function's description, then a
// `@param` line per described argument and a `@return` line per described return value.
function documentation(indent, description, variant) {
    const lines = [];
    for (const line of cleanText(description).split('\n')) {
        if (line.trim()) lines.push(`${indent}--- ${line.trim()}`);
    }
    if (variant && cleanText(variant.description)) {
        for (const line of cleanText(variant.description).split('\n')) {
            if (line.trim()) lines.push(`${indent}--- ${line.trim()}`);
        }
    }
    for (const argument of (variant && variant.arguments) || []) {
        const text = cleanText(argument.description).replace(/\s*\n\s*/g, ' ');
        if (text) lines.push(`${indent}--- @param ${argument.name === '...' ? '...' : safeIdent(argument.name)} ${text}`);
    }
    for (const value of (variant && variant.returns) || []) {
        const text = cleanText(value.description).replace(/\s*\n\s*/g, ' ');
        if (text) lines.push(`${indent}--- @return ${entryType(value)} ${text}`);
    }
    return lines;
}

// The declarations of a function, one per variant whose parameter types differ from the ones
// before it; variants that only differ in what the love-api documents collapse into one.
function functionDeclarations(indent, fn, keyword) {
    const out = [];
    const seen = new Set();
    for (const variant of fn.variants || [{}]) {
        const parameters = parameterList(variant);
        const signature = parameters.replace(/[A-Za-z_][A-Za-z0-9_]*: /g, '');
        if (seen.has(signature)) continue;
        seen.add(signature);
        out.push(...documentation(indent, fn.description, variant));
        out.push(`${indent}${keyword} ${safeIdent(fn.name)}(${parameters}): ${returnType(variant)}`);
    }
    return out;
}

// The most specific supertype of a type: the first one the love-api lists that is a type it
// declares, since the list runs from the nearest to `Object`.
function baseType(type) {
    return (type.supertypes || []).find(name => TYPES.has(name) && name !== type.name);
}

// The names of the functions the types a type extends declare, which it overrides when it
// declares them again.
function inheritedFunctions(type) {
    const names = new Set();
    for (let base = baseType(type); base; base = baseType(TYPES.get(base))) {
        for (const fn of TYPES.get(base).functions || []) names.add(fn.name);
    }
    return names;
}

function emitType(type) {
    const out = [];
    const inherited = inheritedFunctions(type);
    for (const line of cleanText(type.description).split('\n')) {
        if (line.trim()) out.push(`--- ${line.trim()}`);
    }
    const base = baseType(type);
    out.push(`declare class ${type.name}${base ? ` extends ${base}` : ''}`);
    for (const fn of type.functions || []) {
        out.push(...functionDeclarations('    ', fn, inherited.has(fn.name) ? 'override function' : 'function'));
    }
    out.push('end');
    return out.join('\n');
}

// Types in an order where every class comes after the class it extends.
function orderedTypes() {
    const ordered = [];
    const placed = new Set();
    const place = type => {
        if (placed.has(type.name)) return;
        const base = baseType(type);
        if (base) place(TYPES.get(base));
        placed.add(type.name);
        ordered.push(type);
    };
    for (const type of TYPES.values()) place(type);
    return ordered;
}

function moduleInterfaceName(module) {
    return `Love${capitalize(module.name)}`;
}

function emitModule(module) {
    const out = [];
    for (const line of cleanText(module.description).split('\n')) {
        if (line.trim()) out.push(`--- ${line.trim()}`);
    }
    out.push(`declare interface ${moduleInterfaceName(module)}`);
    for (const fn of module.functions || []) out.push(...functionDeclarations('    ', fn, 'function'));
    out.push('end');
    return out.join('\n');
}

// The type of a callback field such as `love.update`: the function LÖVE calls, which a game
// assigns. A callback LÖVE reads a value from returns it optionally; any other may return
// anything, which LÖVE ignores.
function callbackType(callback) {
    const variant = (callback.variants || [{}])[0];
    const parameters = (variant.arguments || []).map(argument => argument.name === '...'
        ? `...${grouped(entryType(argument))}`
        : entryType(argument));
    const returns = variant.returns || [];
    const result = returns.length === 0 ? 'any' : optionalType(entryType(returns[0]));
    return `(${parameters.join(', ')}) -> ${result}`;
}

function emitLove() {
    const out = [];
    out.push('--- The LÖVE framework: its modules, the functions of `love` itself and the callbacks a game assigns.');
    out.push('declare interface Love');
    for (const module of modules) out.push(`    ${safeIdent(module.name)}: ${moduleInterfaceName(module)}`);
    for (const fn of api.functions || []) out.push(...functionDeclarations('    ', fn, 'function'));
    for (const callback of api.callbacks || []) {
        out.push(...documentation('    ', callback.description, null));
        out.push(`    ${safeIdent(callback.name)}: (${callbackType(callback)})?`);
    }
    out.push('end');
    out.push('');
    out.push('declare love: Love');
    return out.join('\n');
}

function main() {
    const parts = [];
    parts.push(`-- Generated from the love-api tables for LÖVE ${api.version}.`);
    parts.push('-- Source: api/ (git submodule), generator: generate/generate.js.');
    parts.push('-- Do not edit by hand. Run `npm run generate` in generate/ after updating the submodule.');
    parts.push('');

    for (const type of orderedTypes()) {
        parts.push(emitType(type));
        parts.push('');
    }
    for (const module of modules) {
        parts.push(emitModule(module));
        parts.push('');
    }
    parts.push(emitLove());
    parts.push('');

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, parts.join('\n'));
    console.log(`Generated ${path.relative(ROOT, OUT_PATH)} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KiB, ${TYPES.size} types, ${modules.length} modules, ${ENUMS.size} enums)`);
}

main();
