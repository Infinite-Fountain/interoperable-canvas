'use client'

import React, { useState, useEffect, useCallback } from 'react'

export interface ProofLink {
  title: string
  url: string
}

export interface MilestoneData {
  officialDate: string
  summary?: string
  notes?: string
  addProof?: string // Legacy field, not used for new data
  proofs?: ProofLink[] // Array of proof links (max 3)
  images?: {
    main?: string
    image2?: string
    image3?: string
  }
}

export interface MilestoneViewerProps {
  isOpen: boolean
  onClose: () => void
  milestone: MilestoneData | null
  backgroundColor?: string // Default: white
}

export function MilestoneViewer({ 
  isOpen, 
  onClose, 
  milestone,
  backgroundColor = '#ffffff'
}: MilestoneViewerProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Get array of available images
  const getAvailableImages = useCallback((): string[] => {
    if (!milestone?.images) return []
    const images: string[] = []
    if (milestone.images.main) images.push(milestone.images.main)
    if (milestone.images.image2) images.push(milestone.images.image2)
    if (milestone.images.image3) images.push(milestone.images.image3)
    return images
  }, [milestone])

  // Reset selected image when milestone changes or modal opens
  useEffect(() => {
    if (isOpen && milestone) {
      const images = getAvailableImages()
      setSelectedImage(images.length > 0 ? images[0] : null)
    }
  }, [isOpen, milestone, getAvailableImages])

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  // Handle thumbnail click with crossfade transition
  const handleThumbnailClick = (imageUrl: string) => {
    if (imageUrl === selectedImage) return
    
    setIsTransitioning(true)
    setTimeout(() => {
      setSelectedImage(imageUrl)
      setTimeout(() => {
        setIsTransitioning(false)
      }, 50)
    }, 150)
  }

  if (!isOpen || !milestone) return null

  const availableImages = getAvailableImages()
  const hasImages = availableImages.length > 0
  const showThumbnails = availableImages.length >= 2

  // Use only summary (notes are shown separately below)
  const fullDescription = milestone.summary || ''

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60]"
      // Note: NOT closing on overlay click per user preference
    >
      <div className="relative w-full max-w-5xl max-h-[90vh] mx-4 flex flex-col">
        {/* Effective View Area */}
        <div 
          className="flex-1 rounded-t-xl"
          style={{ backgroundColor }}
        >
          <div className="flex flex-col md:flex-row min-h-[500px]">
            {/* Left Side - Images */}
            <div className="w-full md:w-1/2 p-6 flex flex-col">
              {/* Main Image Area */}
              <div className="flex-1 flex items-center justify-center bg-gray-100 rounded-lg overflow-hidden min-h-[300px]">
                {hasImages && selectedImage ? (
                  <img 
                    src={selectedImage}
                    alt="Milestone"
                    className={`max-w-full max-h-[400px] object-contain transition-opacity duration-150 ${
                      isTransitioning ? 'opacity-0' : 'opacity-100'
                    }`}
                  />
                ) : (
                  <div className="text-gray-400 text-center p-8">
                    <div className="text-4xl mb-2">📷</div>
                    <div className="text-sm">No images available</div>
                  </div>
                )}
              </div>

              {/* Thumbnails Row - Only show if 2+ images */}
              {showThumbnails && (
                <div className="mt-4 flex justify-center gap-3">
                  {availableImages.map((imgUrl, index) => (
                    <button
                      key={index}
                      onClick={() => handleThumbnailClick(imgUrl)}
                      className={`w-20 h-20 rounded-lg overflow-hidden border-2 transition-all duration-200 ${
                        selectedImage === imgUrl 
                          ? 'border-blue-500 shadow-lg scale-105' 
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <img 
                        src={imgUrl}
                        alt={`Thumbnail ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right Side - Content */}
            <div className="w-full md:w-1/2 p-6 flex flex-col">
              {/* Header with Date */}
              <div className="mb-6">
                <h2 className="text-3xl font-bold text-gray-900">
                  {milestone.officialDate || 'No Date'}
                </h2>
              </div>

              {/* Description (Summary only) */}
              <div className="flex-1">
                {fullDescription ? (
                  <div className="text-gray-700 leading-relaxed whitespace-pre-wrap text-base">
                    {fullDescription}
                  </div>
                ) : (
                  <div className="text-gray-400 italic">
                    No description available.
                  </div>
                )}
              </div>

              {/* Notes Section - Labeled if notes exist separately */}
              {milestone.notes && milestone.summary && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Notes:
                  </h3>
                  <div className="text-gray-600 text-sm whitespace-pre-wrap">
                    {milestone.notes}
                  </div>
                </div>
              )}

              {/* Proof Links Section - Below notes */}
              {milestone.proofs && milestone.proofs.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <div className="flex gap-3">
                    {milestone.proofs.map((proof, index) => (
                      <a
                        key={index}
                        href={proof.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 px-4 py-3 text-center font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors shadow-md overflow-hidden"
                        style={{
                          fontSize: proof.title.length > 20 ? '11px' : proof.title.length > 15 ? '12px' : proof.title.length > 10 ? '13px' : '14px'
                        }}
                      >
                        {proof.title}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Close Button - Always visible at bottom */}
        <div className="flex justify-center py-6">
          <button
            onClick={onClose}
            className="px-12 py-4 text-lg font-semibold text-white bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors shadow-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default MilestoneViewer

