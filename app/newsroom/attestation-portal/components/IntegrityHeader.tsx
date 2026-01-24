'use client'

import React, { useState, useEffect } from 'react'
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { initializeApp, getApps } from 'firebase/app'
import { ComparisonResultsModal } from './ComparisonResultsModal'

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
const functions = getFunctions(app)

type Props = {
  snapshotId: string
  icfHash: string
  icfUrl: string
  createdAt?: string
  lastAgentCheckAt?: string | null
  releaseEqualsIcf?: boolean | null
  projectId: string
  folderId: string
}

export function IntegrityHeader({
  snapshotId,
  icfHash,
  icfUrl,
  createdAt,
  lastAgentCheckAt,
  releaseEqualsIcf,
  projectId,
  folderId,
}: Props) {
  const [comparisonResult, setComparisonResult] = useState<any>(null)
  const [loadingComparison, setLoadingComparison] = useState(false)
  const [showResultsModal, setShowResultsModal] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [isValidationExpanded, setIsValidationExpanded] = useState(false)

  // Load existing comparison result
  useEffect(() => {
    const loadComparisonResult = async () => {
      try {
        const attestationRef = doc(
          db,
          `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/attestations/programmatic-comparison`
        )
        const attestationSnap = await getDoc(attestationRef)
        if (attestationSnap.exists()) {
          const data = attestationSnap.data()
          setComparisonResult({
            ...data,
            comparedAt: data.comparedAt?.toDate
              ? data.comparedAt.toDate().toISOString()
              : data.comparedAt?.seconds
              ? new Date(data.comparedAt.seconds * 1000).toISOString()
              : data.comparedAt,
          })
        }
      } catch (error) {
        console.error('Error loading comparison result:', error)
      }
    }
    loadComparisonResult()
  }, [projectId, folderId, snapshotId])

  const handleCompareProgrammatically = async () => {
    setLoadingComparison(true)
    setComparisonError(null)
    try {
      const compareFunction = httpsCallable(functions, 'compareSnapshotToIcf')
      const result = await compareFunction({
        projectId,
        folderId,
        snapshotId,
      })
      
      const resultData = result.data as any
      setComparisonResult(resultData)
      setShowResultsModal(true)
    } catch (error: any) {
      console.error('Error comparing snapshot to ICF:', error)
      setComparisonError(error.message || 'Failed to compare snapshot to ICF')
    } finally {
      setLoadingComparison(false)
    }
  }

  const getDaysAgo = (dateString: string): number => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    return Math.floor(diffTime / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="bg-blue-50 border-l-4 border-blue-500 p-6 mb-6">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg
            className="h-6 w-6 text-blue-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <div className="ml-4 flex-1">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">
            🔒 Frozen Release (Immutable Version)
          </h3>
          
          <div className="space-y-3 text-sm">
            <div>
              <span className="font-medium text-blue-900">Snapshot ID:</span>{' '}
              <code className="bg-blue-100 px-2 py-1 rounded text-blue-800 font-mono text-xs">
                {snapshotId}
              </code>
            </div>

            {createdAt && (
              <div>
                <span className="font-medium text-blue-900">Created:</span>{' '}
                <span className="text-blue-700">{new Date(createdAt).toLocaleString()}</span>
              </div>
            )}

            <div className="border-t border-blue-200 pt-3 mt-3">
              <h4 className="font-semibold text-blue-900 mb-2">ICF Carbon Copy</h4>
              <div className="space-y-2">
                <div>
                  <span className="font-medium text-blue-900">Content Hash:</span>{' '}
                  <code className="bg-blue-100 px-2 py-1 rounded text-blue-800 font-mono text-xs break-all">
                    {icfHash}
                  </code>
                </div>
                <div>
                  <a
                    href={icfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1"
                  >
                    View ICF File
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                </div>
              </div>
            </div>

            <div className="border-t border-blue-200 pt-3 mt-3">
              <button
                onClick={() => setIsValidationExpanded(!isValidationExpanded)}
                className="flex items-center justify-between w-full text-left mb-2"
              >
                <h4 className="font-semibold text-blue-900">Validation system (WIP)</h4>
                <svg
                  className={`h-5 w-5 text-blue-900 transition-transform ${isValidationExpanded ? 'transform rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {isValidationExpanded && (
                <>
                  {/* Programmatic Comparison Section */}
                  <div className="mt-3 p-3 bg-blue-50 rounded border border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-blue-900 text-sm">Programmatic Comparison</span>
                  {comparisonResult && (
                    <span className={`text-sm font-semibold ${
                      comparisonResult.similarity === 100 ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {comparisonResult.similarity}% similar
                    </span>
                  )}
                </div>
                
                {comparisonResult ? (
                  <div className="space-y-2">
                    <div className="text-xs text-blue-700">
                      Both files were compared {getDaysAgo(comparisonResult.comparedAt)} day{getDaysAgo(comparisonResult.comparedAt) !== 1 ? 's' : ''} ago
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowResultsModal(true)}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                      >
                        See Results
                      </button>
                      <button
                        onClick={handleCompareProgrammatically}
                        disabled={loadingComparison}
                        className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loadingComparison ? 'Comparing...' : 'Re-run Comparison'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={handleCompareProgrammatically}
                      disabled={loadingComparison}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loadingComparison ? 'Comparing...' : 'Compare Programmatically'}
                    </button>
                  </div>
                )}
                
                {comparisonError && (
                  <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                    Error: {comparisonError}
                  </div>
                )}
              </div>

              {/* AI Agent Checks (Future) */}
              <div className="mt-3">
                {lastAgentCheckAt ? (
                  <div className="space-y-1">
                    <div>
                      <span className="font-medium text-blue-900">Last Check:</span>{' '}
                      <span className="text-blue-700">
                        {new Date(lastAgentCheckAt).toLocaleString()}
                      </span>
                    </div>
                    {releaseEqualsIcf !== null && (
                      <div>
                        <span className="font-medium text-blue-900">Status:</span>{' '}
                        <span
                          className={`font-semibold ${
                            releaseEqualsIcf ? 'text-green-700' : 'text-red-700'
                          }`}
                        >
                          {releaseEqualsIcf ? '✅ Verified' : '❌ Mismatch Detected'}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-blue-700 italic text-sm">
                    No AI agent checks performed yet. First check scheduled for next 3-month cycle.
                  </div>
                )}
              </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Results Modal */}
      {comparisonResult && (
        <ComparisonResultsModal
          open={showResultsModal}
          onClose={() => setShowResultsModal(false)}
          similarity={comparisonResult.similarity}
          match={comparisonResult.match}
          differences={comparisonResult.differences || []}
          summary={comparisonResult.summary || ''}
          comparedAt={comparisonResult.comparedAt}
        />
      )}
    </div>
  )
}
