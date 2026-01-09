'use client'

import React from 'react'

interface QueryKarmaBlockProps {
  block: any
  queryResult: any
  refreshingBlockId: string | null
  onRefresh: (block: any) => void
  onEditClick: (blockId: string) => void
  projectId: string
  folderId: string
}

export function QueryKarmaBlock({
  block,
  queryResult,
  refreshingBlockId,
  onRefresh,
  onEditClick,
  projectId,
  folderId,
}: QueryKarmaBlockProps) {
  // Get days ago helper
  const getDaysAgo = (timestamp: any): number | null => {
    if (!timestamp) return null
    let date: Date
    if (timestamp.toDate) {
      date = timestamp.toDate()
    } else if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000)
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp)
    } else {
      return null
    }
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  // Get color class for days ago message
  const getDaysAgoColor = (days: number): string => {
    if (days <= 10) return 'text-green-600'
    if (days <= 20) return 'text-orange-600'
    return 'text-red-600'
  }

  const slugs = block['karma-project-slugs'] || []
  const hasSlugs = slugs.length > 0

  return (
    <div className="p-4 overflow-y-auto overflow-x-hidden max-h-[600px]">
      {/* First Row: Refresh button and queried message */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onRefresh(block)}
            disabled={refreshingBlockId === block.id || !hasSlugs}
            className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refreshingBlockId === block.id ? 'Refreshing...' : 'Refresh'}
          </button>
          {queryResult?.queriedAt && (() => {
            const days = getDaysAgo(queryResult.queriedAt)
            if (days !== null) {
              return (
                <span className={`text-sm font-medium ${getDaysAgoColor(days)}`}>
                  The Karma API was queried {days} {days === 1 ? 'day' : 'days'} ago
                </span>
              )
            }
            return null
          })()}
        </div>
      </div>

      {/* Project Slugs */}
      <button
        onClick={() => onEditClick(block.id)}
        className="text-left w-full hover:opacity-80 transition-opacity mb-4"
      >
        <div className="text-sm text-gray-900 mb-1 break-words">
          <span className="font-medium">Project Slugs:</span> {slugs.join(', ') || 'None'}
        </div>
      </button>

      {/* Response - Grouped by Slug */}
      {queryResult && (
        <div className={`p-4 border rounded-md ${queryResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="font-semibold mb-2 text-gray-900">
            Response: {queryResult.success ? '✓' : '✗'}
          </div>
          {queryResult.error && (
            <div className="mb-4">
              <span className="font-medium text-sm text-gray-900">Error:</span>
              <pre className="mt-1 p-2 bg-white border rounded text-xs text-gray-900 overflow-x-hidden whitespace-pre-wrap break-words">
                {queryResult.error}
              </pre>
            </div>
          )}
          {queryResult.data && typeof queryResult.data === 'object' && (
            <div className="space-y-4">
              {Object.entries(queryResult.data).map(([slug, slugData]: [string, any]) => {
                // Skip if slugData is an array (failed queries are stored as empty arrays)
                if (Array.isArray(slugData)) {
                  return (
                    <div key={slug} className="border-b border-gray-200 pb-4 last:border-b-0 last:pb-0">
                      <div className="font-semibold text-sm text-gray-900 mb-2">
                        Project: <span className="font-mono">{slug}</span>
                        <span className="ml-2 text-xs font-normal text-red-600">(Failed query)</span>
                      </div>
                    </div>
                  )
                }

                // slugData is an object with grantMilestones, projectMilestones, projectUpdates, grantUpdates
                const projectUpdates = slugData.projectUpdates || []
                const grantUpdates = slugData.grantUpdates || []
                const projectMilestones = slugData.projectMilestones || []
                const grantMilestones = slugData.grantMilestones || []
                
                const totalUpdates = projectUpdates.length + grantUpdates.length
                const totalMilestones = projectMilestones.length + grantMilestones.length
                const totalItems = totalUpdates + totalMilestones

                return (
                  <div key={slug} className="border-b border-gray-200 pb-4 last:border-b-0 last:pb-0">
                    <div className="font-semibold text-sm text-gray-900 mb-2">
                      Project: <span className="font-mono">{slug}</span>
                      {totalItems > 0 && (
                        <span className="ml-2 text-xs font-normal text-gray-600">
                          ({totalUpdates} {totalUpdates === 1 ? 'update' : 'updates'}, {totalMilestones} {totalMilestones === 1 ? 'milestone' : 'milestones'})
                        </span>
                      )}
                    </div>
                    <pre className="mt-1 p-2 bg-white border rounded text-xs text-gray-900 overflow-x-hidden whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                      {JSON.stringify(slugData, null, 2)}
                    </pre>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {!queryResult && (
        <div className="text-sm text-gray-500 text-center py-4">
          No query results yet. Click "Refresh" to query the Karma API.
        </div>
      )}
    </div>
  )
}

