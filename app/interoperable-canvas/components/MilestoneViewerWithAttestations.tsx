'use client'

import React, { useState, useEffect, useRef } from 'react'
import { initializeApp, getApps } from 'firebase/app'
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore'

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

interface AttestationData {
  createdAt: any
  attesterSmartWallet: string
  attestationOutcomesScore: number
  easExplorerUrl: string
  attestationComment?: string
}

interface MilestoneViewerWithAttestationsProps {
  isOpen: boolean
  onClose: () => void
  newsroomProjectId: string
  newsroomFolderId: string
  newsroomSnapshotId: string
  officialDate: string
  summary: string
  imageUrl?: string | null
}

export function MilestoneViewerWithAttestations({
  isOpen,
  onClose,
  newsroomProjectId,
  newsroomFolderId,
  newsroomSnapshotId,
  officialDate,
  summary,
  imageUrl,
}: MilestoneViewerWithAttestationsProps) {
  const [attestations, setAttestations] = useState<AttestationData[]>([])
  const [averageScore, setAverageScore] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [histogramData, setHistogramData] = useState<{ bin: string; count: number }[]>([])
  const [notes, setNotes] = useState<string | null>(null)
  const [proofs, setProofs] = useState<{ title: string; url: string }[]>([])
  const tableRef = useRef<HTMLTableElement>(null)

  // Fetch attestations and calculate statistics
  useEffect(() => {
    if (!isOpen || !newsroomProjectId || !newsroomFolderId || !newsroomSnapshotId) {
      return
    }

    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Load wisdom council members
        const membersRef = collection(db, 'newsroom', newsroomProjectId, 'members')
        const membersSnap = await getDocs(membersRef)
        const wisdomCouncilIdentifiers = new Set<string>()
        membersSnap.forEach((doc) => {
          const data = doc.data()
          const roles = data.roles || []
          if (Array.isArray(roles) && roles.includes('wisdomCouncil')) {
            const memberId = doc.id.toLowerCase()
            wisdomCouncilIdentifiers.add(memberId)
            if (data.walletAddress) wisdomCouncilIdentifiers.add(data.walletAddress.toLowerCase())
            if (data.privyId) wisdomCouncilIdentifiers.add(data.privyId.toLowerCase())
          }
        })

        // Load all attestations for this milestone
        const attestationsRef = collection(db, 'newsroom', newsroomProjectId, 'folders', newsroomFolderId, 'snapshots', newsroomSnapshotId, 'attestations')
        const attestationsSnap = await getDocs(attestationsRef)
        
        // Map to store latest attestation per wisdom council member
        const latestAttestationsByMember = new Map<string, AttestationData & { createdAt: any }>()
        
        attestationsSnap.forEach((doc) => {
          const data = doc.data()
          if (data.isActive !== false && data.type === 'attestation' && data.attestationType === 'milestone-outcomes') {
            const attestationOfficialDate = data.officialDate || data.milestoneOfficialDate || ''
            const attestationSummary = data.summary || data.milestoneSummary || ''
            
            // Check if this attestation matches the milestone
            if (attestationOfficialDate === officialDate && attestationSummary === summary) {
              const score = data.attestationOutcomesScore || data.scoreOutcomes
              if (score !== undefined && score !== null) {
                // Get all possible member identifiers from attestation
                const attestorIdentifiers = [
                  data.attesterAddress,
                  data.attesterSmartWallet,
                  data.attesterPrivyId,
                  data.attester,
                ].filter(Boolean).map(id => typeof id === 'string' ? id.toLowerCase() : id)
                
                // Find matching wisdom council member
                let matchingMemberId: string | null = null
                for (const attestorId of attestorIdentifiers) {
                  if (wisdomCouncilIdentifiers.has(attestorId)) {
                    matchingMemberId = attestorId
                    break
                  }
                }
                
                // Only process if member is in wisdom council
                if (matchingMemberId) {
                  const existing = latestAttestationsByMember.get(matchingMemberId)
                  const createdAt = data.createdAt
                  
                  // Keep the latest attestation (by createdAt timestamp)
                  if (!existing || (createdAt && existing.createdAt && 
                      (createdAt.toDate ? createdAt.toDate().getTime() : (createdAt.seconds ? createdAt.seconds * 1000 : 0)) > 
                      (existing.createdAt.toDate ? existing.createdAt.toDate().getTime() : (existing.createdAt.seconds ? existing.createdAt.seconds * 1000 : 0)))) {
                    latestAttestationsByMember.set(matchingMemberId, {
                      createdAt: data.createdAt,
                      attesterSmartWallet: data.attesterSmartWallet || data.attesterAddress || '',
                      attestationOutcomesScore: score,
                      easExplorerUrl: data.easExplorerUrl || '',
                      attestationComment: data.attestationComment || data.comment || '',
                    })
                  }
                }
              }
            }
          }
        })

        // Convert to array and sort by createdAt (newest first)
        const attestationsArray = Array.from(latestAttestationsByMember.values())
          .sort((a, b) => {
            const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0)
            const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0)
            return bTime - aTime
          })

        setAttestations(attestationsArray)

        // Extract notes and proofs from the first matching attestation (or latest)
        // We'll get these from the original attestations collection, not just wisdom council filtered
        let milestoneNotes: string | null = null
        let milestoneProofs: { title: string; url: string }[] = []
        
        attestationsSnap.forEach((doc) => {
          const data = doc.data()
          if (data.isActive !== false && data.type === 'attestation' && data.attestationType === 'milestone-outcomes') {
            const attestationOfficialDate = data.officialDate || data.milestoneOfficialDate || ''
            const attestationSummary = data.summary || data.milestoneSummary || ''
            
            if (attestationOfficialDate === officialDate && attestationSummary === summary) {
              // Get notes if available
              if (data.notes && !milestoneNotes) {
                milestoneNotes = data.notes
              }
              
              // Get proofs if available (could be array or single object)
              if (data.proofs && Array.isArray(data.proofs) && data.proofs.length > 0 && milestoneProofs.length === 0) {
                milestoneProofs = data.proofs.map((p: any) => ({
                  title: p.title || 'Proof',
                  url: p.url || '',
                })).filter((p: { title: string; url: string }) => p.url) // Only include proofs with URLs
              } else if (data.proof && !milestoneProofs.length) {
                // Handle single proof object
                if (typeof data.proof === 'object' && data.proof.url) {
                  milestoneProofs = [{
                    title: data.proof.title || 'Proof',
                    url: data.proof.url,
                  }]
                } else if (typeof data.proof === 'string') {
                  milestoneProofs = [{
                    title: 'Proof',
                    url: data.proof,
                  }]
                }
              }
            }
          }
        })

        setNotes(milestoneNotes)
        setProofs(milestoneProofs)

        // Calculate average
        if (attestationsArray.length > 0) {
          const scores = attestationsArray.map(a => a.attestationOutcomesScore)
          const sum = scores.reduce((a, b) => a + b, 0)
          const average = Math.round(sum / scores.length)
          setAverageScore(average)

          // Calculate histogram
          // Bins: 0-60, 61-65, 66-70, 71-75, 76-80, 81-85, 86-90, 91-95, 96-100
          const bins = [
            { label: '0-60', min: 0, max: 60 },
            { label: '61-65', min: 61, max: 65 },
            { label: '66-70', min: 66, max: 70 },
            { label: '71-75', min: 71, max: 75 },
            { label: '76-80', min: 76, max: 80 },
            { label: '81-85', min: 81, max: 85 },
            { label: '86-90', min: 86, max: 90 },
            { label: '91-95', min: 91, max: 95 },
            { label: '96-100', min: 96, max: 100 },
          ]

          const histogram = bins.map(bin => ({
            bin: bin.label,
            count: scores.filter(score => score >= bin.min && score <= bin.max).length,
          }))

          setHistogramData(histogram)
        } else {
          setAverageScore(null)
          setHistogramData([])
        }
      } catch (err) {
        console.error('Error fetching attestations:', err)
        setError(err instanceof Error ? err.message : 'Failed to load attestations')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [isOpen, newsroomProjectId, newsroomFolderId, newsroomSnapshotId, officialDate, summary])

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  // Format date
  const formatDate = (createdAt: any): string => {
    if (!createdAt) return 'No date'
    try {
      let date: Date
      if (createdAt.toDate && typeof createdAt.toDate === 'function') {
        date = createdAt.toDate()
      } else if (createdAt.seconds) {
        date = new Date(createdAt.seconds * 1000)
      } else if (createdAt instanceof Date) {
        date = createdAt
      } else {
        date = new Date(createdAt)
      }
      const month = date.toLocaleDateString('en-US', { month: 'short' })
      const day = date.getDate()
      const year = date.getFullYear()
      return `${month}-${day}-${year}`
    } catch {
      return 'Invalid date'
    }
  }

  // Truncate wallet address
  const truncateWallet = (wallet: string): string => {
    if (!wallet || wallet.length <= 6) return wallet
    return `...${wallet.slice(-6)}`
  }

  // Truncate comment to first 100 characters
  const truncateComment = (comment: string): string => {
    if (!comment) return ''
    if (comment.length <= 100) return comment
    return comment.substring(0, 100) + '...'
  }

  if (!isOpen) return null

  const maxHistogramCount = Math.max(...histogramData.map(h => h.count), 1)

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60] p-4"
    >
      <div className="relative w-full max-w-5xl max-h-[90vh] mx-4 flex flex-col rounded-xl overflow-hidden bg-white">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-12 h-12 flex items-center justify-center text-white bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors shadow-lg z-10"
          aria-label="Close"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            className="h-6 w-6" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content Area */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 p-6 pt-16">
          {/* Left Side - Image */}
          <div className="w-full md:w-1/2 pr-3 md:pr-6 flex flex-col min-h-0">
            <div className="flex-1 flex items-center justify-center bg-gray-100 rounded-lg overflow-hidden min-h-0">
              {imageUrl ? (
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cursor-pointer"
                >
                  <img 
                    src={imageUrl}
                    alt="Milestone"
                    className="max-w-full max-h-full object-contain"
                  />
                </a>
              ) : (
                <div className="text-gray-400 text-center p-8">
                  <div className="text-4xl mb-2">📷</div>
                  <div className="text-sm">No image available</div>
                </div>
              )}
            </div>
          </div>

          {/* Right Side - Content with Scroll */}
          <div className="w-full md:w-1/2 pl-3 md:pl-6 flex flex-col min-h-0">
            {/* Header with Date */}
            <div className="mb-4 flex-shrink-0">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900">
                {officialDate || 'No Date'}
              </h2>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-2">
              {/* Description */}
              <div className="mb-6">
                {summary ? (
                  <div className="text-gray-700 leading-relaxed whitespace-pre-wrap text-sm md:text-base">
                    {summary}
                  </div>
                ) : (
                  <div className="text-gray-400 italic">
                    No description available.
                  </div>
                )}
              </div>

              {/* Notes Section */}
              {notes && summary && (
                <div className="mb-6 pt-3 border-t border-gray-200">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Notes:
                  </h3>
                  <div className="text-gray-600 text-xs whitespace-pre-wrap">
                    {notes}
                  </div>
                </div>
              )}

              {/* Proof Links Section */}
              {proofs && proofs.length > 0 && (
                <div className={`mb-6 pt-3 border-t border-gray-200 ${!notes || !summary ? 'mt-3' : ''}`}>
                  <div className="flex gap-2 flex-wrap">
                    {proofs.map((proof, index) => (
                      <a
                        key={index}
                        href={proof.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 px-3 py-2 text-center font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors shadow-md overflow-hidden min-w-[100px] text-xs"
                      >
                        {proof.title}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Average Score */}
              {loading ? (
                <div className="mb-6 text-gray-500 text-center">Loading scores...</div>
              ) : averageScore !== null ? (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                  <div className="text-sm font-semibold text-gray-700 mb-1">Average Outcomes Score</div>
                  <div className="text-5xl font-bold text-green-700">{averageScore}</div>
                </div>
              ) : (
                <div className="mb-6 text-gray-500 text-center">No scores available</div>
              )}

              {/* Histogram */}
              {histogramData.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-end gap-2 h-48">
                    {histogramData.map((item, index) => (
                      <div key={index} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full bg-gray-200 rounded-t relative overflow-hidden" style={{ height: '200px' }}>
                          <div
                            className="bg-green-700 w-full rounded-t transition-all absolute bottom-0"
                            style={{ height: `${(item.count / maxHistogramCount) * 100}%` }}
                          />
                          <div className="absolute inset-0 flex items-end justify-center pb-1">
                            {item.count > 0 && (
                              <span className="text-2xl font-bold text-white">{item.count}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 text-center">{item.bin}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attestations Table */}
              {loading ? (
                <div className="text-gray-500">Loading attestations...</div>
              ) : attestations.length > 0 ? (
                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-3">Attestations</div>
                  <div className="border rounded-lg overflow-hidden">
                    <table ref={tableRef} className="w-full text-xs border-collapse">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="border px-2 py-2 text-left text-gray-700" style={{ width: '100px' }}>Date</th>
                          <th className="border px-3 py-2 text-left text-gray-700">Attester</th>
                          <th className="border px-2 py-2 text-left text-gray-700" style={{ width: '60px' }}>Score</th>
                          <th className="border px-3 py-2 text-left text-gray-700">Comment</th>
                          <th className="border px-2 py-2 text-left text-gray-700" style={{ width: '100px' }}>Onchain</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attestations.map((att, index) => (
                          <tr key={index} className="hover:bg-gray-50 relative">
                            <td className="border px-2 py-2 text-gray-700">{formatDate(att.createdAt)}</td>
                            <td className="border px-3 py-2 font-mono text-[10px] text-gray-700">{truncateWallet(att.attesterSmartWallet)}</td>
                            <td className="border px-2 py-2 font-semibold text-gray-700 text-center">{att.attestationOutcomesScore}</td>
                            <td className="border px-3 py-2">
                              {att.attestationComment ? (
                                <span className="text-gray-700">
                                  {truncateComment(att.attestationComment)}
                                  {att.attestationComment.length > 80 && (
                                    <span className="text-gray-500 group cursor-help">
                                      {' '}(hover to see full)
                                      {/* Tooltip positioned relative to the row, matching table width */}
                                      <div className="absolute left-0 bottom-full mb-2 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none" style={{ width: tableRef.current ? `${tableRef.current.offsetWidth}px` : '100%', maxWidth: 'calc(100vw - 2rem)' }}>
                                        <div className="text-gray-200 whitespace-pre-wrap leading-relaxed break-words overflow-wrap-anywhere max-h-64 overflow-y-auto">{att.attestationComment}</div>
                                        {/* Arrow pointing down to the comment text */}
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                                      </div>
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="border px-2 py-2">
                              {att.easExplorerUrl ? (
                                <a
                                  href={att.easExplorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 underline"
                                >
                                  see onchain
                                </a>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-gray-500">No attestations found</div>
              )}
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="absolute inset-0 bg-white bg-opacity-95 flex items-center justify-center p-6">
            <div className="text-center">
              <div className="text-red-500 text-4xl mb-4">❌</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
              <p className="text-gray-600 mb-4">{error}</p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
