'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AttestationPortalApp } from './components/AttestationPortalApp'

function AttestationPortalContent() {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('projectId')
  const folderId = searchParams.get('folderId')
  const snapshotId = searchParams.get('snapshotId')

  if (!projectId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Attestation Portal</h1>
          <p className="text-gray-600">Please provide a projectId in the URL: ?projectId=your-project-id</p>
        </div>
      </div>
    )
  }

  return (
    <AttestationPortalApp
      projectId={projectId}
      initialFolderId={folderId || null}
      initialSnapshotId={snapshotId || null}
    />
  )
}

export default function AttestationPortalPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading attestation portal...</p>
        </div>
      </div>
    }>
      <AttestationPortalContent />
    </Suspense>
  )
}
