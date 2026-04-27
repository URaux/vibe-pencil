/**
 * Policy schema — W3.D5.
 *
 * Reads `.archviber/policy.yaml` at the project root. Used by the drift
 * workflow (and, in P3, by other gating systems) to opt-in to blocking
 * behavior. All fields are optional; defaults are permissive (no blocking).
 */

import { z } from 'zod'

/** Drift-specific policy. */
export const driftPolicySchema = z
  .object({
    /** When true, ANY removed block fails the check. Default false. */
    failOnRemoved: z.boolean().default(false),
    /** When true, ANY added block fails the check. Default false. */
    failOnAdded: z.boolean().default(false),
    /** When true, ANY block change (rename / container move / anchor delta) fails. Default false. */
    failOnChanged: z.boolean().default(false),
    /** When true, removed containers fail the check. Default false. */
    failOnRemovedContainers: z.boolean().default(false),
    /** When true, removed edges fail the check. Default false. */
    failOnRemovedEdges: z.boolean().default(false),
    /** Numeric ceiling on each delta type — `undefined` (omitted) = no ceiling. */
    maxAddedBlocks: z.number().int().nonnegative().optional(),
    maxRemovedBlocks: z.number().int().nonnegative().optional(),
    maxChangedBlocks: z.number().int().nonnegative().optional(),
    /** Block / container / edge IDs to filter out of the report before reporting. */
    ignoreBlockIds: z.array(z.string()).default([]),
    ignoreContainerIds: z.array(z.string()).default([]),
    ignoreEdgeIds: z.array(z.string()).default([]),
    /**
     * When set, only drift entries belonging to these containers are included.
     * Edges are kept only when BOTH source and target blocks belong to included containers.
     * Empty array = same as undefined (no-op).
     */
    includeOnlyContainers: z.array(z.string()).optional(),
  })
  .strict()

export type DriftPolicy = z.infer<typeof driftPolicySchema>

export const policySchema = z
  .object({
    drift: driftPolicySchema.default(() => driftPolicySchema.parse({})),
  })
  .strict()

export type Policy = z.infer<typeof policySchema>

export const DEFAULT_POLICY: Policy = {
  drift: {
    failOnRemoved: false,
    failOnAdded: false,
    failOnChanged: false,
    failOnRemovedContainers: false,
    failOnRemovedEdges: false,
    ignoreBlockIds: [],
    ignoreContainerIds: [],
    ignoreEdgeIds: [],
    includeOnlyContainers: undefined,
  },
}
