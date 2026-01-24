'use client'

import React, { useState, useEffect } from 'react'
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { initializeApp, getApps } from 'firebase/app'
import { MilestoneViewer, type MilestoneData } from '../../../components/milestone-viewer'

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
  blockId: string
  projectId: string
  folderId: string
  snapshotId: string
}

// Helper function to get the date value from a row based on priority order (from newsroom)
const getRowDate = (row: any): Date | null => {
  // Priority order: officialDate (single date) first, then endDate, dueDate, startDate, createdAt, completedAt, updatedAt
  const dateFields = [
    row.officialDate,
    row.endDate,
    row.dueDate,
    row.startDate,
    row.createdAt,
    row.completedAt,
    row.updatedAt,
  ]

  for (const dateStr of dateFields) {
    if (dateStr && dateStr.trim() !== '') {
      const date = new Date(dateStr)
      if (!isNaN(date.getTime())) {
        return date
      }
    }
  }
  return null
}

// Sort rows: first rows with summary AND single date (ascending), then rest by date (descending, using newsroom logic)
const sortAttestationRows = (rows: any[]): any[] => {
  // Separate rows into two groups
  const withSummaryAndDate: any[] = []
  const rest: any[] = []

  rows.forEach((row) => {
    const hasSummary = row.summary && row.summary.trim() !== ''
    const hasSingleDate = row.officialDate && row.officialDate.trim() !== ''
    
    if (hasSummary && hasSingleDate) {
      withSummaryAndDate.push(row)
    } else {
      rest.push(row)
    }
  })

  // Sort first group by single date ascending
  withSummaryAndDate.sort((a, b) => {
    const dateA = new Date(a.officialDate)
    const dateB = new Date(b.officialDate)
    if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0
    if (isNaN(dateA.getTime())) return 1
    if (isNaN(dateB.getTime())) return -1
    return dateA.getTime() - dateB.getTime() // Ascending
  })

  // Sort rest using newsroom logic (descending, newest first)
  rest.sort((a, b) => {
    const dateA = getRowDate(a)
    const dateB = getRowDate(b)
    
    // If both have dates, sort descending (newest first)
    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime()
    }
    // If only one has a date, put it first
    if (dateA && !dateB) return -1
    if (!dateA && dateB) return 1
    // If neither has a date, maintain original order
    return 0
  })

  // Combine: first group first, then rest
  return [...withSummaryAndDate, ...rest]
}

export function AttestationKarmaGeneralTableBlock({
  blockId,
  projectId,
  folderId,
  snapshotId,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<any[]>([])
  const [milestoneViewerOpen, setMilestoneViewerOpen] = useState(false)
  const [milestoneViewerData, setMilestoneViewerData] = useState<MilestoneData | null>(null)
  const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null)

  useEffect(() => {
    const loadBlock = async () => {
      try {
        // Load block from snapshot
        const blockPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks/${blockId}`
        const blockRef = doc(db, blockPath)
        const blockSnap = await getDoc(blockRef)

        if (!blockSnap.exists()) {
          setError('Block not found in snapshot')
          return
        }

        // Load table data from snapshot
        const tableDataPath = `${blockPath}/table-data/karma-general-table`
        const tableDataRef = doc(db, tableDataPath)
        const tableDataSnap = await getDoc(tableDataRef)

        if (tableDataSnap.exists()) {
          const data = tableDataSnap.data()
          const unsortedRows = data.rows || []
          
          // Sort rows: first rows with summary AND single date (ascending), then rest by date (descending)
          const sortedRows = sortAttestationRows(unsortedRows)
          setRows(sortedRows)
        }
      } catch (err) {
        console.error('Error loading block:', err)
        setError(err instanceof Error ? err.message : 'Failed to load block')
      } finally {
        setLoading(false)
      }
    }

    loadBlock()
  }, [blockId, projectId, folderId, snapshotId])

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center py-8 text-gray-500">Loading general table...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center py-8 text-red-600">{error}</div>
      </div>
    )
  }

  // Format date helper
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return dateStr
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return dateStr
    }
  }

  return (
    <div
      className="bg-white border border-gray-300 rounded"
      style={{
        width: '100%',
        maxWidth: '1100px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h2 className="text-gray-500 text-lg font-medium px-4 pt-4 pb-2 border-b border-gray-200">
        General Table
      </h2>
      <div className="flex-1">
        {/* Table container with sticky header and scrollable body */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[100px] min-w-[100px] max-w-[100px]">
                    Dates
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                    Single Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[200px] min-w-[200px] max-w-[200px]">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[200px] min-w-[200px] max-w-[200px]">
                    Summary
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[150px] min-w-[150px] max-w-[150px]">
                    Proof
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[150px] min-w-[150px] max-w-[150px]">
                    Add Proof
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                    Notes
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[120px] min-w-[120px] max-w-[120px]">
                    Images
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[75px] min-w-[75px] max-w-[75px]">
                    Slug
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-gray-500">
                      No data available
                    </td>
                  </tr>
                ) : (
                  rows.map((row: any, index: number) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[100px] min-w-[100px] max-w-[100px]">
                        <div className="break-words">
                          <div className="space-y-1">
                            {row.startDate && <div>start = {formatDate(row.startDate)}</div>}
                            {row.endDate && <div>end = {formatDate(row.endDate)}</div>}
                            {row.createdAt && <div>created = {formatDate(row.createdAt)}</div>}
                            {row.updatedAt && <div>updated = {formatDate(row.updatedAt)}</div>}
                            {row.dueDate && <div>due = {formatDate(row.dueDate)}</div>}
                            {row.completedAt && <div>completed = {formatDate(row.completedAt)}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                        {row.officialDate && (
                          <div className="text-xs text-gray-900 break-words whitespace-normal">
                            {row.officialDate}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                        <div className="max-h-[200px] overflow-y-auto">
                          {row.title}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[200px] min-w-[200px] max-w-[200px]">
                        <div className="max-h-[200px] overflow-y-auto overflow-x-hidden break-words">
                          {row.description || ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[200px] min-w-[200px] max-w-[200px]">
                        {row.summary && (
                          <div className="max-h-[200px] overflow-y-auto overflow-x-hidden break-words text-xs text-gray-900">
                            {row.summary}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                        <span className={`px-2 py-1 rounded text-xs font-medium w-fit ${
                          (() => {
                            const firstStatus = row.status?.split(',')[0]?.trim() || ''
                            if (firstStatus === 'completed') return 'bg-green-100 text-green-800'
                            if (firstStatus === 'pending') return 'bg-yellow-100 text-yellow-800'
                            if (firstStatus === 'marked completed, no proof') return 'bg-blue-100 text-blue-800'
                            if (firstStatus === 'skip') return 'bg-gray-200 text-gray-700'
                            if (firstStatus === 'not in karma') return 'bg-purple-100 text-purple-800'
                            if (firstStatus === 'manually approved') return 'bg-cyan-100 text-cyan-800'
                            return 'bg-gray-100 text-gray-800'
                          })()
                        }`}>
                          {row.status || 'n/a'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[150px] min-w-[150px] max-w-[150px]">
                        <div className="max-h-[200px] overflow-y-auto break-words whitespace-normal">
                          {row.proof !== 'n/a' && row.proof ? (
                            <a href={row.proof} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                              {row.proof}
                            </a>
                          ) : (
                            'n/a'
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[150px] min-w-[150px] max-w-[150px]">
                        {row.proofs && Array.isArray(row.proofs) && row.proofs.length > 0 && (
                          <div className="text-xs text-gray-900 break-words whitespace-normal">
                            {row.proofs.map((proof: any, idx: number) => (
                              <div key={idx} className="mb-1">
                                <a
                                  href={proof.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {proof.title}
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                        {row.notes && (
                          <div className="text-xs text-gray-900 break-words whitespace-normal max-h-[200px] overflow-y-auto">
                            {row.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[120px] min-w-[120px] max-w-[120px]">
                        {row.images && (row.images.main || row.images.image2 || row.images.image3) && (
                          <div className="flex flex-wrap gap-1">
                            {row.images.main && (
                              <img 
                                src={row.images.main} 
                                alt="Main" 
                                className="w-12 h-12 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => setViewerImageUrl(row.images.main)}
                              />
                            )}
                            {row.images.image2 && (
                              <img 
                                src={row.images.image2} 
                                alt="Image 2" 
                                className="w-12 h-12 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => setViewerImageUrl(row.images.image2)}
                              />
                            )}
                            {row.images.image3 && (
                              <img 
                                src={row.images.image3} 
                                alt="Image 3" 
                                className="w-12 h-12 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => setViewerImageUrl(row.images.image3)}
                              />
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 font-mono w-[75px] min-w-[75px] max-w-[75px] break-words">
                        {row.slug || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <MilestoneViewer
        isOpen={milestoneViewerOpen}
        onClose={() => setMilestoneViewerOpen(false)}
        milestone={milestoneViewerData}
      />

      {/* Image Viewer Modal */}
      {viewerImageUrl && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60]"
          onClick={() => setViewerImageUrl(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center">
            <img 
              src={viewerImageUrl} 
              alt="Full size" 
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setViewerImageUrl(null)}
              className="mt-6 px-8 py-3 text-lg font-semibold text-white bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors shadow-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
