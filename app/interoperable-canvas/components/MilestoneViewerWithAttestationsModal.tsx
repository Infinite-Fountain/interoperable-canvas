'use client'

import React from 'react'
import { useCanvasStore } from './store'
import { MilestoneViewerWithAttestations } from './MilestoneViewerWithAttestations'

export function MilestoneViewerWithAttestationsModal() {
  const isOpen = useCanvasStore((s) => s.ui.showMilestoneViewerWithAttestationsModal)
  const milestoneViewerData = useCanvasStore((s) => s.milestoneViewerWithAttestationsData)
  const closeModal = useCanvasStore((s) => s.closeMilestoneViewerWithAttestationsModal)

  if (!milestoneViewerData) return null

  return (
    <MilestoneViewerWithAttestations
      isOpen={isOpen}
      onClose={closeModal}
      newsroomProjectId={milestoneViewerData.newsroomProjectId}
      newsroomFolderId={milestoneViewerData.newsroomFolderId}
      newsroomSnapshotId={milestoneViewerData.newsroomSnapshotId}
      officialDate={milestoneViewerData.officialDate}
      summary={milestoneViewerData.summary}
      imageUrl={milestoneViewerData.imageUrl}
    />
  )
}
