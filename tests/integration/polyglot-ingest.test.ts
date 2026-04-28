/**
 * End-to-end polyglot ingest smoke test.
 *
 * Builds a tmp fixture directory with one sample file per registered language
 * adapter, runs the ingest pipeline, and asserts every adapter produced ≥1
 * symbol. Phase3 adapters that aren't merged yet are skipped automatically —
 * when a branch is merged its adapter appears in the registry and the
 * corresponding test activates without any change here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingestPolyglotProject } from '@/lib/ingest/pipeline'
import '@/lib/ingest/languages/register-defaults'
import { listAdapters } from '@/lib/ingest/languages/registry'

// ---------------------------------------------------------------------------
// Fixture content by file extension
// ---------------------------------------------------------------------------

const FIXTURE_FILES: Record<string, string> = {
  // Core adapters (phase2/w2)
  'index.ts': `
export interface User { id: number; name: string }
export function greet(user: User): string { return 'hello ' + user.name }
export const VERSION = '1.0.0'
`,
  'main.py': `
class Config:
    debug: bool = False
    port: int = 8080

def start_server(config: Config) -> None:
    pass

MAX_RETRIES = 3
`,
  'main.go': `
package main

import "fmt"

type Server struct {
    Port int
    Host string
}

func NewServer(port int) *Server {
    return &Server{Port: port}
}

func main() {
    fmt.Println("started")
}
`,
  'Main.java': `
public class Main {
    public static final int VERSION = 1;
    public static void main(String[] args) {}
    public static String greet(String name) { return "Hello " + name; }
}
`,
  'lib.rs': `
pub struct Config {
    pub port: u16,
}

pub fn create_config(port: u16) -> Config {
    Config { port }
}

pub const DEFAULT_PORT: u16 = 8080;
`,

  // Phase3 adapters — registered when branches are merged into phase2/w2.
  // Files present so the adapter can parse them; tests skip if adapter absent.
  'app.dart': `
class AppConfig {
  final String name;
  AppConfig({required this.name});
}

String greet(String name) => 'Hello \$name';
const String version = '1.0.0';
`,
  'analysis.R': `
compute_mean <- function(x) mean(x)
MAX_ITER <- 1000
`,
  'server.erl': `
-module(server).
-export([start/0]).
start() -> ok.
`,
  'parser.nim': `
proc parseInput*(input: string): seq[string] =
  input.split(',')

const MaxTokens* = 1024
`,
  'Widget.hx': `
class Widget {
  public var id: Int;
  public function new(id: Int) { this.id = id; }
  public function render(): String { return "Widget"; }
}
`,
  'token.sol': `
pragma solidity ^0.8.0;
contract Token {
  uint public totalSupply;
  function mint(address to, uint amount) external {}
}
`,
  'deploy.sh': `
#!/usr/bin/env bash
APP_NAME="myapp"
deploy() {
  echo "deploying \$APP_NAME"
}
`,
  'parser.ml': `
type token = Ident of string | Num of int
let tokenize input = [Ident input]
let max_tokens = 1024
`,
  'App.vue': `<template><div>{{ message }}</div></template>
<script>
export default {
  name: 'App',
  data() { return { message: 'hello' } },
  methods: { greet() {} }
}
</script>
`,
  'Main.elm': `
module Main exposing (main, Model)
import Html exposing (text)
type alias Model = { count : Int }
main = text "hello"
`,
  'Api.res': `
type user = { id: int, name: string }
let greet = (user: user): string => "Hello " ++ user.name
`,
  'MyClass.m': `
#import <Foundation/Foundation.h>
@interface MyClass : NSObject
- (void)doSomething;
@end
@implementation MyClass
- (void)doSomething {}
@end
`,
  'utils.el': `
(defun my-greet (name)
  (message "Hello %s" name))
(defconst my-version "1.0")
`,
  'package.json': `{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": { "build": "tsc", "test": "vitest" },
  "dependencies": {}
}
`,
  '.archviber/config.yaml': `
project: my-app
version: 1
settings:
  maxFiles: 5000
  skipDirs:
    - node_modules
`,
  'Cargo.toml': `
[package]
name = "my-crate"
version = "0.1.0"

[dependencies]
serde = "1.0"
`,
  'Dockerfile': `
FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
CMD ["node", "index.js"]
`,
  'main.tf': `
terraform {
  required_version = ">= 1.0"
}
variable "region" {
  type    = string
  default = "us-east-1"
}
resource "aws_instance" "web" {
  ami           = "ami-12345"
  instance_type = "t3.micro"
}
`,
  'schema.graphql': `
type Query {
  user(id: ID!): User
  users: [User!]!
}
type User {
  id: ID!
  name: String!
  email: String
}
`,
  'service.proto': `
syntax = "proto3";
package myservice;
message User {
  int32 id = 1;
  string name = 2;
}
service UserService {
  rpc GetUser (UserRequest) returns (User);
}
message UserRequest { int32 id = 1; }
`,
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polyglot-smoke-'))

  // Write all fixture files (create subdirs as needed)
  for (const [relPath, content] of Object.entries(FIXTURE_FILES)) {
    const absPath = path.join(tmpDir, relPath)
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, content.trim(), 'utf8')
  }
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRegisteredExtensions(): Set<string> {
  const exts = new Set<string>()
  for (const adapter of listAdapters()) {
    for (const ext of adapter.fileExtensions) {
      exts.add(ext.toLowerCase())
    }
  }
  return exts
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('polyglot ingest smoke', () => {
  it('pipeline runs without throwing and visits files', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    expect(result.diagnostics.filesVisited).toBeGreaterThan(0)
    expect(result.diagnostics.filesFailedParse).toHaveLength(0)
  })

  it('all registered adapters parse their fixture file and produce ≥1 symbol', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const adapters = listAdapters()

    for (const adapter of adapters) {
      const ext = adapter.fileExtensions[0]
      // Find a fixture file for this adapter
      const fixtureEntry = Object.entries(FIXTURE_FILES).find(([fp]) =>
        adapter.fileExtensions.includes(path.extname(fp).toLowerCase()),
      )
      if (!fixtureEntry) {
        // No fixture for this adapter — skip (not a failure)
        continue
      }

      const [fixtureRelPath] = fixtureEntry
      const parsedCount = result.diagnostics.byLanguage[adapter.id] ?? 0
      expect(parsedCount, `adapter "${adapter.id}" (ext ${ext}) parsed 0 files`).toBeGreaterThan(0)

      const adapterModules = result.modules.filter(
        (m) => m.file === fixtureRelPath || m.file.endsWith(path.basename(fixtureRelPath)),
      )
      const symbolCount = adapterModules.reduce((sum, m) => sum + m.symbols.length, 0)
      expect(
        symbolCount,
        `adapter "${adapter.id}" produced 0 symbols from ${fixtureRelPath}`,
      ).toBeGreaterThan(0)
    }
  })

  it('overall IR contains symbols from all 5 core adapters', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const coreAdapters = ['typescript', 'python', 'go', 'java', 'rust']
    for (const id of coreAdapters) {
      expect(
        result.diagnostics.byLanguage[id] ?? 0,
        `core adapter "${id}" produced no parsed files`,
      ).toBeGreaterThan(0)
    }
  })

  it('IR graph has ≥5 symbol nodes (one per core language)', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const symbolNodes = [...result.graph.nodes.values()].filter((n) => n.kind === 'symbol')
    expect(symbolNodes.length).toBeGreaterThanOrEqual(5)
  })

  it('typescript fixture produces exported symbol User', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const tsMod = result.modules.find((m) => m.file.endsWith('index.ts'))
    expect(tsMod).toBeDefined()
    const names = tsMod!.symbols.map((s) => s.name)
    expect(names).toContain('User')
  })

  it('python fixture produces symbol Config', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const pyMod = result.modules.find((m) => m.file.endsWith('main.py'))
    expect(pyMod).toBeDefined()
    const names = pyMod!.symbols.map((s) => s.name)
    expect(names).toContain('Config')
  })

  it('go fixture produces symbol Server', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const goMod = result.modules.find((m) => m.file.endsWith('main.go'))
    expect(goMod).toBeDefined()
    const names = goMod!.symbols.map((s) => s.name)
    expect(names).toContain('Server')
  })

  it('java fixture produces symbol Main', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const javaMod = result.modules.find((m) => m.file.endsWith('Main.java'))
    expect(javaMod).toBeDefined()
    const names = javaMod!.symbols.map((s) => s.name)
    expect(names).toContain('Main')
  })

  it('rust fixture produces symbol Config', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const rustMod = result.modules.find((m) => m.file.endsWith('lib.rs'))
    expect(rustMod).toBeDefined()
    const names = rustMod!.symbols.map((s) => s.name)
    expect(names).toContain('Config')
  })

  it('files without a registered adapter are skipped (not failed)', async () => {
    const result = await ingestPolyglotProject(tmpDir)
    const registeredExts = getRegisteredExtensions()
    const fixtureExts = Object.keys(FIXTURE_FILES).map((fp) =>
      path.extname(fp).toLowerCase(),
    )
    const unregistered = fixtureExts.filter((e) => e && !registeredExts.has(e))
    // All parse failures should be zero — unregistered files are simply skipped
    expect(result.diagnostics.filesFailedParse).toHaveLength(0)
    // Files skipped without adapter should include the unregistered ones (≥ count)
    expect(result.diagnostics.filesSkippedNoAdapter).toBeGreaterThanOrEqual(
      new Set(unregistered).size,
    )
  })
})
