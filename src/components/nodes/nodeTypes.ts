import { ServiceNode } from './ServiceNode'
import { FrontendNode } from './FrontendNode'
import { ApiNode } from './ApiNode'
import { DatabaseNode } from './DatabaseNode'
import { QueueNode } from './QueueNode'
import { ExternalNode } from './ExternalNode'

export const nodeTypes = {
  service: ServiceNode,
  frontend: FrontendNode,
  api: ApiNode,
  database: DatabaseNode,
  queue: QueueNode,
  external: ExternalNode,
}
