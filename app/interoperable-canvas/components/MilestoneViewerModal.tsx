'use client'

import React, { useState, useEffect } from 'react'
import { useCanvasStore } from './store'
import { MilestoneViewer, MilestoneData } from '@/app/newsroom/components/milestone-viewer/MilestoneViewer'
import { initializeApp, getApps } from 'firebase/app'
import { getFirestore, doc, getDoc } from 'firebase/firestore'

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

export default function MilestoneViewerModal() {
  const isOpen = useCanvasStore((s) => s.ui.showMilestoneViewerModal)
  const milestoneViewerData = useCanvasStore((s) => s.milestoneViewerData)
  const closeMilestoneViewerModal = useCanvasStore((s) => s.closeMilestoneViewerModal)
  
  const [milestone, setMilestone] = useState<MilestoneData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch milestone data when modal opens
  useEffect(() => {
    if (!isOpen || !milestoneViewerData) {
      setMilestone(null)
      setError(null)
      return
    }

    const fetchMilestoneData = async () => {
      setLoading(true)
      setError(null)

      try {
        const { newsroomProjectId, newsroomFolderId, sourceBlockId, summaryText, charactersInCard } = milestoneViewerData

        // Fetch from karma-general-table
        const tableDataRef = doc(
          db, 
          'newsroom', 
          newsroomProjectId, 
          'folders', 
          newsroomFolderId, 
          'blocks', 
          sourceBlockId, 
          'table-data', 
          'karma-general-table'
        )
        
        const tableDataSnap = await getDoc(tableDataRef)
        
        if (!tableDataSnap.exists()) {
          setError('Milestone data not found. The source table may have been deleted.')
          setLoading(false)
          return
        }

        const tableData = tableDataSnap.data()
        const rows = tableData.rows || []

        // Helper function to get first N characters (matching how karmaSerpentine displays summaries)
        // This must match exactly how karmaSerpentine.tsx does it
        const getFirstNCharacters = (str: string, n: number): string => {
          if (!str) return ''
          const trimmed = str.trim()
          if (trimmed.length <= n) return trimmed
          return trimmed.substring(0, n) + '...'
        }

        // Find the row by matching summary text (reverse lookup)
        let matchingRow: any = null
        
        if (charactersInCard) {
          // Use stored character count for precise matching
          matchingRow = rows.find((row: any) => {
            if (!row.summary) return false
            const rowSummaryPreview = getFirstNCharacters(row.summary, charactersInCard)
            return rowSummaryPreview === summaryText
          })
        } else {
          // Fallback: try exact match first, then try different character counts
          matchingRow = rows.find((row: any) => {
            if (!row.summary) return false
            return row.summary.trim() === summaryText
          })

          // If no exact match, try matching with truncation
          // Check character counts from 50 to 200 (reasonable range for card summaries)
          if (!matchingRow) {
            for (let charCount = 50; charCount <= 200 && !matchingRow; charCount++) {
              matchingRow = rows.find((row: any) => {
                if (!row.summary) return false
                const rowSummaryPreview = getFirstNCharacters(row.summary, charCount)
                return rowSummaryPreview === summaryText
              })
            }
          }
        }

        if (!matchingRow) {
          setError(`Milestone with summary "${summaryText.substring(0, 50)}..." not found.`)
          setLoading(false)
          return
        }

        // Build MilestoneData from the row
        const milestoneData: MilestoneData = {
          officialDate: matchingRow.officialDate || '',
          summary: matchingRow.summary || '',
          notes: matchingRow.notes || '',
          proofs: matchingRow.proofs || [],
          images: matchingRow.images || undefined,
        }

        setMilestone(milestoneData)
      } catch (err) {
        console.error('Error fetching milestone data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load milestone data')
      } finally {
        setLoading(false)
      }
    }

    fetchMilestoneData()
  }, [isOpen, milestoneViewerData])

  // Show loading state
  if (isOpen && loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60]">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4"></div>
          <p>Loading milestone...</p>
        </div>
      </div>
    )
  }

  // Show error state
  if (isOpen && error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-lg p-6 max-w-md mx-4 text-center">
          <div className="text-red-500 text-4xl mb-4">❌</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={closeMilestoneViewerModal}
            className="px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <MilestoneViewer
      isOpen={isOpen}
      onClose={closeMilestoneViewerModal}
      milestone={milestone}
    />
  )
}

