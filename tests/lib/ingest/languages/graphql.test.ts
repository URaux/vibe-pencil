import { describe, it, expect } from 'vitest'
import { graphqlAdapter, parseGraphql } from '../../../../src/lib/ingest/languages/graphql'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'
import type Parser from 'web-tree-sitter'

function makeTree(text: string): Parser.Tree {
  return { rootNode: { text } } as unknown as Parser.Tree
}

function extractFacts(source: string, filePath = '/schema/schema.graphql'): FactInputModule {
  return graphqlAdapter.extractFacts(makeTree(source), filePath)
}

describe('parseGraphql', () => {
  it('Test 1: type definition maps to class symbol', () => {
    const src = 'type User {\n  id: ID!\n  name: String!\n}\n'
    const entries = parseGraphql(src)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('User')
    expect(entries[0].kind).toBe('class')
    expect(entries[0].line).toBe(1)
  })

  it('Test 2: interface definition maps to class symbol', () => {
    const src = 'interface Node {\n  id: ID!\n}\n'
    const entries = parseGraphql(src)
    expect(entries[0].name).toBe('Node')
    expect(entries[0].kind).toBe('class')
  })

  it('Test 3: union definition maps to class symbol', () => {
    const src = 'union SearchResult = User | Post\n'
    const entries = parseGraphql(src)
    expect(entries[0].name).toBe('SearchResult')
    expect(entries[0].kind).toBe('class')
  })

  it('Test 4: enum definition maps to class symbol', () => {
    const src = 'enum Role {\n  ADMIN\n  USER\n  GUEST\n}\n'
    const entries = parseGraphql(src)
    expect(entries[0].name).toBe('Role')
    expect(entries[0].kind).toBe('class')
  })

  it('Test 5: input definition maps to class symbol', () => {
    const src = 'input CreateUserInput {\n  name: String!\n  email: String!\n}\n'
    const entries = parseGraphql(src)
    expect(entries[0].name).toBe('CreateUserInput')
    expect(entries[0].kind).toBe('class')
  })

  it('Test 6: scalar definition maps to const symbol', () => {
    const src = 'scalar Date\nscalar Upload\n'
    const entries = parseGraphql(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('Date')
    expect(names).toContain('Upload')
    entries.forEach((e) => expect(e.kind).toBe('const'))
  })

  it('Test 7: Query root fields map to fn symbols', () => {
    const src = [
      'type Query {',
      '  user(id: ID!): User',
      '  users: [User!]!',
      '}',
    ].join('\n') + '\n'
    const entries = parseGraphql(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('Query')
    expect(names).toContain('Query.user')
    expect(names).toContain('Query.users')
    const queryUser = entries.find((e) => e.name === 'Query.user')
    expect(queryUser?.kind).toBe('fn')
  })

  it('Test 8: Mutation root fields map to fn symbols', () => {
    const src = [
      'type Mutation {',
      '  createUser(input: CreateUserInput!): User',
      '  deleteUser(id: ID!): Boolean',
      '}',
    ].join('\n') + '\n'
    const entries = parseGraphql(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('Mutation')
    expect(names).toContain('Mutation.createUser')
    expect(names).toContain('Mutation.deleteUser')
  })

  it('Test 9: comment lines are skipped', () => {
    const src = '# This is a GraphQL comment\ntype Post {\n  id: ID!\n}\n'
    const entries = parseGraphql(src)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('Post')
  })

  it('Test 10: mixed schema with all definition types', () => {
    const src = [
      'scalar DateTime',
      'interface Node { id: ID! }',
      'enum Status { ACTIVE INACTIVE }',
      'type User implements Node { id: ID! status: Status }',
      'input UpdateInput { name: String }',
      'union Result = User | Error',
      'type Query { me: User }',
    ].join('\n') + '\n'
    const entries = parseGraphql(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('DateTime')
    expect(names).toContain('Node')
    expect(names).toContain('Status')
    expect(names).toContain('User')
    expect(names).toContain('UpdateInput')
    expect(names).toContain('Result')
    expect(names).toContain('Query')
    expect(names).toContain('Query.me')
  })
})

describe('graphqlAdapter.extractFacts', () => {
  it('all symbols are exported', () => {
    const src = 'type User { id: ID! }\nscalar Date\n'
    const result = extractFacts(src)
    expect(result.language).toBe('graphql')
    for (const sym of result.symbols) {
      expect((sym as { exported?: boolean }).exported).toBe(true)
    }
  })

  it('file path uses forward slashes', () => {
    const result = extractFacts('type Foo { id: ID! }\n', 'C:\\schema\\schema.graphql')
    expect(result.file).not.toContain('\\')
  })

  it('imports array is empty (GraphQL schemas have no imports)', () => {
    const result = extractFacts('type Foo { id: ID! }\n')
    expect(result.imports).toHaveLength(0)
  })
})

describe('graphqlAdapter.inferTechStack', () => {
  it('returns GraphQL for plain schema files', () => {
    const facts = [extractFacts('type User { id: ID! }\n')]
    expect(graphqlAdapter.inferTechStack(facts)).toBe('GraphQL')
  })
})

describe('graphqlAdapter.loadParser', () => {
  it('throws a helpful error about missing wasm', async () => {
    await expect(graphqlAdapter.loadParser()).rejects.toThrow(/tree-sitter-graphql/)
  })
})

describe('graphqlAdapter metadata', () => {
  it('has correct id and fileExtensions', () => {
    expect(graphqlAdapter.id).toBe('graphql')
    expect(graphqlAdapter.fileExtensions).toContain('.graphql')
    expect(graphqlAdapter.fileExtensions).toContain('.gql')
  })
})
