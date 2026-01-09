'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { NewsroomApp } from './components/NewsroomApp'

function ProjectRouter() {
  const searchParams = useSearchParams()
  const requestedProjectId = searchParams?.get('projectId') || null
  
  if (requestedProjectId) {
    return (
      <div className="min-h-screen bg-gray-900">
        <NewsroomApp projectId={requestedProjectId} />
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-gray-900">Newsroom — Projects</h1>
        <p className="text-sm text-gray-600 mt-1">Select a project to view the newsroom.</p>
        <p className="text-xs text-gray-500 mt-2">
          Use: /newsroom?projectId=gardens-fund
        </p>
      </div>
    </div>
  )
}

export default function NewsroomHomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-100 text-gray-700 p-6">Loading…</div>}>
      <ProjectRouter />
    </Suspense>
  )
}

