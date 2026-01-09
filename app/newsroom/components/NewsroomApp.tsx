'use client'

import React, { useEffect, useState, useRef } from 'react'
import ConnectWalletButton from '../../interoperable-canvas/components/ConnectWalletButton'
import { initializeApp, getApps } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, where, getDocs, orderBy, serverTimestamp } from 'firebase/firestore'
import { BackgroundGradientModal } from './BackgroundGradientModal'
import { ZigzagGradient } from './ZigzagGradient'
import { ProjectStructureModal } from './ProjectStructureModal'
import { BlockModal } from './BlockModal'
import { FillWithAiConfigBlock } from './gardens-block/FillWithAiConfigBlock'
import { GeneralTableBlock } from './gardens-block/GeneralTableBlock'
import { GeneralTableModal, FinalViewModal, KarmaGeneralTableModal, KarmaSerpentineModal } from './SeveralModals'
import { QuerySubgraphBlock } from './gardens-block/QuerySubgraphBlock'
import { FinalViewBlock } from './gardens-block/FinalViewBlock'
import { QueryKarmaBlock } from './karma-block/queryKarma'
import { KarmaGeneralTableBlock } from './karma-block/karmaGeneralTable'
import { KarmaSerpentineBlock } from './karma-block/karmaSerpentine'

type Props = { projectId: string }

type Background = {
  mode: 'none' | 'solid' | 'linear' | 'radial' | 'zigzag'
  from: string
  to: string
}

// Basic client-side Firebase init using env vars already used elsewhere in app
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig as any)
const db = getFirestore(app)

export function NewsroomApp({ projectId }: Props) {
  // In open-source version, all authenticated users can view (no authorization check)
  const [isAuthorized] = useState<boolean>(true)
  const [background, setBackground] = useState<Background>({ mode: 'solid', from: '#ffffff', to: '#ffffff' })
  const [showBackgroundModal, setShowBackgroundModal] = useState(false)
  const [showProjectStructureModal, setShowProjectStructureModal] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<any[]>([])
  const [loadingBlocks, setLoadingBlocks] = useState(false)
  const [blockQueryResults, setBlockQueryResults] = useState<Record<string, any>>({})
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [showGeneralTableModal, setShowGeneralTableModal] = useState(false)
  const [showFinalViewModal, setShowFinalViewModal] = useState(false)
  const [showKarmaGeneralTableModal, setShowKarmaGeneralTableModal] = useState(false)
  const [showKarmaSerpentineModal, setShowKarmaSerpentineModal] = useState(false)
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [refreshingBlockId, setRefreshingBlockId] = useState<string | null>(null)
  const isSyncingFromFirestoreRef = useRef(false)

  // Determine if user can view content (authorized)
  const canView = isAuthorized === true

  // Load project name from Firestore
  useEffect(() => {
    if (!projectId || !canView) return
    
    const projectRef = doc(db, 'newsroom', projectId)
    const unsub = onSnapshot(
      projectRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data()
          setProjectName(data.name || projectId)
        } else {
          setProjectName(projectId)
        }
      },
      (error) => {
        // Ignore ERR_BLOCKED_BY_CLIENT errors (browser extension blocking)
        if (error?.code !== 'unavailable' && !error?.message?.includes('blocked')) {
          console.error('Error loading project name:', error)
        }
      }
    )
    
    return () => unsub()
  }, [projectId, canView])

  // Sync background with Firestore
  // Storage path: newsroom/{projectId}/metadata/settings (NOT interoperable-canvas)
  useEffect(() => {
    if (!projectId || !canView) return
    const metadataRef = doc(db, 'newsroom', projectId, 'metadata', 'settings')
    
    const unsub = onSnapshot(
      metadataRef,
      (snap) => {
        isSyncingFromFirestoreRef.current = true
        const data = snap.data() as any
        if (data?.background && typeof data.background === 'object') {
          setBackground({
            mode: (data.background.mode ?? 'solid'),
            from: data.background.from ?? '#ffffff',
            to: data.background.to ?? '#ffffff',
          })
        }
        setTimeout(() => {
          isSyncingFromFirestoreRef.current = false
        }, 100)
      },
      (error) => {
        // Ignore ERR_BLOCKED_BY_CLIENT errors (browser extension blocking)
        if (error?.code !== 'unavailable' && !error?.message?.includes('blocked')) {
          console.error('Error loading background settings:', error)
        }
      }
    )
    
    return () => unsub()
  }, [projectId, canView])

  // Persist background changes to Firestore
  // Storage path: newsroom/{projectId}/metadata/settings (NOT interoperable-canvas)
  const persistBackground = async (next: Background) => {
    if (!isAuthorized || isSyncingFromFirestoreRef.current) return
    setBackground(next)
    if (!projectId) return
    // Store in newsroom collection, not interoperable-canvas
    const metadataRef = doc(db, 'newsroom', projectId, 'metadata', 'settings')
    await setDoc(metadataRef, { background: next }, { merge: true })
  }

  // Load blocks for current folder
  useEffect(() => {
    if (!projectId || !canView || !selectedFolderId) {
      setBlocks([])
      setBlockQueryResults({})
      return
    }

    setLoadingBlocks(true)
    const blocksRef = collection(db, 'newsroom', projectId, 'folders', selectedFolderId, 'blocks')
    const blocksQuery = query(blocksRef, orderBy('createdAt', 'asc'))

    const unsubscribe = onSnapshot(
      blocksQuery,
      async (snapshot) => {
        const blocksData: any[] = []
        snapshot.forEach((doc) => {
          blocksData.push({
            id: doc.id,
            ...doc.data(),
          })
        })

        // Sort by rank if available, otherwise by createdAt
        blocksData.sort((a, b) => {
          if (a.rank && b.rank) {
            return a.rank.localeCompare(b.rank)
          }
          const aTime = a.createdAt?.seconds || a.createdAt || 0
          const bTime = b.createdAt?.seconds || b.createdAt || 0
          return aTime - bTime
        })

        setBlocks(blocksData)
        setLoadingBlocks(false)

        // Load query results for each block
        const results: Record<string, any> = {}
        for (const block of blocksData) {
          if ((block['block-type'] === 'gardens-report' && block['gardens-subtype'] === 'query-subgraph') ||
              (block['block-type'] === 'karma-report' && block['karma-subtype'] === 'karma-query')) {
            try {
              const queryResultsRef = collection(db, 'newsroom', projectId, 'folders', selectedFolderId, 'blocks', block.id, 'query-results')
              const queryResultsSnap = await getDocs(queryResultsRef)
              if (!queryResultsSnap.empty) {
                const latestResult = queryResultsSnap.docs[queryResultsSnap.docs.length - 1]
                results[block.id] = {
                  ...latestResult.data(),
                  id: latestResult.id,
                }
              }
            } catch (err) {
              console.error(`Error loading query results for block ${block.id}:`, err)
            }
          }
        }
        setBlockQueryResults(results)
      },
      (error) => {
        // Ignore ERR_BLOCKED_BY_CLIENT errors (browser extension blocking)
        if (error?.code !== 'unavailable' && !error?.message?.includes('blocked')) {
          console.error('Error loading blocks:', error)
        }
        setLoadingBlocks(false)
      }
    )

    return () => unsubscribe()
  }, [selectedFolderId, projectId, canView])

  // Handle block click
  const handleBlockClick = (blockId: string | null) => {
    setEditingBlockId(blockId)
    setShowBlockModal(true)
  }

  // Handle block save
  const handleBlockSave = () => {
    // Blocks will reload automatically via snapshot listener
    setEditingBlockId(null)
  }

  // Handle refresh query for Gardens subgraph
  const handleRefreshQuery = async (block: any) => {
    if (!block['parsed-url'] || !block['query-url']) return

    setRefreshingBlockId(block.id)
    try {
      const apiKey = process.env.NEXT_PUBLIC_SUBGRAPH_KEY || ''
      if (!apiKey) {
        alert('API key not found')
        return
      }

      const test4Query = `{ cvproposals(where: { strategy_: { poolId: "${block.parsed_url.poolId}" }, proposalStatus: 4 }) { id proposalNumber proposalStatus requestedAmount createdAt metadataHash metadata { title description } strategy { id poolId token } } }`
      
      const response = await fetch(block['query-url'], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: test4Query
        })
      })

      const result = await response.json()
      const success = response.ok && !result.errors && !result.message

      if (!success) {
        alert('Failed to refresh query')
        return
      }

      // Save new query result
      const queryResultRef = doc(collection(db, 'newsroom', projectId, 'folders', selectedFolderId!, 'blocks', block.id, 'query-results'))
      const queryResultData: any = {
        success: success,
        data: result,
        query: test4Query,
        queriedAt: serverTimestamp(),
      }
      // Only include error if it exists (Firestore doesn't allow undefined)
      if (result.errors) {
        queryResultData.error = JSON.stringify(result.errors, null, 2)
      }
      await setDoc(queryResultRef, queryResultData)

      // Reload query results
      const queryResultsRef = collection(db, 'newsroom', projectId, 'folders', selectedFolderId!, 'blocks', block.id, 'query-results')
      const queryResultsSnap = await getDocs(queryResultsRef)
      if (!queryResultsSnap.empty) {
        const latestResult = queryResultsSnap.docs[queryResultsSnap.docs.length - 1]
        setBlockQueryResults(prev => ({
          ...prev,
          [block.id]: {
            ...latestResult.data(),
            id: latestResult.id,
          }
        }))
      }
    } catch (err) {
      console.error('Error refreshing query:', err)
      alert('Failed to refresh query')
    } finally {
      setRefreshingBlockId(null)
    }
  }

  // Handle refresh query for Karma API
  const handleRefreshKarmaQuery = async (block: any) => {
    const slugs = block['karma-project-slugs'] || []
    if (slugs.length === 0) return

    setRefreshingBlockId(block.id)
    try {
      // Query all slugs and group results by slug
      const groupedData: Record<string, any> = {}
      let allSuccess = true
      const errors: string[] = []

      for (const slug of slugs) {
        try {
          const apiUrl = `https://gapapi.karmahq.xyz/v2/projects/${slug}/updates`
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            }
          })

          const result = await response.json()
          const success = response.ok && !result.error

          if (success) {
            groupedData[slug] = result
          } else {
            allSuccess = false
            const errorMsg = result.error ? JSON.stringify(result.error, null, 2) : `HTTP ${response.status}: ${response.statusText}`
            errors.push(`${slug}: ${errorMsg}`)
            // Still store empty array for failed slugs so we know they were attempted
            groupedData[slug] = []
          }
        } catch (err) {
          allSuccess = false
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`${slug}: ${errorMsg}`)
          groupedData[slug] = []
        }
      }

      // Save new query result
      const queryResultRef = doc(collection(db, 'newsroom', projectId, 'folders', selectedFolderId!, 'blocks', block.id, 'query-results'))
      const queryResultData: any = {
        success: allSuccess,
        data: groupedData,
        queriedAt: serverTimestamp(),
      }
      // Only include error if it exists (Firestore doesn't allow undefined)
      if (errors.length > 0) {
        queryResultData.error = errors.join('\n')
      }
      await setDoc(queryResultRef, queryResultData)

      // Reload query results
      const queryResultsRef = collection(db, 'newsroom', projectId, 'folders', selectedFolderId!, 'blocks', block.id, 'query-results')
      const queryResultsSnap = await getDocs(queryResultsRef)
      if (!queryResultsSnap.empty) {
        const latestResult = queryResultsSnap.docs[queryResultsSnap.docs.length - 1]
        setBlockQueryResults(prev => ({
          ...prev,
          [block.id]: {
            ...latestResult.data(),
            id: latestResult.id,
          }
        }))
      }
    } catch (err) {
      console.error('Error refreshing Karma query:', err)
      alert('Failed to refresh Karma query')
    } finally {
      setRefreshingBlockId(null)
    }
  }

  const handleFolderClick = (folderId: string, folderName: string) => {
    setSelectedFolderId(folderId)
    setSelectedFolderName(folderName)
    setShowProjectStructureModal(false)
  }

  // Calculate background style
  const bgStyle = background.mode === 'linear'
    ? `linear-gradient(135deg, ${background.from}, ${background.to})`
    : background.mode === 'radial'
    ? `radial-gradient(circle, ${background.from}, ${background.to})`
    : background.mode === 'solid'
    ? background.from
    : background.mode === 'zigzag'
    ? 'zigzag' // Special marker for zigzag mode
    : 'transparent'

  return (
    <div className="min-h-screen flex bg-gray-800">
      {/* Left Panel - Reduced to 75% of original (w-36 = 144px) */}
      <div className="fixed left-0 top-0 h-screen w-36 p-4 bg-gray-900 flex flex-col gap-3 overflow-y-auto">
        <ConnectWalletButton />
        
        {/* Project Structure Button */}
        {canView && (
          <button
            className="w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            onClick={() => setShowProjectStructureModal(true)}
            disabled={!canView}
            title="View project folder structure"
          >
            Project Structure
          </button>
        )}

        {/* Background Button */}
        {canView && (
          <button
            className="w-full px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => setShowBackgroundModal(true)}
            disabled={!canView}
          >
            Background
          </button>
        )}
      </div>

      {/* Right Panel - Rest of space (flex-1 ml-36) */}
      <div className="flex-1 ml-36 overflow-hidden">
        {canView ? (
          <div className="min-h-screen flex flex-col">
            {/* Content container with margins (left, top, right) */}
            <div 
              className="flex-1 relative mx-[20px] mt-[20px] pb-[20px]"
              style={{ 
                background: bgStyle === 'zigzag' ? 'transparent' : bgStyle,
                minHeight: 'calc(100vh - 20px)',
                position: 'relative'
              }}
            >
              {/* Zigzag gradient overlay */}
              {background.mode === 'zigzag' && background.from && background.to && (
                <ZigzagGradient from={background.from} to={background.to} />
              )}
              
              {/* Content area */}
              <div className="p-6 relative z-10">
                {/* Page header */}
                {selectedFolderId && (
                    <div className="mb-6 pb-4 border-b border-gray-700">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setSelectedFolderId(null)
                            setSelectedFolderName(null)
                          }}
                          className="text-gray-400 hover:text-gray-200 transition-colors"
                          title="Back to root"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                          </svg>
                        </button>
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <h2 className="text-2xl font-semibold text-gray-200">
                          {projectName || projectId}/{selectedFolderId}
                        </h2>
                      </div>
                    </div>
                )}

                {/* Blocks */}
                {loadingBlocks ? (
                  <div className="text-gray-400 text-center py-8">Loading blocks...</div>
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    {blocks.map((block) => {
                      const queryResult = blockQueryResults[block.id]
                      const isGardensQuery = block['block-type'] === 'gardens-report' && block['gardens-subtype'] === 'query-subgraph'
                      const isKarmaQuery = block['block-type'] === 'karma-report' && block['karma-subtype'] === 'karma-query'
                      const isKarmaGeneralTable = block['block-type'] === 'karma-report' && block['karma-subtype'] === 'karma-general-table'
                      const isKarmaSerpentine = block['block-type'] === 'karma-report' && block['karma-subtype'] === 'karma-serpentine'
                      const isFillWithAiConfig = block['block-type'] === 'gardens-report' && block['gardens-subtype'] === 'fill-with-ai-config'
                      const isGeneralTable = block['block-type'] === 'gardens-report' && block['gardens-subtype'] === 'general-table'
                      const isFinalView = block['block-type'] === 'gardens-report' && block['gardens-subtype'] === 'final-view'
                      
                      // Format block name: replace hyphens with spaces and capitalize words
                      const formatBlockName = (slug: string): string => {
                        return slug
                          .split('-')
                          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                          .join(' ')
                      }

                      // Determine which modal to open based on block type
                      const handleHeaderClick = () => {
                        if (isGeneralTable) {
                          setEditingBlockId(block.id)
                          setShowGeneralTableModal(true)
                        } else if (isFinalView) {
                          setEditingBlockId(block.id)
                          setShowFinalViewModal(true)
                        } else if (isKarmaGeneralTable) {
                          setEditingBlockId(block.id)
                          setShowKarmaGeneralTableModal(true)
                        } else if (isKarmaSerpentine) {
                          setEditingBlockId(block.id)
                          setShowKarmaSerpentineModal(true)
                        } else if (isFillWithAiConfig) {
                          // Fill with AI config doesn't have a modal - it's inline
                          return
                        } else {
                          handleBlockClick(block.id)
                        }
                      }
                      
                      return (
                        <div
                          key={block.id}
                          className="bg-white border border-gray-300 rounded"
                          style={{
                            width: '100%',
                            maxWidth: '1100px',
                            minHeight: (isGardensQuery || isKarmaQuery || isKarmaGeneralTable || isKarmaSerpentine || isFillWithAiConfig || isGeneralTable || isFinalView) ? '300px' : '300px',
                            maxHeight: (isGardensQuery || isKarmaQuery || isFillWithAiConfig) ? '300px' : (isGeneralTable ? '500px' : (isKarmaGeneralTable || isFinalView ? 'none' : (isKarmaSerpentine ? '1100px' : 'none'))),
                            overflowY: (isGardensQuery || isKarmaQuery || isKarmaGeneralTable || isKarmaSerpentine || isFillWithAiConfig || isGeneralTable || isFinalView) ? 'hidden' : 'visible',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          {/* Block Header - Clickable */}
                          <h2 
                            className={`text-gray-500 text-lg font-medium px-4 pt-4 pb-2 border-b border-gray-200 ${
                              (isGeneralTable || isFinalView || isKarmaGeneralTable || isKarmaSerpentine || (!isFillWithAiConfig && (block['block-type'] === 'gardens-report' || block['block-type'] === 'karma-report'))) ? 'cursor-pointer hover:text-gray-700' : ''
                            }`}
                            onClick={handleHeaderClick}
                          >
                            {formatBlockName(block.id)}
                          </h2>
                          
                          {isFillWithAiConfig ? (
                            <FillWithAiConfigBlock
                              blockId={block.id}
                              projectId={projectId}
                              folderId={selectedFolderId || 'root'}
                            />
                          ) : isGeneralTable ? (
                            <GeneralTableBlock
                              blockId={block.id}
                              projectId={projectId}
                              folderId={selectedFolderId || 'root'}
                              onEditClick={() => {
                                setEditingBlockId(block.id)
                                setShowGeneralTableModal(true)
                              }}
                            />
                          ) : isFinalView ? (
                            <FinalViewBlock
                              blockId={block.id}
                              projectId={projectId}
                              folderId={selectedFolderId || 'root'}
                              onEditClick={() => {
                                setEditingBlockId(block.id)
                                setShowFinalViewModal(true)
                              }}
                            />
                          ) : isGardensQuery ? (
                            <QuerySubgraphBlock
                              block={block}
                              queryResult={queryResult}
                              refreshingBlockId={refreshingBlockId}
                              onRefresh={handleRefreshQuery}
                              onEditClick={handleBlockClick}
                              projectId={projectId}
                              folderId={selectedFolderId || 'root'}
                            />
                          ) : isKarmaQuery ? (
                            <QueryKarmaBlock
                              block={block}
                              queryResult={queryResult}
                              refreshingBlockId={refreshingBlockId}
                              onRefresh={handleRefreshKarmaQuery}
                              onEditClick={handleBlockClick}
                              projectId={projectId}
                              folderId={selectedFolderId || 'root'}
                            />
                          ) : isKarmaGeneralTable ? (
                            <KarmaGeneralTableBlock
                              blockId={block.id}
                              projectId={projectId}
                              folderId={selectedFolderId || 'root'}
                              onEditClick={() => {
                                setEditingBlockId(block.id)
                                setShowKarmaGeneralTableModal(true)
                              }}
                            />
                          ) : isKarmaSerpentine ? (
                            <KarmaSerpentineBlock
                              blockId={block.id}
                              projectId={projectId}
                              folderId={selectedFolderId || 'root'}
                              onEditClick={() => {
                                setEditingBlockId(block.id)
                                setShowKarmaSerpentineModal(true)
                              }}
                            />
                          ) : (
                            <div>
                              {/* Block Header */}
                              <h2 className="text-gray-500 text-lg font-medium px-4 pt-4 pb-2 border-b border-gray-200">
                                {formatBlockName(block.id)}
                              </h2>
                              <div 
                                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                                onClick={() => handleBlockClick(block.id)}
                              >
                                <div className="text-sm text-gray-500 mb-2">{block.title || `Block ${block.id.slice(0, 8)}`}</div>
                                <div className="text-gray-700 hover:text-gray-900">
                                  {block.content || <span className="italic">Start editing this block...</span>}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {blocks.length === 0 && selectedFolderId && (
                      <div className="text-gray-400 text-center py-8">
                        <p className="mb-2">No blocks yet</p>
                        <p className="text-sm">Click to create your first block</p>
                      </div>
                    )}
                    {/* Add Block Button - Only show when inside a folder */}
                    {selectedFolderId && (
                      <button
                        onClick={() => handleBlockClick(null)}
                        className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                      >
                        + Add Block
                      </button>
                    )}
                  </div>
                )}

              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <p className="text-gray-400 mb-4">Please connect your wallet to access the newsroom</p>
            </div>
          </div>
        )}
      </div>

      {/* Background Modal */}
      {canView && (
        <BackgroundGradientModal
          open={showBackgroundModal}
          mode={background.mode}
          from={background.from}
          to={background.to}
          onClose={() => setShowBackgroundModal(false)}
          onSave={(b) => { persistBackground(b); setShowBackgroundModal(false) }}
        />
      )}

      {/* Project Structure Modal */}
      {canView && (
        <ProjectStructureModal
          open={showProjectStructureModal}
          onClose={() => setShowProjectStructureModal(false)}
          projectId={projectId}
          onFolderClick={handleFolderClick}
        />
      )}

      {/* Block Modal */}
      {canView && selectedFolderId && (
        <BlockModal
          open={showBlockModal}
          onClose={() => {
            setShowBlockModal(false)
            setEditingBlockId(null)
          }}
          blockId={editingBlockId}
          pageId={selectedFolderId}
          projectId={projectId}
          onSave={handleBlockSave}
          onGeneralTableCreated={(blockId) => {
            setEditingBlockId(blockId)
            setShowGeneralTableModal(true)
          }}
          onFinalViewCreated={(blockId) => {
            setEditingBlockId(blockId)
            setShowFinalViewModal(true)
          }}
          onKarmaGeneralTableCreated={(blockId) => {
            setEditingBlockId(blockId)
            setShowKarmaGeneralTableModal(true)
          }}
          onKarmaSerpentineCreated={(blockId) => {
            setEditingBlockId(blockId)
            setShowKarmaSerpentineModal(true)
          }}
        />
      )}

      {/* General Table Modal */}
      {canView && selectedFolderId && (
        <GeneralTableModal
          open={showGeneralTableModal}
          onClose={() => {
            setShowGeneralTableModal(false)
            setEditingBlockId(null)
          }}
          blockId={editingBlockId}
          pageId={selectedFolderId}
          projectId={projectId}
          onSave={handleBlockSave}
        />
      )}

      {/* Final View Modal */}
      {canView && selectedFolderId && (
        <FinalViewModal
          open={showFinalViewModal}
          onClose={() => {
            setShowFinalViewModal(false)
            setEditingBlockId(null)
          }}
          blockId={editingBlockId}
          pageId={selectedFolderId}
          projectId={projectId}
          onSave={handleBlockSave}
        />
      )}

      {/* Karma General Table Modal */}
      {canView && selectedFolderId && (
        <KarmaGeneralTableModal
          open={showKarmaGeneralTableModal}
          onClose={() => {
            setShowKarmaGeneralTableModal(false)
            setEditingBlockId(null)
          }}
          blockId={editingBlockId}
          pageId={selectedFolderId}
          projectId={projectId}
          onSave={handleBlockSave}
        />
      )}

      {/* Karma Serpentine Modal */}
      {canView && selectedFolderId && (
        <KarmaSerpentineModal
          open={showKarmaSerpentineModal}
          onClose={() => {
            setShowKarmaSerpentineModal(false)
            setEditingBlockId(null)
          }}
          blockId={editingBlockId}
          pageId={selectedFolderId}
          projectId={projectId}
          onSave={handleBlockSave}
        />
      )}
    </div>
  )
}

