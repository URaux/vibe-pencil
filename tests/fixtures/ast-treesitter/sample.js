import fs from 'node:fs'
import { join } from 'node:path'

export const VERSION = '1.0.0'

export function readConfig(name) {
  return fs.readFileSync(join('.', name), 'utf8')
}

export class Store {
  constructor() {
    this.items = []
  }
  add(item) {
    this.items.push(item)
  }
}

export default Store
