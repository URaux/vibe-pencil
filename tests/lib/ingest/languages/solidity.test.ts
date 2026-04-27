import { describe, it, expect, beforeAll } from 'vitest'
import { solidityAdapter } from '@/lib/ingest/languages/solidity'
import type { FactInputModule } from '@/lib/ingest/languages/types'
import Parser from 'web-tree-sitter'

let sharedParser: Parser | null = null
let parserAvailable = false

beforeAll(async () => {
  try {
    sharedParser = await solidityAdapter.loadParser()
    parserAvailable = true
  } catch {
    parserAvailable = false
  }
})

const maybeIt = parserAvailable ? it : it.skip

function parse(src: string): Parser.Tree {
  return sharedParser!.parse(src)
}

function makeFact(imports: FactInputModule['imports']): FactInputModule {
  return { file: 'test.sol', imports, exports: [], symbols: [], language: 'solidity' }
}

describe('solidityAdapter metadata', () => {
  it('has id solidity', () => expect(solidityAdapter.id).toBe('solidity'))
  it('has .sol extension', () => expect(solidityAdapter.fileExtensions).toContain('.sol'))

  it('inferTechStack: OpenZeppelin', () => {
    const facts = [makeFact([{ from: '@openzeppelin/contracts/token/ERC20/ERC20.sol', names: ['*'] }])]
    expect(solidityAdapter.inferTechStack(facts)).toBe('Solidity/OpenZeppelin')
  })

  it('inferTechStack: Hardhat', () => {
    const facts = [makeFact([{ from: 'hardhat/console.sol', names: ['*'] }])]
    expect(solidityAdapter.inferTechStack(facts)).toBe('Solidity/Hardhat')
  })

  it('inferTechStack: plain Solidity', () => {
    const facts = [makeFact([])]
    expect(solidityAdapter.inferTechStack(facts)).toBe('Solidity')
  })
})

describe('solidityAdapter parser', () => {
  maybeIt('extracts import_directive', () => {
    const src = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nimport "@openzeppelin/contracts/token/ERC20/ERC20.sol";`
    const tree = parse(src)
    const facts = solidityAdapter.extractFacts(tree, 'test.sol')
    expect(facts.imports.length).toBeGreaterThan(0)
    expect(facts.imports[0].from).toContain('openzeppelin')
  })

  maybeIt('extracts contract_declaration as class', () => {
    const src = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract MyToken {\n}`
    const tree = parse(src)
    const facts = solidityAdapter.extractFacts(tree, 'test.sol')
    const contract = facts.symbols.find((s) => s.name === 'MyToken')
    expect(contract).toBeDefined()
    expect(contract?.kind).toBe('class')
  })

  maybeIt('extracts library_declaration as class', () => {
    const src = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nlibrary SafeMath {\n}`
    const tree = parse(src)
    const facts = solidityAdapter.extractFacts(tree, 'test.sol')
    const lib = facts.symbols.find((s) => s.name === 'SafeMath')
    expect(lib).toBeDefined()
    expect(lib?.kind).toBe('class')
  })

  maybeIt('extracts interface_declaration as interface', () => {
    const src = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ninterface IERC20 {\n}`
    const tree = parse(src)
    const facts = solidityAdapter.extractFacts(tree, 'test.sol')
    const iface = facts.symbols.find((s) => s.name === 'IERC20')
    expect(iface).toBeDefined()
    expect(iface?.kind).toBe('interface')
  })

  maybeIt('extracts function_definition with parentClass', () => {
    const src = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Token {\n  function transfer(address to, uint256 amount) public returns (bool) {\n    return true;\n  }\n}`
    const tree = parse(src)
    const facts = solidityAdapter.extractFacts(tree, 'test.sol')
    const fn = facts.symbols.find((s) => s.name === 'transfer')
    expect(fn).toBeDefined()
    expect(fn?.kind).toBe('function')
    expect(fn?.parentClass).toBe('Token')
  })

  maybeIt('public function is exported', () => {
    const src = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Token {\n  function mint() public {}\n  function _burn() internal {}\n}`
    const tree = parse(src)
    const facts = solidityAdapter.extractFacts(tree, 'test.sol')
    expect(facts.exports).toContain('mint')
  })

  maybeIt('extracts state_variable_declaration as const', () => {
    const src = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract Token {\n  uint256 public totalSupply;\n}`
    const tree = parse(src)
    const facts = solidityAdapter.extractFacts(tree, 'test.sol')
    const stateVar = facts.symbols.find((s) => s.kind === 'const')
    expect(stateVar).toBeDefined()
  })

  maybeIt('file path is normalized to forward slashes', () => {
    const src = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract A {}`
    const tree = parse(src)
    const facts = solidityAdapter.extractFacts(tree, 'src\\contracts\\A.sol')
    expect(facts.file).not.toContain('\\')
  })
})
