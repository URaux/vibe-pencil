/**
 * Default adapter registration 鈥?W2.D1.
 *
 * Import this file (side-effect import) at any ingest entry-point to ensure
 * the built-in language adapters are registered before the registry is queried.
 *
 * Pattern: `import '@/lib/ingest/languages/register-defaults'`
 *
 * This file deliberately avoids auto-registering via module-level side effects
 * inside the adapter files themselves 鈥?that would make it impossible to import
 * a single adapter in tests without triggering the full registration chain.
 */

import { registerAdapter } from './registry'
import { tsAdapter } from './typescript'
import { pythonAdapter } from './python'
import { goAdapter } from './go'
import { javaAdapter } from './java'
import { rustAdapter } from './rust'
import { solidityAdapter } from './solidity'
import { bashAdapter } from './bash'
import { rescriptAdapter } from './rescript'
import { elmAdapter } from './elm'
import { objcAdapter } from './objc'

registerAdapter(tsAdapter)
registerAdapter(pythonAdapter)
registerAdapter(goAdapter)
registerAdapter(javaAdapter)
registerAdapter(rustAdapter)
registerAdapter(solidityAdapter)
registerAdapter(bashAdapter)
registerAdapter(rescriptAdapter)
registerAdapter(elmAdapter)
registerAdapter(objcAdapter)
