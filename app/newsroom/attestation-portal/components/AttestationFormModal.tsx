'use client'

/**
 * NOTE: This component has been adapted from the source to use wallet-based authentication
 * instead of Privy. 
 * 
 * IMPORTANT: EAS attestations require smart wallet functionality for gasless transactions.
 * This component currently uses regular wallet addresses. To enable full functionality:
 * 1. Integrate a smart wallet solution (e.g., Privy, Biconomy, ZeroDev)
 * 2. Update the signer implementation to use smart wallet client
 * 3. Ensure paymaster is configured for gasless transactions
 */

import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { EAS_SCHEMA_UIDS, getAttestationExplorerUrl } from '../../utils/easSchemas'
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore'
import { initializeApp, getApps } from 'firebase/app'
import Confetti from 'react-confetti'
import type { MilestoneData } from '../../components/milestone-viewer/MilestoneViewer'

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

type Props = {
  open: boolean
  onClose: () => void
  milestone: MilestoneData | null
  projectId: string
  folderId: string
  snapshotId: string
  blockId: string
  attestationType?: 'outcomes' | 'reporting' // Default to 'outcomes' for backward compatibility
}

export function AttestationFormModal({ 
  open, 
  onClose, 
  milestone,
  projectId,
  folderId,
  snapshotId,
  blockId,
  attestationType = 'outcomes'
}: Props) {
  const [account, setAccount] = useState<string | null>(null)
  const [score, setScore] = useState<string>('')
  const [comment, setComment] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [attestationUID, setAttestationUID] = useState<string | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const [windowDimensions, setWindowDimensions] = useState({ width: 0, height: 0 })
  const [loadingData, setLoadingData] = useState(false)
  const [existingAttestation, setExistingAttestation] = useState<{ docId: string; data: any } | null>(null)
  const [checkingExisting, setCheckingExisting] = useState(false)

  // Track window size for confetti
  useEffect(() => {
    const updateDimensions = () => {
      setWindowDimensions({ width: window.innerWidth, height: window.innerHeight })
    }
    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // Show confetti when attestation succeeds
  useEffect(() => {
    if (attestationUID && windowDimensions.width > 0 && windowDimensions.height > 0) {
      setShowConfetti(true)
      const timer = setTimeout(() => setShowConfetti(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [attestationUID, windowDimensions])

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setScore('')
      setComment('')
      setStatus('')
      setAttestationUID(null)
      setIsSubmitting(false)
      setExistingAttestation(null)
      setCheckingExisting(false)
    }
  }, [open])

  // Initialize wallet connection
  useEffect(() => {
    const init = async () => {
      try {
        const anyWindow = window as any
        if (!anyWindow.ethereum) return
        const provider = new ethers.BrowserProvider(anyWindow.ethereum)
        const accounts = await provider.listAccounts()
        if (accounts && accounts.length > 0) {
          setAccount(accounts[0].address)
        }
        anyWindow.ethereum.on?.('accountsChanged', (accs: string[]) => {
          setAccount(accs?.[0] ?? null)
        })
      } catch (e: any) {
        // ignore eager connect errors
      }
    }
    init()
  }, [])

  // Check for existing attestation when modal opens
  useEffect(() => {
    if (!open || !milestone || !account) return

    const checkExistingAttestation = async () => {
      setCheckingExisting(true)
      
      try {
        // Use wallet address (NOTE: Smart wallet address should be used for production)
        const walletAddress = account.toLowerCase()

        // Find milestoneIndex (same logic as in handleSubmit)
        const blocksPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks`
        const blocksRef = collection(db, blocksPath)
        const blocksSnap = await getDocs(blocksRef)
        
        let generalTableBlockId = blockId
        blocksSnap.forEach((docSnap) => {
          const blockData = docSnap.data()
          if (blockData['block-type'] === 'karma-report' && blockData['karma-subtype'] === 'karma-general-table') {
            generalTableBlockId = docSnap.id
          }
        })

        // Load general table data
        const tableDataPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks/${generalTableBlockId}/table-data/karma-general-table`
        const tableDataRef = doc(db, tableDataPath)
        const tableDataSnap = await getDoc(tableDataRef)

        if (!tableDataSnap.exists()) {
          setCheckingExisting(false)
          return
        }

        const tableData = tableDataSnap.data()
        const rows = tableData.rows || []

        // Find matching row by officialDate and summary
        let milestoneIndex = -1
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          if (row.officialDate === milestone.officialDate && row.summary === milestone.summary) {
            milestoneIndex = i
            break
          }
        }

        // Fallback: try matching by summary only
        if (milestoneIndex === -1 && milestone.summary) {
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            if (row.summary === milestone.summary) {
              milestoneIndex = i
              break
            }
          }
        }

        if (milestoneIndex === -1) {
          setCheckingExisting(false)
          return
        }

        // Query for existing active attestation
        const attestationsPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/attestations`
        const attestationsRef = collection(db, attestationsPath)
        
        const attestationTypeKey = attestationType === 'outcomes' ? 'milestone-outcomes' : 'milestone-reporting'
        
        const existingAttestationQuery = query(
          attestationsRef,
          where('type', '==', 'attestation'),
          where('attestationType', '==', attestationTypeKey),
          where('milestoneIndex', '==', milestoneIndex),
          where('attesterSmartWallet', '==', walletAddress),
          where('isActive', '==', true)
        )

        const existingAttestations = await getDocs(existingAttestationQuery)

        if (!existingAttestations.empty) {
          const existingDoc = existingAttestations.docs[0]
          const existingData = existingDoc.data()
          
          setExistingAttestation({
            docId: existingDoc.id,
            data: existingData
          })

          // Auto-populate form with existing values
          const scoreField = attestationType === 'outcomes' ? 'attestationOutcomesScore' : 'attestationReportingScore'
          if (existingData[scoreField] !== undefined) {
            setScore(String(existingData[scoreField]))
          }
          if (existingData.attestationComment !== undefined) {
            setComment(existingData.attestationComment || '')
          }
        }
      } catch (error) {
        console.error('Error checking for existing attestation:', error)
        // Don't show error to user, just continue without auto-population
      } finally {
        setCheckingExisting(false)
      }
    }

    checkExistingAttestation()
  }, [open, milestone, account, projectId, folderId, snapshotId, blockId, attestationType])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // NOTE: Smart wallet is required for gasless EAS attestations
    // This implementation uses regular wallet - smart wallet integration needed for production
    if (!account) {
      setStatus('❌ Wallet not connected. Please connect your wallet.')
      return
    }

    if (!milestone) {
      setStatus('❌ Milestone data not available')
      return
    }

    const scoreNum = parseInt(score, 10)
    if (isNaN(scoreNum) || scoreNum < 1 || scoreNum > 100) {
      setStatus('❌ Score must be between 1 and 100')
      return
    }

    setIsSubmitting(true)
    setLoadingData(true)
    setStatus('🔄 Loading milestone data...')

    try {
      // Extract all EAS schema fields
      
      // 1. milestoneSummary - truncate to 500-600 chars
      const milestoneSummary = milestone.summary 
        ? milestone.summary.substring(0, 600) 
        : ''

      // 2. Load snapshot manifest for icfHash and icfUrl
      const manifestPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}`
      const manifestRef = doc(db, manifestPath)
      const manifestSnap = await getDoc(manifestRef)

      if (!manifestSnap.exists()) {
        throw new Error('Snapshot manifest not found')
      }

      const manifestData = manifestSnap.data()
      let icfHash = manifestData.icfHash || ''
      const icfUrl = manifestData.icfUrl || ''

      if (!icfHash || !icfUrl) {
        throw new Error('Immutable content hash or URL not found in snapshot manifest')
      }

      // Ensure icfHash is properly formatted for bytes32 (32 bytes = 64 hex chars)
      // Remove 0x prefix if present, then ensure it's exactly 64 hex characters
      let hashHex = icfHash.replace(/^0x/, '').toLowerCase()
      
      // Validate it's a valid hex string
      if (!/^[0-9a-f]+$/.test(hashHex)) {
        throw new Error('Invalid hex string in icfHash')
      }
      
      if (hashHex.length > 64) {
        // Truncate if too long
        hashHex = hashHex.substring(0, 64)
      } else if (hashHex.length < 64) {
        // Pad with zeros if too short
        hashHex = hashHex.padEnd(64, '0')
      }
      
      // Use hexlify to ensure proper formatting for bytes32
      icfHash = ethers.hexlify('0x' + hashHex)

      // 3. Find milestoneIndex by loading general table and finding matching row
      setStatus('🔄 Finding milestone index...')
      
      // Find the general table block
      const blocksPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks`
      const blocksRef = collection(db, blocksPath)
      const blocksSnap = await getDocs(blocksRef)
      
      let generalTableBlockId = blockId
      blocksSnap.forEach((docSnap) => {
        const blockData = docSnap.data()
        if (blockData['block-type'] === 'karma-report' && blockData['karma-subtype'] === 'karma-general-table') {
          generalTableBlockId = docSnap.id
        }
      })

      // Load general table data
      const tableDataPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks/${generalTableBlockId}/table-data/karma-general-table`
      const tableDataRef = doc(db, tableDataPath)
      const tableDataSnap = await getDoc(tableDataRef)

      if (!tableDataSnap.exists()) {
        throw new Error('General table data not found')
      }

      const tableData = tableDataSnap.data()
      const rows = tableData.rows || []

      // Find matching row by officialDate and summary
      let milestoneIndex = -1
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row.officialDate === milestone.officialDate && row.summary === milestone.summary) {
          milestoneIndex = i
          break
        }
      }

      // Fallback: try matching by summary only
      if (milestoneIndex === -1 && milestone.summary) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          if (row.summary === milestone.summary) {
            milestoneIndex = i
            break
          }
        }
      }

      if (milestoneIndex === -1) {
        throw new Error('Milestone not found in general table')
      }

      // 4. discussionId - empty string for now
      const discussionId = ''

      setStatus('🔄 Preparing attestation...')

      // EAS contract address on Base
      const EAS_CONTRACT_ADDRESS = '0x4200000000000000000000000000000000000021'
      
      // NOTE: Smart wallet is required for gasless transactions via paymaster
      // This implementation uses regular wallet - transactions will require gas
      // For production, integrate smart wallet solution (Privy, Biconomy, ZeroDev, etc.)
      
      const anyWindow = window as any
      if (!anyWindow.ethereum) {
        throw new Error('Ethereum provider not found. Please install MetaMask or another wallet.')
      }
      
      // Switch to Base network if needed
      try {
        await anyWindow.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x2105' }], // Base mainnet chain ID in hex
        })
      } catch (switchError: any) {
        // If chain doesn't exist, add it
        if (switchError.code === 4902) {
          try {
            await anyWindow.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x2105',
                chainName: 'Base',
                nativeCurrency: {
                  name: 'ETH',
                  symbol: 'ETH',
                  decimals: 18,
                },
                rpcUrls: ['https://mainnet.base.org'],
                blockExplorerUrls: ['https://basescan.org'],
              }],
            })
          } catch (addError) {
            throw new Error('Failed to add Base network to wallet')
          }
        } else {
          throw switchError
        }
      }
      
      const provider = new ethers.BrowserProvider(anyWindow.ethereum)
      const signer = await provider.getSigner()
      const walletAddress = await signer.getAddress()

      // Initialize EAS
      const eas = new EAS(EAS_CONTRACT_ADDRESS)
      eas.connect(signer)

      // Determine schema and field names based on attestation type
      const isReporting = attestationType === 'reporting'
      const schemaString = isReporting
        ? 'uint8 scoreReporting,string comment,string milestoneSummary,string projectId,string folderId,string snapshotId,uint16 milestoneIndex,string discussionId,bytes32 ImmutableContentHash,string ImmutableContentUrl'
        : 'uint8 scoreOutcomes,string comment,string milestoneSummary,string projectId,string folderId,string snapshotId,uint16 milestoneIndex,string discussionId,bytes32 ImmutableContentHash,string ImmutableContentUrl'
      
      const easScoreFieldName = isReporting ? 'scoreReporting' : 'scoreOutcomes'
      const schemaUID = isReporting ? EAS_SCHEMA_UIDS.MILESTONE_REPORTING : EAS_SCHEMA_UIDS.MILESTONE_OUTCOMES

      // Encode schema data
      const schemaEncoder = new SchemaEncoder(schemaString)

      const encodedData = schemaEncoder.encodeData([
        { name: easScoreFieldName, value: scoreNum, type: 'uint8' },
        { name: 'comment', value: comment || '', type: 'string' },
        { name: 'milestoneSummary', value: milestoneSummary, type: 'string' },
        { name: 'projectId', value: projectId, type: 'string' },
        { name: 'folderId', value: folderId, type: 'string' },
        { name: 'snapshotId', value: snapshotId, type: 'string' },
        { name: 'milestoneIndex', value: milestoneIndex, type: 'uint16' },
        { name: 'discussionId', value: discussionId, type: 'string' },
        { name: 'ImmutableContentHash', value: icfHash, type: 'bytes32' },
        { name: 'ImmutableContentUrl', value: icfUrl, type: 'string' },
      ])

      setStatus('🔄 Creating attestation on-chain...')
      // NOTE: Regular wallets require gas. For gasless transactions, integrate smart wallet with paymaster.

      // Create attestation
      // Revocability is set at schema level, default to true
      const tx = await eas.attest({
        schema: schemaUID,
        data: {
          recipient: '0x0000000000000000000000000000000000000000', // Zero address
          revocable: true, // Default: revocable (as per blueprint)
          data: encodedData,
        },
      })

      setStatus('🔄 Waiting for transaction confirmation...')

      // EAS SDK's wait() method returns the attestation UID directly
      const attestationUID = await tx.wait()

      setAttestationUID(attestationUID)

      // Extract user display name from wallet address
      const attesterDisplayName = walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 4)
      const attesterWallet = walletAddress

      // Store attestation in Firestore
      setStatus('🔄 Storing attestation in Firestore...')

      const attestationDocId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      const attestationPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/attestations/${attestationDocId}`

      // Clean images object to remove undefined values (Firestore doesn't accept undefined)
      let cleanedImages: any = undefined
      if (milestone.images) {
        cleanedImages = {}
        if (milestone.images.main) cleanedImages.main = milestone.images.main
        if (milestone.images.image2) cleanedImages.image2 = milestone.images.image2
        if (milestone.images.image3) cleanedImages.image3 = milestone.images.image3
        // Only include images object if it has at least one image
        if (Object.keys(cleanedImages).length === 0) {
          cleanedImages = undefined
        }
      }

      // Determine Firestore field names based on attestation type
      const attestationTypeKey = isReporting ? 'milestone-reporting' : 'milestone-outcomes'
      const scoreFieldName = isReporting ? 'attestationReportingScore' : 'attestationOutcomesScore'

      // Check if there's an existing attestation to replace
      const oldAttestationDocId = existingAttestation?.docId || null

      await setDoc(doc(db, attestationPath), {
        // Document Type
        type: 'attestation',
        attestationType: attestationTypeKey,
        
        // Identifiers
        projectId: projectId,
        folderId: folderId,
        snapshotId: snapshotId,
        milestoneIndex: milestoneIndex,
        ImmutableContentHash: icfHash,
        
        // Milestone Content
        milestoneSummary: milestoneSummary,
        milestoneOfficialDate: milestone.officialDate || '',
        notes: milestone.notes || '',
        proofs: milestone.proofs || [],
        ...(cleanedImages && { images: cleanedImages }),
        
        // Attestation Data (type-specific score field)
        [scoreFieldName]: scoreNum,
        attestationComment: comment || '',
        attesterSmartWallet: walletAddress, // NOTE: Should be smart wallet address for production
        attesterWallet: attesterWallet,
        attesterExtraInfo: attesterDisplayName,
        
        // Linking
        ImmutableContentUrl: icfUrl,
        discussionId: discussionId,
        
        // EAS Data
        attestationEasUID: attestationUID,
        easExplorerUrl: getAttestationExplorerUrl(attestationUID),
        easSchemaUID: schemaUID,
        
        // Revocation
        revocable: true, // Default: revocable (as per blueprint)
        revoked: false,
        revokedAt: null,
        revokedBy: null,
        
        // Re-attestation
        replacedBy: null,
        replaces: oldAttestationDocId, // Link to old attestation if replacing
        
        // Query Helpers
        isActive: true,
        
        // Metadata
        createdAt: serverTimestamp(),
      })

      // If replacing an old attestation, update it to mark as replaced
      if (oldAttestationDocId) {
        setStatus('🔄 Updating previous attestation...')
        const oldAttestationPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/attestations/${oldAttestationDocId}`
        await updateDoc(doc(db, oldAttestationPath), {
          isActive: false,
          replacedBy: attestationDocId, // Link to new attestation
        })
      }

      setStatus('✅ Attestation stored onchain!')
      setIsSubmitting(false)
      setLoadingData(false)

    } catch (error) {
      console.error('Error creating attestation:', error)
      setStatus(`❌ Error: ${error instanceof Error ? error.message : 'Failed to create attestation'}`)
      setIsSubmitting(false)
      setLoadingData(false)
    }
  }

  const milestoneSummaryPreview = milestone?.summary 
    ? milestone.summary.substring(0, 500) + (milestone.summary.length > 500 ? '...' : '')
    : 'No summary available'

  return (
    <>
      {/* Confetti effect - rendered at highest z-index to appear above all modals */}
      {showConfetti && windowDimensions.width > 0 && (
        <div className="fixed inset-0 z-[100] pointer-events-none">
          <Confetti
            width={windowDimensions.width}
            height={windowDimensions.height}
            recycle={false}
            numberOfPieces={200}
            gravity={0.3}
          />
        </div>
      )}
      
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70] p-4">
        <div className="bg-white rounded-xl max-w-2xl w-full h-[90vh] flex flex-col overflow-hidden">
          <div className="flex-1 flex flex-col p-4 min-h-0">
            {/* Show success screen if attestation is complete, otherwise show form */}
            {attestationUID ? (
              <>
                <div className="flex justify-end mb-4">
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Success screen - only content shown after attestation */}
                <div className="p-6 bg-green-50 border-2 border-green-500 rounded-lg text-center">
                  <div className="mb-4">
                    <svg className="w-16 h-16 mx-auto text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-green-800 mb-2">Transaction Complete!</h3>
                  <p className="text-green-700 mb-6">You're all set. Your attestation was created successfully!</p>
                  
                  {/* Prominent EAS Explorer link */}
                  <a
                    href={getAttestationExplorerUrl(attestationUID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors mb-4"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View on EAS Explorer
                  </a>

                  {/* Close button */}
                  <button
                    onClick={onClose}
                    className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-2xl font-bold text-gray-900">
                    Attest to Milestone {attestationType === 'outcomes' ? 'Outcomes' : 'Reporting'}
                  </h2>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    disabled={isSubmitting}
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Milestone Summary Preview */}
                <div className="mb-2 p-3 bg-gray-50 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Milestone Summary (for context):</h3>
                  <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{milestoneSummaryPreview}</p>
                </div>

                {/* Warning if existing attestation found */}
                {existingAttestation && (
                  <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-800">
                      <span className="font-semibold">Note:</span> You've already attested to this. Submitting will create a new attestation.
                    </p>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 space-y-2">
              {/* Score Input */}
              <div>
                <label htmlFor="score" className="block text-sm font-medium text-gray-700 mb-2">
                  Score (1-100) <span className="text-red-500">*</span>
                </label>
                <input
                  id="score"
                  type="number"
                  min="1"
                  max="100"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  required
                  disabled={isSubmitting}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed text-black"
                  placeholder="Enter score from 1 to 100"
                />
              </div>

              {/* Comment Input */}
              <div>
                <label htmlFor="comment" className="block text-sm font-medium text-gray-700 mb-2">
                  Comment (optional)
                </label>
                <textarea
                  id="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={isSubmitting}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed text-black resize-none"
                  placeholder="Add any additional comments about this milestone..."
                />
              </div>

                  {/* Show status only for errors or loading */}
                  {status && !status.startsWith('✅') && (
                    <div className={`p-3 rounded-lg ${
                      status.startsWith('❌')
                        ? 'bg-red-50 text-red-800' 
                        : 'bg-blue-50 text-blue-800'
                    }`}>
                      <p className="text-sm font-medium">{status}</p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-2 border-t border-gray-200 mt-auto">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={isSubmitting}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !score || checkingExisting}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                    >
                      {checkingExisting
                        ? 'Checking...'
                        : isSubmitting
                          ? 'Creating Attestation...'
                          : existingAttestation
                            ? 'Update Attestation'
                            : 'Create Attestation'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

