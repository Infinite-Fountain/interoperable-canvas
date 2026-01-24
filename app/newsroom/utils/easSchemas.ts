/**
 * EAS Schema UIDs for Base network
 * 
 * These are the registered schema UIDs on Base EAS.
 * Each schema defines the structure of attestation data.
 * 
 * @see https://base.easscan.org for schema explorer
 * 
 * ## Schema Documentation Requirements
 * 
 * For each schema added to this file, include the following information:
 * 
 * 1. **Schema Name**: Clear, descriptive name (e.g., "Milestone Outcomes Attestation")
 * 2. **Schema String**: The complete EAS schema string with all fields and types
 *    - Format: `type1 field1,type2 field2,...` (no spaces after commas)
 *    - Example: `uint8 scoreOutcomes,string comment,string milestoneSummary,...`
 * 3. **EAS Explorer Link**: `@see https://base.easscan.org/schema/view/{schemaUID}`
 *    - Add this link once the schema is registered on Base EAS
 *    - Replace `{schemaUID}` with the actual schema UID
 * 4. **Purpose/Description**: Brief explanation of what this attestation evaluates
 *    - Optional but recommended for clarity
 * 5. **Schema UID**: The actual UID returned from EAS schema registration
 *    - Store in the constant (e.g., `MILESTONE_OUTCOMES`)
 *    - Use empty string `''` with TODO comment if not yet registered
 * 6. **Registry Entry**: Add to `SCHEMA_REGISTRY` with the attestation type key
 *    - Key format: `'entityType-attestationType'` (e.g., `'milestone-outcomes'`)
 *    - Value: Reference to the schema UID constant
 * 
 * Example structure:
 * ```typescript
 * /**
 *  * Schema Name
 *  * Schema: uint8 field1,string field2,...
 *  * 
 *  * Brief description of what this evaluates.
 *  * 
 *  * @see https://base.easscan.org/schema/view/0x...
 *  *\/
 *  SCHEMA_NAME: '0x...' as const,
 * ```
 */

export const EAS_SCHEMA_UIDS = {
  /**
   * Milestone Outcomes Attestation
   * Schema: uint8 scoreOutcomes,string comment,string milestoneSummary,string projectId,string folderId,string snapshotId,uint16 milestoneIndex,string discussionId,bytes32 ImmutableContentHash,string ImmutableContentUrl
   * 
   * @see https://base.easscan.org/schema/view/0xbe1dd5dfd0fcf6c821ab82046d5f12749503704740d32f8f86628fa24830d4f3
   */
  MILESTONE_OUTCOMES: '0xbe1dd5dfd0fcf6c821ab82046d5f12749503704740d32f8f86628fa24830d4f3' as const,


  /**
   * Milestone Reporting Attestation
   * Schema: uint8 scoreReporting,string comment,string milestoneSummary,string projectId,string folderId,string snapshotId,uint16 milestoneIndex,string discussionId,bytes32 ImmutableContentHash,string ImmutableContentUrl
   * 
   * Evaluates how well the milestone was reported/communicated (clarity, completeness, transparency).
   * 
   * @see https://base.easscan.org/schema/view/0x369e18dba48a14d15d4c4af0487983e0cdd91fa3c4757e7b5868a8d7e0acae3d
   */
  MILESTONE_REPORTING: '0x369e18dba48a14d15d4c4af0487983e0cdd91fa3c4757e7b5868a8d7e0acae3d' as const,
} as const

/**
 * Schema registry mapping attestation types to schema UIDs
 */
export const SCHEMA_REGISTRY = {
  'milestone-outcomes': EAS_SCHEMA_UIDS.MILESTONE_OUTCOMES,
  'milestone-reporting': EAS_SCHEMA_UIDS.MILESTONE_REPORTING,
} as const

/**
 * Get schema UID for an attestation type
 */
export function getSchemaUID(attestationType: keyof typeof SCHEMA_REGISTRY): string {
  const uid = SCHEMA_REGISTRY[attestationType]
  if (!uid) {
    throw new Error(`Schema UID not found for attestation type: ${attestationType}`)
  }
  return uid
}

/**
 * Base EAS Explorer URL
 */
export const EAS_EXPLORER_BASE_URL = 'https://base.easscan.org'

/**
 * Get EAS Explorer URL for a schema
 */
export function getSchemaExplorerUrl(schemaUID: string): string {
  return `${EAS_EXPLORER_BASE_URL}/schema/view/${schemaUID}`
}

/**
 * Get EAS Explorer URL for an attestation
 */
export function getAttestationExplorerUrl(attestationUID: string): string {
  return `${EAS_EXPLORER_BASE_URL}/attestation/view/${attestationUID}`
}
