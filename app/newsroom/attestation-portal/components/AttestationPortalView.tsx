'use client'

import React, { useState, useEffect } from 'react'
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { initializeApp, getApps } from 'firebase/app'
import { IntegrityHeader } from './IntegrityHeader'
import { AttestationKarmaSerpentineBlock } from './blocks/AttestationKarmaSerpentineBlock'
import { AttestationKarmaGeneralTableBlock } from './blocks/AttestationKarmaGeneralTableBlock'
import { AttestationQueryKarmaBlock } from './blocks/AttestationQueryKarmaBlock'

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

type Props = {
  projectId: string
  folderId: string
  snapshotId: string
}

export function AttestationPortalView({ projectId, folderId, snapshotId }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snapshotManifest, setSnapshotManifest] = useState<any>(null)
  const [blocks, setBlocks] = useState<any[]>([])
  const [blockQueryResults, setBlockQueryResults] = useState<Record<string, any>>({})

  // Load snapshot manifest and blocks
  useEffect(() => {
    const loadSnapshot = async () => {
      setLoading(true)
      setError(null)

      try {
        // Load snapshot manifest
        const manifestPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}`
        const manifestRef = doc(db, manifestPath)
        const manifestSnap = await getDoc(manifestRef)

        if (!manifestSnap.exists()) {
          setError(`Snapshot ${snapshotId} not found`)
          setLoading(false)
          return
        }

        const manifestData = manifestSnap.data()
        setSnapshotManifest(manifestData)

        // Load blocks from snapshot
        const blocksPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks`
        const blocksRef = collection(db, blocksPath)
        const blocksSnap = await getDocs(blocksRef)

        const blocksList: any[] = []
        blocksSnap.forEach((doc) => {
          blocksList.push({
            id: doc.id,
            ...doc.data(),
          })
        })

        // Sort blocks: serpentine first, then general table, then karma query
        blocksList.sort((a, b) => {
          const order = ['karma-serpentine', 'karma-general-table', 'karma-query']
          const aType = a['karma-subtype'] || a['block-type'] || ''
          const bType = b['karma-subtype'] || b['block-type'] || ''
          const aIndex = order.indexOf(aType)
          const bIndex = order.indexOf(bType)
          if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
          if (aIndex !== -1) return -1
          if (bIndex !== -1) return 1
          return 0
        })

        setBlocks(blocksList)

        // Load query results for karma-query block
        const queryResults: Record<string, any> = {}
        for (const block of blocksList) {
          if (block['block-type'] === 'karma-report' && block['karma-subtype'] === 'karma-query') {
            try {
              const queryResultsRef = collection(
                db,
                blocksPath,
                block.id,
                'query-results'
              )
              const queryResultsSnap = await getDocs(queryResultsRef)
              if (!queryResultsSnap.empty) {
                const latestResult = queryResultsSnap.docs[queryResultsSnap.docs.length - 1]
                queryResults[block.id] = {
                  ...latestResult.data(),
                  id: latestResult.id,
                }
              }
            } catch (err) {
              console.error(`Error loading query results for block ${block.id}:`, err)
            }
          }
        }
        setBlockQueryResults(queryResults)
      } catch (err) {
        console.error('Error loading snapshot:', err)
        setError(err instanceof Error ? err.message : 'Failed to load snapshot')
      } finally {
        setLoading(false)
      }
    }

    loadSnapshot()
  }, [projectId, folderId, snapshotId])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading snapshot...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!snapshotManifest) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
        <div className="text-center">
          <p className="text-gray-600">Snapshot manifest not found</p>
        </div>
      </div>
    )
  }

  // Find blocks by type
  const serpentineBlock = blocks.find(
    (b) => b['block-type'] === 'karma-report' && b['karma-subtype'] === 'karma-serpentine'
  )
  const generalTableBlock = blocks.find(
    (b) => b['block-type'] === 'karma-report' && b['karma-subtype'] === 'karma-general-table'
  )
  const karmaQueryBlock = blocks.find(
    (b) => b['block-type'] === 'karma-report' && b['karma-subtype'] === 'karma-query'
  )

  return (
    <div>
      {/* Integrity Header */}
      <IntegrityHeader
        snapshotId={snapshotId}
        icfHash={snapshotManifest.icfHash || ''}
        icfUrl={snapshotManifest.icfUrl || ''}
        createdAt={
          snapshotManifest.createdAt?.toDate
            ? snapshotManifest.createdAt.toDate().toISOString()
            : snapshotManifest.createdAt?.seconds
            ? new Date(snapshotManifest.createdAt.seconds * 1000).toISOString()
            : snapshotManifest.createdAt
        }
        lastAgentCheckAt={null} // TODO: Load from attestations collection
        releaseEqualsIcf={null} // TODO: Load from attestations collection
        projectId={projectId}
        folderId={folderId}
      />

      {/* Blocks in order: Serpentine, General Table, Karma Query */}
      <div className="flex flex-col items-center gap-6">
        {/* Karma Serpentine Block */}
        {serpentineBlock && (
          <AttestationKarmaSerpentineBlock
            blockId={serpentineBlock.id}
            projectId={projectId}
            folderId={folderId}
            snapshotId={snapshotId}
          />
        )}

        {/* Karma General Table Block */}
        {generalTableBlock && (
          <AttestationKarmaGeneralTableBlock
            blockId={generalTableBlock.id}
            projectId={projectId}
            folderId={folderId}
            snapshotId={snapshotId}
          />
        )}

        {/* Karma Query Block */}
        {karmaQueryBlock && (
          <AttestationQueryKarmaBlock
            block={karmaQueryBlock}
            queryResult={blockQueryResults[karmaQueryBlock.id]}
            projectId={projectId}
            folderId={folderId}
            snapshotId={snapshotId}
          />
        )}

        {blocks.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No blocks found in this snapshot
          </div>
        )}
      </div>
    </div>
  )
}
