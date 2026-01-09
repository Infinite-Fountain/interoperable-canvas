'use client'

import React from 'react'
import { getFirestore, doc, setDoc, collection, serverTimestamp } from 'firebase/firestore'

interface QuerySubgraphBlockProps {
  block: any
  queryResult: any
  refreshingBlockId: string | null
  onRefresh: (block: any) => void
  onEditClick: (blockId: string) => void
  projectId: string
  folderId: string
}

export function QuerySubgraphBlock({
  block,
  queryResult,
  refreshingBlockId,
  onRefresh,
  onEditClick,
  projectId,
  folderId,
}: QuerySubgraphBlockProps) {
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

  return (
    <div className="p-4 overflow-y-auto overflow-x-hidden max-h-[600px]">
      {/* First Row: Refresh button and queried message */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onRefresh(block)}
            disabled={refreshingBlockId === block.id || !block['parsed-url']}
            className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refreshingBlockId === block.id ? 'Refreshing...' : 'Refresh'}
          </button>
          {queryResult?.queriedAt && (() => {
            const days = getDaysAgo(queryResult.queriedAt)
            if (days !== null) {
              return (
                <span className={`text-sm font-medium ${getDaysAgoColor(days)}`}>
                  The subgraph was queried {days} {days === 1 ? 'day' : 'days'} ago
                </span>
              )
            }
            return null
          })()}
        </div>
      </div>

      {/* URL and Query URL */}
      <button
        onClick={() => onEditClick(block.id)}
        className="text-left w-full hover:opacity-80 transition-opacity mb-4"
      >
        <div className="text-sm text-gray-900 mb-1 break-words">
          <span className="font-medium">URL:</span> {block['gardens-url']}
        </div>
        {block['query-url'] && (
          <div className="text-sm text-gray-900 mb-2 break-words">
            <span className="font-medium">Query URL:</span> {block['query-url']}
          </div>
        )}
      </button>

      {/* Filter Info */}
      {block['filter-info'] && (
        <div className="mb-3 text-sm text-gray-700">
          {block['filter-info']} {queryResult?.success ? '✓' : queryResult ? '✗' : ''}
        </div>
      )}

      {/* Query */}
      {block.query && (
        <div className="mb-3">
          <div className="text-sm font-medium text-gray-900 mb-1">Query:</div>
          <code className="text-xs bg-gray-100 px-2 py-1 rounded border block break-words whitespace-pre-wrap text-gray-900">
            {block.query}
          </code>
        </div>
      )}

      {/* Response */}
      {queryResult && (
        <div className={`p-4 border rounded-md ${queryResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="font-semibold mb-2 text-gray-900">
            Response: {queryResult.success ? '✓' : '✗'}
          </div>
          {queryResult.error && (
            <div className="mb-2">
              <span className="font-medium text-sm text-gray-900">Error:</span>
              <pre className="mt-1 p-2 bg-white border rounded text-xs text-gray-900 overflow-x-hidden whitespace-pre-wrap break-words">
                {queryResult.error}
              </pre>
            </div>
          )}
          {queryResult.data && (
            <div>
              <span className="font-medium text-sm text-gray-900">Data:</span>
              <pre className="mt-1 p-2 bg-white border rounded text-xs text-gray-900 overflow-x-hidden whitespace-pre-wrap break-words">
                {JSON.stringify(queryResult.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {!queryResult && (
        <div className="text-sm text-gray-500 text-center py-4">
          No query results yet. Click "Refresh" to query the subgraph.
        </div>
      )}
    </div>
  )
}

