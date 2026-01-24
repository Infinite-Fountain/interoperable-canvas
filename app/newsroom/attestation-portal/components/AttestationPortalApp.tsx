'use client'

/**
 * NOTE: This component has been adapted from the source to use wallet-based authentication
 * instead of Privy. Some features are simplified or removed:
 * - Simulated users functionality removed (Privy-specific)
 * - Authorization uses wallet address instead of Privy user ID
 * - Smart wallet features require additional setup for EAS attestations
 */

import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import ConnectWalletButton from '../../../interoperable-canvas/components/ConnectWalletButton'
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'
import { initializeApp, getApps } from 'firebase/app'
import { ProjectStructureModal } from './ProjectStructureModal'
import { AttestationPortalView } from './AttestationPortalView'

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
  projectId: string
  initialFolderId?: string | null
  initialSnapshotId?: string | null
}

export function AttestationPortalApp({
  projectId,
  initialFolderId,
  initialSnapshotId,
}: Props) {
  const [account, setAccount] = useState<string | null>(null)
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null) // null = checking, true = authorized, false = not authorized
  const [showProjectStructureModal, setShowProjectStructureModal] = useState(!initialSnapshotId)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(initialFolderId || null)
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(initialSnapshotId || null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [ownerWallet, setOwnerWallet] = useState<string | null>(null)

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

  // Authorization check: verify wallet address is in project members
  useEffect(() => {
    if (!projectId || !account) {
      setIsAuthorized(null)
      return
    }

    // Check membership in Firestore
    // Members are stored at project level: newsroom/{projectId}/members/{walletAddress}
    // User must have role 'owner', 'wisdomCouncil', or 'attester'
    const checkAuthorization = async () => {
      try {
        // Use wallet address as user ID
        const walletAddress = account.toLowerCase()
        const memberPath = ['newsroom', projectId, 'members', walletAddress]
        const memberRef = doc(db, memberPath.join('/'))
        const memberSnap = await getDoc(memberRef)
        
        if (memberSnap.exists()) {
          const memberData = memberSnap.data()
          // Check if user has owner, wisdomCouncil, or attester role
          // Support both old format (single role) and new format (roles array)
          const roles = memberData.roles || (memberData.role ? [memberData.role] : [])
          const isAuthorized = roles.includes('owner') || 
                               roles.includes('wisdomCouncil') || 
                               roles.includes('attester')
          console.log('[AttestationPortalApp] User roles:', roles, 'Authorized:', isAuthorized)
          setIsAuthorized(isAuthorized)
        } else {
          console.log('[AttestationPortalApp] Member not found for wallet:', walletAddress)
          setIsAuthorized(false)
        }
      } catch (error) {
        console.error('[AttestationPortalApp] Authorization check failed:', error)
        setIsAuthorized(false)
      }
    }

    checkAuthorization()
  }, [projectId, account])

  // Determine if user can view content (authorized)
  const canView = isAuthorized === true

  // Load project name and owner wallet
  useEffect(() => {
    if (!projectId) return
    
    const loadProject = async () => {
      try {
        const projectRef = doc(db, 'newsroom', projectId)
        const projectSnap = await getDoc(projectRef)
        if (projectSnap.exists()) {
          const data = projectSnap.data()
          setProjectName(data.name || projectId)
          setOwnerWallet(data.ownerWallet || data.ownerPrivyId || null)
        } else {
          setProjectName(projectId)
          setOwnerWallet(null)
        }
      } catch (error) {
        console.error('Error loading project:', error)
        setProjectName(projectId)
        setOwnerWallet(null)
      }
    }
    loadProject()
  }, [projectId])

  // Check if current user is owner
  const isOwner = account && ownerWallet && account.toLowerCase() === ownerWallet.toLowerCase()

  // Load folder name
  useEffect(() => {
    const loadFolder = async () => {
      if (!selectedFolderId) {
        setFolderName(null)
        return
      }
      try {
        const folderRef = doc(db, 'newsroom', projectId, 'folders', selectedFolderId)
        const folderSnap = await getDoc(folderRef)
        if (folderSnap.exists()) {
          const data = folderSnap.data()
          setFolderName(data.name || selectedFolderId)
        } else {
          setFolderName(selectedFolderId)
        }
      } catch (error) {
        console.error('Error loading folder:', error)
        setFolderName(selectedFolderId)
      }
    }
    loadFolder()
  }, [projectId, selectedFolderId])

  const handleFolderClick = (folderId: string) => {
    setSelectedFolderId(folderId)
    // Keep modal open to show snapshots
  }

  const handleSnapshotClick = (snapshotId: string) => {
    setSelectedSnapshotId(snapshotId)
    setShowProjectStructureModal(false)
    // Update URL to include snapshot
    const url = new URL(window.location.href)
    url.searchParams.set('folderId', selectedFolderId || '')
    url.searchParams.set('snapshotId', snapshotId)
    window.history.pushState({}, '', url.toString())
  }

  const handleBackToStructure = () => {
    setSelectedSnapshotId(null)
    setSelectedFolderId(null)
    setShowProjectStructureModal(true)
  }

  return (
    <div className="min-h-screen flex bg-gray-800">
      {/* Left Panel - Same dimensions as newsroom (w-36 = 144px) */}
      <div className="fixed left-0 top-0 h-screen w-36 p-4 bg-gray-900 flex flex-col gap-3 overflow-y-auto">
        <ConnectWalletButton />
        
        {/* Project Structure Button */}
        {canView && (
          <button
            className="w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
            onClick={() => setShowProjectStructureModal(true)}
            title="View project folder structure"
          >
            Project Structure
          </button>
        )}
      </div>

      {/* Alert for logged in but not authorized users */}
      {account && isAuthorized === false && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg">
          You are not authorized to view this attestation portal. Only owners, wisdom council members, and attesters can access this project.
        </div>
      )}

      {/* Right Panel - Rest of space (flex-1 ml-36) */}
      <div className="flex-1 ml-36 overflow-hidden">
        {!account ? (
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <p className="text-gray-400 mb-4">Please connect your wallet to access the attestation portal</p>
            </div>
          </div>
        ) : isAuthorized === null ? (
          <div className="flex items-center justify-center h-screen text-gray-400">
            Checking authorization…
          </div>
        ) : !canView ? (
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <p className="text-red-400 mb-4">You are not authorized to view this attestation portal.</p>
              <p className="text-gray-400 text-sm">Only owners, wisdom council members, and attesters can access this project.</p>
            </div>
          </div>
        ) : (
        <div className="min-h-screen flex flex-col">
          {/* Content container with margins (left, top, right) */}
          <div className="flex-1 relative mx-[20px] mt-[20px] pb-[20px] bg-gray-800 min-h-[calc(100vh-20px)]">
            {/* Content area */}
            <div className="p-6 relative z-10">
              {/* Page header */}
              {selectedSnapshotId && selectedFolderId && (
                <div className="mb-6 pb-4 border-b border-gray-700">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleBackToStructure}
                      className="text-gray-400 hover:text-gray-200 transition-colors"
                      title="Back to structure"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                    </button>
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
                    </svg>
                    <h2 className="text-2xl font-semibold text-gray-200">
                      {projectName || projectId}/{folderName || selectedFolderId}/{selectedSnapshotId}
                    </h2>
                  </div>
                </div>
              )}

              {/* Main Content */}
              {selectedSnapshotId && selectedFolderId ? (
                <AttestationPortalView
                  projectId={projectId}
                  folderId={selectedFolderId}
                  snapshotId={selectedSnapshotId}
                />
              ) : (
                <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
                  <div className="text-center">
                    <p className="text-gray-400 mb-4">Select a folder and snapshot to begin attestation</p>
                    <button
                      onClick={() => setShowProjectStructureModal(true)}
                      className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                    >
                      Open Project Structure
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Project Structure Modal */}
      {canView && (
        <ProjectStructureModal
        open={showProjectStructureModal}
        onClose={() => {
          if (!selectedSnapshotId) {
            setShowProjectStructureModal(false)
          }
        }}
        projectId={projectId}
        selectedFolderId={selectedFolderId}
        onFolderClick={handleFolderClick}
        onSnapshotClick={handleSnapshotClick}
        />
      )}

    </div>
  )
}
