import { describe, it, expect } from 'vitest'
import {
  dockerfileAdapter,
  parseDockerfile,
  type DockerfileSymbolEntry,
} from '../../../../src/lib/ingest/languages/dockerfile'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'
import type Parser from 'web-tree-sitter'

function makeTree(text: string): Parser.Tree {
  return { rootNode: { text } } as unknown as Parser.Tree
}

function extractFacts(source: string, filePath = '/project/Dockerfile'): FactInputModule {
  return dockerfileAdapter.extractFacts(makeTree(source), filePath)
}

describe('parseDockerfile', () => {
  it('Test 1: single-stage FROM without AS uses slugified image name', () => {
    const entries = parseDockerfile('FROM node:18-alpine\n')
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('node')
    expect(entries[0].directive).toBe('FROM')
    expect(entries[0].line).toBe(1)
  })

  it('Test 2: multi-stage FROM with AS uses stage name', () => {
    const src = [
      'FROM node:18 AS builder',
      'RUN npm install',
      'FROM nginx:alpine AS runtime',
    ].join('\n')
    const entries = parseDockerfile(src)
    const froms = entries.filter((e) => e.directive === 'FROM')
    expect(froms).toHaveLength(2)
    expect(froms.map((e) => e.name)).toEqual(['builder', 'runtime'])
  })

  it('Test 3: ENV and ARG become const symbols', () => {
    const src = [
      'FROM python:3.11',
      'ARG BUILD_VERSION',
      'ENV NODE_ENV=production',
      'ENV PORT=8080',
    ].join('\n')
    const entries = parseDockerfile(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('BUILD_VERSION')
    expect(names).toContain('NODE_ENV')
    expect(names).toContain('PORT')
    const buildVersion = entries.find((e) => e.name === 'BUILD_VERSION')
    expect(buildVersion?.directive).toBe('ARG')
    const nodeEnv = entries.find((e) => e.name === 'NODE_ENV')
    expect(nodeEnv?.directive).toBe('ENV')
  })

  it('Test 4: EXPOSE port becomes PORT_<n> symbol', () => {
    const src = 'FROM alpine\nEXPOSE 3000\nEXPOSE 8080\n'
    const entries = parseDockerfile(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('PORT_3000')
    expect(names).toContain('PORT_8080')
  })

  it('Test 5: comment lines are ignored', () => {
    const src = [
      '# This is a comment',
      'FROM golang:1.21',
      '# Another comment',
      'ENV APP_HOME=/app',
    ].join('\n')
    const entries = parseDockerfile(src)
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.name)).not.toContain('This')
  })
})

describe('dockerfileAdapter.extractFacts', () => {
  it('all symbols are exported and kind=const', () => {
    const src = 'FROM node:18 AS web\nENV API_KEY=secret\nEXPOSE 3000\n'
    const result = extractFacts(src)
    expect(result.language).toBe('dockerfile')
    for (const sym of result.symbols) {
      expect(sym.kind).toBe('const')
      expect((sym as { exported?: boolean }).exported).toBe(true)
    }
    expect(result.exports).toContain('web')
    expect(result.exports).toContain('API_KEY')
    expect(result.exports).toContain('PORT_3000')
  })

  it('file path uses forward slashes', () => {
    const result = extractFacts('FROM scratch\n', 'C:\\project\\Dockerfile')
    expect(result.file).not.toContain('\\')
  })
})

describe('dockerfileAdapter.inferTechStack', () => {
  it('infers Node.js from node base image', () => {
    const facts = [extractFacts('FROM node:18 AS app\n')]
    expect(dockerfileAdapter.inferTechStack(facts)).toBe('Node.js')
  })

  it('returns Docker for unrecognized base image', () => {
    const facts = [extractFacts('FROM mycompany/custom:latest\n')]
    expect(dockerfileAdapter.inferTechStack(facts)).toBe('Docker')
  })
})

describe('dockerfileAdapter.loadParser', () => {
  it('throws a helpful error since no wasm is available', async () => {
    await expect(dockerfileAdapter.loadParser()).rejects.toThrow(/tree-sitter-dockerfile/)
  })
})
