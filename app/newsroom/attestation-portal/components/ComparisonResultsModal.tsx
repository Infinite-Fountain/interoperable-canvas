'use client'

import React from 'react'

type Difference = {
  type: 'milestone' | 'generalTable' | 'karmaQuery' | 'metadata'
  field: string
  icfValue: any
  firestoreValue: any
  severity: 'error' | 'warning'
  identifier?: string
}

type Props = {
  open: boolean
  onClose: () => void
  similarity: number
  match: boolean
  differences: Difference[]
  summary: string
  comparedAt: string
}

export function ComparisonResultsModal({
  open,
  onClose,
  similarity,
  match,
  differences,
  summary,
  comparedAt,
}: Props) {
  if (!open) return null

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2)
    }
    return String(value)
  }

  const getSeverityColor = (severity: 'error' | 'warning') => {
    return severity === 'error' ? 'text-red-700 bg-red-50' : 'text-yellow-700 bg-yellow-50'
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'milestone':
        return 'Milestone'
      case 'generalTable':
        return 'General Table'
      case 'karmaQuery':
        return 'Karma Query'
      case 'metadata':
        return 'Metadata'
      default:
        return type
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Programmatic Comparison Results</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Summary Section */}
          <div className="mb-6">
            <div className={`p-4 rounded-lg border-2 ${match ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-gray-900">Similarity Score</h3>
                <span className={`text-2xl font-bold ${match ? 'text-green-700' : 'text-red-700'}`}>
                  {similarity}%
                </span>
              </div>
              <p className="text-sm text-gray-700">{summary}</p>
              <p className="text-xs text-gray-500 mt-2">
                Compared on {new Date(comparedAt).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Differences Section */}
          {differences.length > 0 ? (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Differences Found ({differences.length})
              </h3>
              <div className="space-y-4">
                {differences.map((diff, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${getSeverityColor(diff.severity)}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-semibold text-sm">
                          {getTypeLabel(diff.type)}
                        </span>
                        {diff.identifier && (
                          <span className="ml-2 text-xs opacity-75">
                            ({diff.identifier})
                          </span>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${
                        diff.severity === 'error' ? 'bg-red-200 text-red-800' : 'bg-yellow-200 text-yellow-800'
                      }`}>
                        {diff.severity}
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="text-sm font-medium mb-1">Field: {diff.field}</div>
                      <div className="grid grid-cols-2 gap-4 mt-2">
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">ICF Value:</div>
                          <pre className="text-xs bg-white p-2 rounded border overflow-x-auto max-h-32">
                            {formatValue(diff.icfValue)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Firestore Value:</div>
                          <pre className="text-xs bg-white p-2 rounded border overflow-x-auto max-h-32">
                            {formatValue(diff.firestoreValue)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-green-600 text-4xl mb-2">✓</div>
              <p className="text-gray-700 font-medium">No differences found - perfect match!</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
