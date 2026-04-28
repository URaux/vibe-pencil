import { describe, it, expect } from 'vitest'
import { protobufAdapter, parseProtobuf } from '../../../../src/lib/ingest/languages/protobuf'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'
import type Parser from 'web-tree-sitter'

function makeTree(text: string): Parser.Tree {
  return { rootNode: { text } } as unknown as Parser.Tree
}

function extractFacts(source: string, filePath = '/proto/user.proto'): FactInputModule {
  return protobufAdapter.extractFacts(makeTree(source), filePath)
}

describe('parseProtobuf', () => {
  it('Test 1: message block maps to class symbol', () => {
    const src = 'message UserRequest {\n  string id = 1;\n}\n'
    const entries = parseProtobuf(src)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('UserRequest')
    expect(entries[0].kind).toBe('class')
    expect(entries[0].line).toBe(1)
  })

  it('Test 2: enum block maps to class symbol', () => {
    const src = 'enum Status {\n  UNKNOWN = 0;\n  ACTIVE = 1;\n}\n'
    const entries = parseProtobuf(src)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('Status')
    expect(entries[0].kind).toBe('class')
  })

  it('Test 3: service block maps to class, rpc methods map to fn prefixed with service name', () => {
    const src = [
      'service UserService {',
      '  rpc GetUser (UserRequest) returns (UserResponse) {}',
      '  rpc CreateUser (CreateUserRequest) returns (UserResponse) {}',
      '}',
    ].join('\n')
    const entries = parseProtobuf(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('UserService')
    expect(names).toContain('UserService.GetUser')
    expect(names).toContain('UserService.CreateUser')
    const serviceEntry = entries.find((e) => e.name === 'UserService')
    expect(serviceEntry?.kind).toBe('class')
    const rpcEntry = entries.find((e) => e.name === 'UserService.GetUser')
    expect(rpcEntry?.kind).toBe('fn')
  })

  it('Test 4: multiple top-level definitions in one file', () => {
    const src = [
      'message UserRequest { string id = 1; }',
      'message UserResponse { string name = 1; }',
      'enum Role { ADMIN = 0; USER = 1; }',
    ].join('\n')
    const entries = parseProtobuf(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('UserRequest')
    expect(names).toContain('UserResponse')
    expect(names).toContain('Role')
  })

  it('Test 5: comment lines are skipped', () => {
    const src = '// This is a comment\n// another comment\nmessage Foo {}\n'
    const entries = parseProtobuf(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('Foo')
    expect(names).not.toContain('//')
  })

  it('Test 6: oneof inside service maps to class namespaced under service', () => {
    const src = [
      'service AuthService {',
      '  oneof credential {',
      '  }',
      '}',
    ].join('\n')
    const entries = parseProtobuf(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('AuthService')
    expect(names).toContain('AuthService.credential')
  })

  it('Test 7: deduplicates identical symbol names', () => {
    const src = 'message Foo {}\nmessage Foo {}\n'
    const entries = parseProtobuf(src)
    expect(entries.filter((e) => e.name === 'Foo')).toHaveLength(1)
  })
})

describe('protobufAdapter.extractFacts', () => {
  it('all symbols are exported and language is protobuf', () => {
    const src = 'message Request {}\nenum Status { OK = 0; }\n'
    const result = extractFacts(src)
    expect(result.language).toBe('protobuf')
    for (const sym of result.symbols) {
      expect((sym as { exported?: boolean }).exported).toBe(true)
    }
    expect(result.exports).toContain('Request')
    expect(result.exports).toContain('Status')
  })

  it('file path uses forward slashes', () => {
    const result = extractFacts('message Foo {}\n', 'C:\\proto\\user.proto')
    expect(result.file).not.toContain('\\')
  })

  it('imports array is always empty', () => {
    const result = extractFacts('message Foo {}\n')
    expect(result.imports).toHaveLength(0)
  })
})

describe('protobufAdapter.inferTechStack', () => {
  it('returns Protobuf/gRPC when service definitions present', () => {
    const facts = [extractFacts('service Greeter {\n  rpc SayHello (HelloRequest) returns (HelloReply) {}\n}\n')]
    expect(protobufAdapter.inferTechStack(facts)).toBe('Protobuf/gRPC')
  })

  it('returns Protobuf for message-only schemas', () => {
    const facts = [extractFacts('message Request {}\nmessage Response {}\n')]
    expect(protobufAdapter.inferTechStack(facts)).toBe('Protobuf')
  })
})

describe('protobufAdapter.loadParser', () => {
  it('throws a helpful error', async () => {
    await expect(protobufAdapter.loadParser()).rejects.toThrow(/tree-sitter-proto/)
  })
})
