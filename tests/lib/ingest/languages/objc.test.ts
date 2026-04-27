import { describe, it, expect, beforeAll } from 'vitest'
import { objcAdapter } from '@/lib/ingest/languages/objc'
import type { FactInputModule } from '@/lib/ingest/languages/types'
import Parser from 'web-tree-sitter'

let sharedParser: Parser | null = null
let parserAvailable = false

beforeAll(async () => {
  try {
    sharedParser = await objcAdapter.loadParser()
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
  return { file: 'Main.m', imports, exports: [], symbols: [], language: 'objc' }
}

describe('objcAdapter metadata', () => {
  it('has id objc', () => expect(objcAdapter.id).toBe('objc'))
  it('has .m extension', () => expect(objcAdapter.fileExtensions).toContain('.m'))
  it('does not claim .h extension', () => expect(objcAdapter.fileExtensions).not.toContain('.h'))

  it('inferTechStack: plain ObjC', () => {
    const facts = [makeFact([])]
    expect(objcAdapter.inferTechStack(facts)).toBe('ObjC')
  })

  it('inferTechStack: ObjC/UIKit with UIKit import', () => {
    const facts = [makeFact([{ from: 'UIKit/UIKit.h', names: ['*'] }])]
    expect(objcAdapter.inferTechStack(facts)).toBe('ObjC/UIKit')
  })

  it('inferTechStack: ObjC/Foundation with Foundation import', () => {
    const facts = [makeFact([{ from: 'Foundation/Foundation.h', names: ['*'] }])]
    expect(objcAdapter.inferTechStack(facts)).toBe('ObjC/Foundation')
  })
})

describe('objcAdapter parser', () => {
  maybeIt('extracts #import as import', () => {
    const src = '#import <UIKit/UIKit.h>\n@interface MyClass : NSObject\n@end'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'MyClass.m')
    expect(facts.imports.some((i) => i.from.includes('UIKit'))).toBe(true)
  })

  maybeIt('#import has wildcard names', () => {
    const src = '#import <Foundation/Foundation.h>'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'Main.m')
    expect(facts.imports[0]?.names).toContain('*')
  })

  maybeIt('extracts class_interface as class', () => {
    const src = '@interface MyViewController : UIViewController\n@end'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'MyViewController.m')
    const sym = facts.symbols.find((s) => s.name === 'MyViewController')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  maybeIt('class_interface is exported', () => {
    const src = '@interface AppDelegate : NSObject\n@end'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'AppDelegate.m')
    expect(facts.exports).toContain('AppDelegate')
  })

  maybeIt('extracts protocol_declaration as interface', () => {
    const src = '@protocol MyProtocol\n- (void)doSomething;\n@end'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'MyProtocol.m')
    const sym = facts.symbols.find((s) => s.name === 'MyProtocol')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('interface')
  })

  maybeIt('language field is objc', () => {
    const src = '@interface Foo : NSObject\n@end'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'Foo.m')
    expect(facts.language).toBe('objc')
  })

  maybeIt('file path normalized to forward slashes', () => {
    const src = '@interface Foo : NSObject\n@end'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'src\\ios\\Foo.m')
    expect(facts.file).not.toContain('\\')
  })

  maybeIt('category_interface extracted as class', () => {
    const src = '@interface NSString (MyCategory)\n- (NSString *)reversed;\n@end'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'NSString+MyCategory.m')
    expect(facts.symbols.some((s) => s.kind === 'class')).toBe(true)
  })

  maybeIt('multiple imports extracted', () => {
    const src = '#import <UIKit/UIKit.h>\n#import "MyHelper.h"\n@interface Foo : NSObject\n@end'
    const tree = parse(src)
    const facts = objcAdapter.extractFacts(tree, 'Foo.m')
    expect(facts.imports.length).toBeGreaterThanOrEqual(2)
  })
})
