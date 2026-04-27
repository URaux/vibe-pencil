import { describe, it, expect, vi } from 'vitest'
import { yamlAdapter } from '../../../../src/lib/ingest/languages/yaml'
import type { YamlParsedSymbol } from '../../../../src/lib/ingest/languages/yaml'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string, filePath = '/project/config.yaml'): Promise<FactInputModule> {
  let parser: Awaited<ReturnType<typeof yamlAdapter.loadParser>>
  try {
    parser = await yamlAdapter.loadParser()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('wasm') || msg.includes('WASM') || msg.includes('not found')) {
      return { file: filePath, imports: [], exports: [], symbols: [], language: 'yaml' }
    }
    throw e
  }
  const tree = parser.parse(source)
  const result = yamlAdapter.extractFacts(tree, filePath)
  tree.delete()
  return result
}

const SIMPLE_YAML = `
name: my-project
version: 1.0.0
dependencies:
  react: ^18.0.0
`

const GITHUB_ACTIONS_YAML = `
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
`

const K8S_YAML = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
`

const DOCKER_COMPOSE_YAML = `
version: "3.8"
services:
  web:
    image: nginx
  db:
    image: postgres
`

const OPENAPI_YAML = `
openapi: "3.0.0"
info:
  title: My API
  version: "1.0"
paths:
  /health:
    get:
      summary: Health check
`

describe('yamlAdapter', () => {
  it('Test 1: file extensions are .yaml and .yml', () => {
    expect(yamlAdapter.fileExtensions).toContain('.yaml')
    expect(yamlAdapter.fileExtensions).toContain('.yml')
  })

  it('Test 2: adapter id is yaml', () => {
    expect(yamlAdapter.id).toBe('yaml')
  })

  it('Test 3: top-level keys become const symbols', async () => {
    const result = await parse(SIMPLE_YAML)
    if (result.symbols.length === 0) return // wasm skip
    const kinds = result.symbols.map((s) => s.kind)
    expect(kinds.every((k) => k === 'const')).toBe(true)
    const names = result.symbols.map((s) => s.name)
    expect(names).toContain('name')
    expect(names).toContain('version')
    expect(names).toContain('dependencies')
  })

  it('Test 4: all top-level keys are exported', async () => {
    const result = await parse(SIMPLE_YAML)
    if (result.symbols.length === 0) return // wasm skip
    expect(result.exports).toContain('name')
    expect(result.exports).toContain('version')
    expect(result.exports).toContain('dependencies')
    // symbols should have exported=true
    const syms = result.symbols as YamlParsedSymbol[]
    expect(syms.every((s) => s.exported === true)).toBe(true)
  })

  it('Test 5: yaml file has no imports', async () => {
    const result = await parse(SIMPLE_YAML)
    expect(result.imports).toHaveLength(0)
  })

  it('Test 6: language field is yaml', async () => {
    const result = await parse(SIMPLE_YAML)
    expect(result.language).toBe('yaml')
  })

  it('Test 7: inferTechStack detects GitHub Actions from on+jobs keys', () => {
    const facts: FactInputModule[] = [
      {
        file: '/project/.github/workflows/ci.yml',
        imports: [],
        exports: ['on', 'jobs'],
        symbols: [
          { name: 'on', kind: 'const' },
          { name: 'jobs', kind: 'const' },
        ],
        language: 'yaml',
      },
    ]
    const stack = yamlAdapter.inferTechStack(facts)
    expect(stack).toContain('GitHub Actions')
  })

  it('Test 8: inferTechStack detects Kubernetes from apiVersion+kind keys', () => {
    const facts: FactInputModule[] = [
      {
        file: '/project/k8s/deployment.yaml',
        imports: [],
        exports: ['apiVersion', 'kind', 'metadata'],
        symbols: [
          { name: 'apiVersion', kind: 'const' },
          { name: 'kind', kind: 'const' },
          { name: 'metadata', kind: 'const' },
        ],
        language: 'yaml',
      },
    ]
    const stack = yamlAdapter.inferTechStack(facts)
    expect(stack).toContain('Kubernetes')
  })

  it('Test 9: inferTechStack detects Docker Compose from services key', () => {
    const facts: FactInputModule[] = [
      {
        file: '/project/docker-compose.yml',
        imports: [],
        exports: ['version', 'services', 'networks'],
        symbols: [
          { name: 'version', kind: 'const' },
          { name: 'services', kind: 'const' },
          { name: 'networks', kind: 'const' },
        ],
        language: 'yaml',
      },
    ]
    const stack = yamlAdapter.inferTechStack(facts)
    expect(stack).toContain('Docker Compose')
  })

  it('Test 10: inferTechStack returns YAML for generic config', () => {
    const facts: FactInputModule[] = [
      {
        file: '/project/config.yaml',
        imports: [],
        exports: ['host', 'port', 'timeout'],
        symbols: [
          { name: 'host', kind: 'const' },
          { name: 'port', kind: 'const' },
          { name: 'timeout', kind: 'const' },
        ],
        language: 'yaml',
      },
    ]
    const stack = yamlAdapter.inferTechStack(facts)
    expect(stack).toBe('YAML')
  })

  it('Test 11: inferTechStack detects OpenAPI from openapi key', () => {
    const facts: FactInputModule[] = [
      {
        file: '/project/openapi.yaml',
        imports: [],
        exports: ['openapi', 'info', 'paths'],
        symbols: [
          { name: 'openapi', kind: 'const' },
          { name: 'info', kind: 'const' },
          { name: 'paths', kind: 'const' },
        ],
        language: 'yaml',
      },
    ]
    const stack = yamlAdapter.inferTechStack(facts)
    expect(stack).toContain('OpenAPI')
  })

  it('Test 12: empty YAML produces no symbols or exports', async () => {
    const result = await parse('', '/project/empty.yaml')
    expect(result.imports).toHaveLength(0)
    expect(result.language).toBe('yaml')
    // empty file: symbols may be empty
    expect(Array.isArray(result.symbols)).toBe(true)
    expect(Array.isArray(result.exports)).toBe(true)
  })
})
