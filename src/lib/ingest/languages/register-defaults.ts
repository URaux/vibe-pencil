/**
 * Default adapter registration — W2.D1.
 *
 * Import this file (side-effect import) at any ingest entry-point to ensure
 * the built-in language adapters are registered before the registry is queried.
 *
 * Pattern: `import '@/lib/ingest/languages/register-defaults'`
 *
 * This file deliberately avoids auto-registering via module-level side effects
 * inside the adapter files themselves — that would make it impossible to import
 * a single adapter in tests without triggering the full registration chain.
 */

import { registerAdapter } from './registry'
import { tsAdapter } from './typescript'
import { pythonAdapter } from './python'
import { goAdapter } from './go'
import { javaAdapter } from './java'
import { rustAdapter } from './rust'
import { yamlAdapter } from './yaml'

registerAdapter(tsAdapter)
registerAdapter(pythonAdapter)
registerAdapter(goAdapter)
registerAdapter(javaAdapter)
registerAdapter(rustAdapter)
registerAdapter(yamlAdapter)
