'use client'

import React from 'react'

type Props = {
  block: any
  queryResult: any
  projectId: string
  folderId: string
  snapshotId: string
}

export function AttestationQueryKarmaBlock({
  block,
  queryResult,
  projectId,
  folderId,
  snapshotId,
}: Props) {
  const slugs = block['karma-project-slugs'] || []
  const hasSlugs = slugs.length > 0

  return (
    <div
      className="bg-white border border-gray-300 rounded"
      style={{
        width: '100%',
        maxWidth: '1100px',
        minHeight: '300px',
        maxHeight: '300px',
        overflowY: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h2 className="text-gray-500 text-lg font-medium px-4 pt-4 pb-2 border-b border-gray-200">
        Karma Query
      </h2>
      <div className="flex-1 p-4 overflow-y-auto overflow-x-hidden">
        {/* Project Slugs */}
        <div className="text-sm text-black mb-4 break-words">
          <span className="font-medium text-black">Project Slugs:</span>{' '}
          <span className="text-black">{slugs.join(', ') || 'None'}</span>
        </div>

        {/* Response */}
        {queryResult ? (
          <div
            className={`p-4 rounded-md border ${
              queryResult.success
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <div className="font-semibold mb-2 text-black">
              Response: <span className="text-black">{queryResult.success ? '✓' : '✗'}</span>
            </div>
            {queryResult.error && (
              <div className="text-sm text-black mb-2">
                <strong className="text-black">Error:</strong>{' '}
                <span className="text-black">{queryResult.error}</span>
              </div>
            )}
            {queryResult.data && typeof queryResult.data === 'object' && (
              <div className="mt-4 space-y-4">
                {Object.entries(queryResult.data).map(([slug, slugData]: [string, any]) => {
                  if (Array.isArray(slugData)) {
                    return (
                      <div key={slug} className="border-b border-gray-200 pb-4">
                        <div className="font-semibold text-sm text-black mb-2">
                          Project: <code className="font-mono text-black">{slug}</code>
                          <span className="ml-2 text-xs text-black">(Failed query)</span>
                        </div>
                      </div>
                    )
                  }

                  const projectUpdates = slugData.projectUpdates || []
                  const grantUpdates = slugData.grantUpdates || []
                  const projectMilestones = slugData.projectMilestones || []
                  const grantMilestones = slugData.grantMilestones || []
                  const totalUpdates = projectUpdates.length + grantUpdates.length
                  const totalMilestones = projectMilestones.length + grantMilestones.length

                  return (
                    <div key={slug} className="border-b border-gray-200 pb-4">
                      <div className="font-semibold text-sm text-black mb-2">
                        Project: <code className="font-mono text-black">{slug}</code>
                        {totalUpdates + totalMilestones > 0 && (
                          <span className="ml-2 text-xs text-black font-normal">
                            ({totalUpdates} {totalUpdates === 1 ? 'update' : 'updates'},{' '}
                            {totalMilestones} {totalMilestones === 1 ? 'milestone' : 'milestones'})
                          </span>
                        )}
                      </div>
                      <pre className="mt-2 p-2 bg-white border border-gray-200 rounded text-xs overflow-x-auto max-h-60 overflow-y-auto text-black">
                        {JSON.stringify(slugData, null, 2)}
                      </pre>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-black">
            <em>No query results available</em>
          </div>
        )}
      </div>
    </div>
  )
}
