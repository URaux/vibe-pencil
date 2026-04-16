import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import defaultExport from './helpers'

export const GREETING = 'hello'
export let counter = 0

export function greet(name: string): string {
  return `${GREETING}, ${name}`
}

export class Logger {
  log(msg: string) {
    console.log(msg)
  }
}

export interface Config {
  verbose: boolean
}

export type Handler = (x: number) => number

export default function main() {
  return readFile(path.join('.', 'x'))
}
