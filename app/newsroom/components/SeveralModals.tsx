'use client'

import React, { useState, useEffect } from 'react'
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore'

type Props = {
  open: boolean
  onClose: () => void
  blockId: string | null
  pageId: string
  projectId: string
  onSave: () => void
}

const db = getFirestore()

export function GeneralTableModal({ open, onClose, blockId, pageId, projectId, onSave }: Props) {
  const [sourceBlockId, setSourceBlockId] = useState<string>('')
  const [useAiConfig, setUseAiConfig] = useState<boolean>(false)
  const [includeSummary, setIncludeSummary] = useState<boolean>(false)
  const [includeGithub, setIncludeGithub] = useState<boolean>(false)
  const [includeKarma, setIncludeKarma] = useState<boolean>(false)
  
  const [availableSourceBlocks, setAvailableSourceBlocks] = useState<Array<{ id: string; name: string }>>([])
  const [aiConfigBlockExists, setAiConfigBlockExists] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Find unique block slug (append number if needed)
  const findUniqueBlockSlug = async (baseSlug: string): Promise<string> => {
    const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
    const blocksSnap = await getDocs(blocksRef)
    
    const existingSlugs = new Set<string>()
    blocksSnap.forEach((doc) => {
      if (doc.id !== blockId) { // Exclude current block if editing
        existingSlugs.add(doc.id)
      }
    })

    let slug = baseSlug
    let counter = 1
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    return slug
  }

  // Load available blocks and existing config
  useEffect(() => {
    if (!open || !pageId || !projectId) return

    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Load all blocks in the folder
        const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
        const blocksSnap = await getDocs(blocksRef)
        
        const sourceBlocks: Array<{ id: string; name: string }> = []
        let foundAiConfig = false

        blocksSnap.forEach((doc) => {
          const data = doc.data()
          const blockId = doc.id
          const blockType = data['block-type']
          const gardensSubtype = data['gardens-subtype']

          // Check for query-subgraph blocks
          if (blockType === 'gardens-report' && gardensSubtype === 'query-subgraph') {
            sourceBlocks.push({
              id: blockId,
              name: blockId // Using block ID as name (will format later)
            })
          }

          // Check for fill-with-ai-config block
          if (blockType === 'gardens-report' && gardensSubtype === 'fill-with-ai-config') {
            foundAiConfig = true
          }
        })

        setAvailableSourceBlocks(sourceBlocks)
        setAiConfigBlockExists(foundAiConfig)

        // Load existing config if editing
        if (blockId) {
          const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockId)
          const blockSnap = await getDoc(blockRef)
          
          if (blockSnap.exists()) {
            const data = blockSnap.data()
            setSourceBlockId(data['source-block-id'] || '')
            setUseAiConfig(data['use-ai-config'] || false)
            setIncludeSummary(data['include-summary'] || false)
            setIncludeGithub(data['include-github'] || false)
            setIncludeKarma(data['include-karma'] || false)
          }
        }
      } catch (err) {
        console.error('Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [open, blockId, pageId, projectId])

  // Format block name for display
  const formatBlockName = (slug: string): string => {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const handleSubmit = async () => {
    if (!sourceBlockId) {
      setError('Please select a source block')
      return
    }

    if (useAiConfig && !aiConfigBlockExists) {
      setError('AI config block not found. Please create a "Fill with AI Config" block first.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // Generate block slug
      const baseSlug = 'general-table'
      const blockSlug = blockId ? blockId : await findUniqueBlockSlug(baseSlug)

      // Save block configuration
      const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug)

      const blockData: any = {
        pageId,
        'block-type': 'gardens-report',
        'gardens-subtype': 'general-table',
        'source-block-id': sourceBlockId,
        'use-ai-config': useAiConfig,
        'include-summary': includeSummary,
        'include-github': includeGithub,
        'include-karma': includeKarma,
        status: 'ready',
        updatedAt: serverTimestamp(),
      }

      // Only include createdAt for new blocks
      if (!blockId) {
        blockData.createdAt = serverTimestamp()
      }

      await setDoc(blockRef, blockData, { merge: true })

      onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Check if submit should be enabled
  const canSubmit = sourceBlockId && (!useAiConfig || aiConfigBlockExists)

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              {blockId ? 'Edit General Table' : 'Create General Table'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : (
            <>
              {/* Step 1: Source Info (Always visible) */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Source Info <span className="text-red-500">*</span>
                </label>
                <select
                  value={sourceBlockId}
                  onChange={(e) => {
                    setSourceBlockId(e.target.value)
                    setError(null) // Clear error when user selects
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                >
                  <option value="">Select source block...</option>
                  {availableSourceBlocks.map((block) => (
                    <option key={block.id} value={block.id} className="text-gray-900">
                      {formatBlockName(block.id)}
                    </option>
                  ))}
                </select>
                {availableSourceBlocks.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    No query-subgraph blocks found in this folder. Create one first.
                  </p>
                )}
              </div>

              {/* Step 2: Fill with AI (Only shown after source is selected) */}
              {sourceBlockId && (
                <div className="mb-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="useAiConfig"
                      checked={useAiConfig}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setUseAiConfig(checked)
                        // Reset optional columns if AI is disabled
                        if (!checked) {
                          setIncludeSummary(false)
                          setIncludeGithub(false)
                          setIncludeKarma(false)
                        }
                        if (checked && !aiConfigBlockExists) {
                          setError('AI config block not found. Please create a "Fill with AI Config" block first.')
                        } else {
                          setError(null)
                        }
                      }}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="useAiConfig" className="ml-2 block text-sm font-medium text-gray-700">
                      Fill with AI
                    </label>
                  </div>
                  {useAiConfig && !aiConfigBlockExists && (
                    <p className="mt-2 text-sm text-red-600">
                      AI config block not found. Please create a "Fill with AI Config" block first.
                    </p>
                  )}
                </div>
              )}

              {/* Step 3: Optional Extra Columns (Only shown if AI is enabled) */}
              {sourceBlockId && useAiConfig && aiConfigBlockExists && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Optional Extra Columns
                  </label>
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="includeSummary"
                        checked={includeSummary}
                        onChange={(e) => setIncludeSummary(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="includeSummary" className="ml-2 block text-sm text-gray-700">
                        Proposal Summary (AI)
                      </label>
                    </div>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="includeGithub"
                        checked={includeGithub}
                        onChange={(e) => setIncludeGithub(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="includeGithub" className="ml-2 block text-sm text-gray-700">
                        GitHub (AI)
                      </label>
                    </div>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="includeKarma"
                        checked={includeKarma}
                        onChange={(e) => setIncludeKarma(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="includeKarma" className="ml-2 block text-sm text-gray-700">
                        Karma Profile (AI)
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !canSubmit}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Final View Modal Component
type FinalViewModalProps = {
  open: boolean
  onClose: () => void
  blockId: string | null
  pageId: string
  projectId: string
  onSave: () => void
}

export function FinalViewModal({ open, onClose, blockId, pageId, projectId, onSave }: FinalViewModalProps) {
  const [sourceBlockId, setSourceBlockId] = useState<string>('')
  const [availableSourceBlocks, setAvailableSourceBlocks] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Find unique block slug (append number if needed)
  const findUniqueBlockSlug = async (baseSlug: string): Promise<string> => {
    const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
    const blocksSnap = await getDocs(blocksRef)
    
    const existingSlugs = new Set<string>()
    blocksSnap.forEach((doc) => {
      if (doc.id !== blockId) {
        existingSlugs.add(doc.id)
      }
    })

    let slug = baseSlug
    let counter = 1
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    return slug
  }

  // Load available blocks and existing config
  useEffect(() => {
    if (!open || !pageId || !projectId) return

    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Load all blocks in the folder
        const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
        const blocksSnap = await getDocs(blocksRef)
        
        const sourceBlocks: Array<{ id: string; name: string }> = []

        blocksSnap.forEach((doc) => {
          const blockId = doc.id
          const blockType = doc.data()['block-type']
          const gardensSubtype = doc.data()['gardens-subtype']

          // Check for general-table blocks (prefix match)
          if (blockType === 'gardens-report' && gardensSubtype === 'general-table') {
            sourceBlocks.push({
              id: blockId,
              name: blockId
            })
          }
        })

        setAvailableSourceBlocks(sourceBlocks)

        // Load existing config if editing
        if (blockId) {
          const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockId)
          const blockSnap = await getDoc(blockRef)
          
          if (blockSnap.exists()) {
            const data = blockSnap.data()
            setSourceBlockId(data['source-block-id'] || '')
          }
        }
      } catch (err) {
        console.error('Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [open, blockId, pageId, projectId])

  // Format block name for display
  const formatBlockName = (slug: string): string => {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const handleSubmit = async () => {
    if (!sourceBlockId) {
      setError('Please select a source block')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // Generate block slug
      const baseSlug = 'final-view'
      const blockSlug = blockId ? blockId : await findUniqueBlockSlug(baseSlug)

      // Save block configuration
      const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug)

      const blockData: any = {
        pageId,
        'block-type': 'gardens-report',
        'gardens-subtype': 'final-view',
        'source-block-id': sourceBlockId,
        status: 'ready',
        updatedAt: serverTimestamp(),
      }

      // Only include createdAt for new blocks
      if (!blockId) {
        blockData.createdAt = serverTimestamp()
      }

      await setDoc(blockRef, blockData, { merge: true })

      onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              {blockId ? 'Edit Final View' : 'Create Final View'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Source Block <span className="text-red-500">*</span>
                </label>
                <select
                  value={sourceBlockId}
                  onChange={(e) => {
                    setSourceBlockId(e.target.value)
                    setError(null)
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                >
                  <option value="">Select source block...</option>
                  {availableSourceBlocks.map((block) => (
                    <option key={block.id} value={block.id} className="text-gray-900">
                      {formatBlockName(block.id)}
                    </option>
                  ))}
                </select>
                {availableSourceBlocks.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    No general-table blocks found in this folder. Create one first.
                  </p>
                )}
              </div>

              {/* Error Display */}
              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !sourceBlockId}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Karma General Table Modal Component
type KarmaGeneralTableModalProps = {
  open: boolean
  onClose: () => void
  blockId: string | null
  pageId: string
  projectId: string
  onSave: () => void
}

export function KarmaGeneralTableModal({ open, onClose, blockId, pageId, projectId, onSave }: KarmaGeneralTableModalProps) {
  const [sourceBlockId, setSourceBlockId] = useState<string>('')
  const [availableSourceBlocks, setAvailableSourceBlocks] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Find unique block slug (append number if needed)
  const findUniqueBlockSlug = async (baseSlug: string): Promise<string> => {
    const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
    const blocksSnap = await getDocs(blocksRef)
    
    const existingSlugs = new Set<string>()
    blocksSnap.forEach((doc) => {
      if (doc.id !== blockId) {
        existingSlugs.add(doc.id)
      }
    })

    let slug = baseSlug
    let counter = 1
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    return slug
  }

  // Load available blocks and existing config
  useEffect(() => {
    if (!open || !pageId || !projectId) return

    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Load all blocks in the folder
        const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
        const blocksSnap = await getDocs(blocksRef)
        
        const sourceBlocks: Array<{ id: string; name: string }> = []

        blocksSnap.forEach((doc) => {
          const data = doc.data()
          const blockId = doc.id
          const blockType = data['block-type']
          const karmaSubtype = data['karma-subtype']

          // Check for karma-query blocks
          if (blockType === 'karma-report' && karmaSubtype === 'karma-query') {
            sourceBlocks.push({
              id: blockId,
              name: blockId
            })
          }
        })

        setAvailableSourceBlocks(sourceBlocks)

        // Load existing config if editing
        if (blockId) {
          const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockId)
          const blockSnap = await getDoc(blockRef)
          
          if (blockSnap.exists()) {
            const data = blockSnap.data()
            setSourceBlockId(data['source-block-id'] || '')
          }
        }
      } catch (err) {
        console.error('Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [open, blockId, pageId, projectId])

  // Format block name for display
  const formatBlockName = (slug: string): string => {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const handleSubmit = async () => {
    if (!sourceBlockId) {
      setError('Please select a source block')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // Generate block slug
      const baseSlug = 'karma-general-table'
      const blockSlug = blockId ? blockId : await findUniqueBlockSlug(baseSlug)

      // Save block configuration
      const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug)

      const blockData: any = {
        pageId,
        'block-type': 'karma-report',
        'karma-subtype': 'karma-general-table',
        'source-block-id': sourceBlockId,
        status: 'ready',
        updatedAt: serverTimestamp(),
      }

      // Only include createdAt for new blocks
      if (!blockId) {
        blockData.createdAt = serverTimestamp()
      }

      await setDoc(blockRef, blockData, { merge: true })

      onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              {blockId ? 'Edit Karma General Table' : 'Create Karma General Table'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Source Block <span className="text-red-500">*</span>
                </label>
                <select
                  value={sourceBlockId}
                  onChange={(e) => {
                    setSourceBlockId(e.target.value)
                    setError(null)
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                >
                  <option value="">Select source block...</option>
                  {availableSourceBlocks.map((block) => (
                    <option key={block.id} value={block.id} className="text-gray-900">
                      {formatBlockName(block.id)}
                    </option>
                  ))}
                </select>
                {availableSourceBlocks.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    No karma-query blocks found in this folder. Create one first.
                  </p>
                )}
              </div>

              {/* Error Display */}
              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !sourceBlockId}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Karma Serpentine Modal Component
type KarmaSerpentineModalProps = {
  open: boolean
  onClose: () => void
  blockId: string | null
  pageId: string
  projectId: string
  onSave: () => void
}

export function KarmaSerpentineModal({ open, onClose, blockId, pageId, projectId, onSave }: KarmaSerpentineModalProps) {
  const [sourceBlockId, setSourceBlockId] = useState<string>('')
  const [availableSourceBlocks, setAvailableSourceBlocks] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Find unique block slug (append number if needed)
  const findUniqueBlockSlug = async (baseSlug: string): Promise<string> => {
    const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
    const blocksSnap = await getDocs(blocksRef)
    
    const existingSlugs = new Set<string>()
    blocksSnap.forEach((docSnap) => {
      if (docSnap.id !== blockId) {
        existingSlugs.add(docSnap.id)
      }
    })

    let slug = baseSlug
    let counter = 1
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    return slug
  }

  // Load available blocks and existing config
  useEffect(() => {
    if (!open || !pageId || !projectId) return

    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Load all blocks in the folder
        const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
        const blocksSnap = await getDocs(blocksRef)
        
        const sourceBlocks: Array<{ id: string; name: string }> = []

        blocksSnap.forEach((docSnap) => {
          const data = docSnap.data()
          const docBlockId = docSnap.id
          const blockType = data['block-type']
          const karmaSubtype = data['karma-subtype']

          // Check for karma-general-table blocks (this is the source for serpentine)
          if (blockType === 'karma-report' && karmaSubtype === 'karma-general-table') {
            sourceBlocks.push({
              id: docBlockId,
              name: docBlockId
            })
          }
        })

        setAvailableSourceBlocks(sourceBlocks)

        // Load existing config if editing
        if (blockId) {
          const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockId)
          const blockSnap = await getDoc(blockRef)
          
          if (blockSnap.exists()) {
            const data = blockSnap.data()
            setSourceBlockId(data['source-block-id'] || '')
          }
        }
      } catch (err) {
        console.error('Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [open, blockId, pageId, projectId])

  // Format block name for display
  const formatBlockName = (slug: string): string => {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const handleSubmit = async () => {
    if (!sourceBlockId) {
      setError('Please select a source block')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // Generate block slug
      const baseSlug = 'karma-serpentine'
      const blockSlug = blockId ? blockId : await findUniqueBlockSlug(baseSlug)

      // Save block configuration
      const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug)

      const blockData: any = {
        pageId,
        'block-type': 'karma-report',
        'karma-subtype': 'karma-serpentine',
        'source-block-id': sourceBlockId,
        'months-to-show': 30, // Default
        status: 'ready',
        updatedAt: serverTimestamp(),
      }

      // Only include createdAt for new blocks
      if (!blockId) {
        blockData.createdAt = serverTimestamp()
      }

      await setDoc(blockRef, blockData, { merge: true })

      onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              {blockId ? 'Edit Karma Serpentine' : 'Create Karma Serpentine'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Source Block (Karma General Table) <span className="text-red-500">*</span>
                </label>
                <select
                  value={sourceBlockId}
                  onChange={(e) => {
                    setSourceBlockId(e.target.value)
                    setError(null)
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                >
                  <option value="">Select source block...</option>
                  {availableSourceBlocks.map((block) => (
                    <option key={block.id} value={block.id} className="text-gray-900">
                      {formatBlockName(block.id)}
                    </option>
                  ))}
                </select>
                {availableSourceBlocks.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    No karma-general-table blocks found in this folder. Create one first.
                  </p>
                )}
              </div>

              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> The serpentine will filter rows that have:
                </p>
                <ul className="text-sm text-blue-700 list-disc list-inside mt-2">
                  <li>A "Single Date" (officialDate)</li>
                  <li>A "Summary"</li>
                  <li>Status containing "completed" or "manually approved"</li>
                </ul>
              </div>

              {/* Error Display */}
              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !sourceBlockId}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Creating...' : 'Create Block'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

