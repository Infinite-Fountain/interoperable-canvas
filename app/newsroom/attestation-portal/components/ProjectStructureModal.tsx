'use client'

import React, { useEffect, useState } from 'react'
import { getFirestore, collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore'
import { initializeApp, getApps } from 'firebase/app'

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

type Folder = {
  id: string
  name: string
}

type Snapshot = {
  id: string
  snapshotId: string
  createdAt: any
  status: string
  icfHash?: string
}

type Props = {
  open: boolean
  onClose: () => void
  projectId: string
  selectedFolderId: string | null
  onFolderClick: (folderId: string) => void
  onSnapshotClick: (snapshotId: string) => void
}

export function ProjectStructureModal({
  open,
  onClose,
  projectId,
  selectedFolderId,
  onFolderClick,
  onSnapshotClick,
}: Props) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)

  // Load folders
  useEffect(() => {
    if (!open || !projectId) return

    const loadFolders = async () => {
      setLoading(true)
      try {
        const foldersRef = collection(db, 'newsroom', projectId, 'folders')
        const foldersSnap = await getDocs(foldersRef)
        
        const foldersList: Folder[] = []
        foldersSnap.forEach((doc) => {
          const data = doc.data()
          foldersList.push({
            id: doc.id,
            name: data.name || doc.id,
          })
        })

        // Sort by name
        foldersList.sort((a, b) => a.name.localeCompare(b.name))
        setFolders(foldersList)
      } catch (error) {
        console.error('Error loading folders:', error)
      } finally {
        setLoading(false)
      }
    }

    loadFolders()
  }, [open, projectId])

  // Load snapshots when folder is selected
  useEffect(() => {
    if (!open || !projectId || !selectedFolderId) {
      setSnapshots([])
      return
    }

    const loadSnapshots = async () => {
      setLoadingSnapshots(true)
      try {
        const snapshotsRef = collection(
          db,
          'newsroom',
          projectId,
          'folders',
          selectedFolderId,
          'snapshots'
        )
        const snapshotsSnap = await getDocs(query(snapshotsRef, orderBy('createdAt', 'desc')))
        
        const snapshotsList: Snapshot[] = []
        snapshotsSnap.forEach((doc) => {
          const data = doc.data()
          snapshotsList.push({
            id: doc.id,
            snapshotId: data.snapshotId || doc.id,
            createdAt: data.createdAt,
            status: data.status || 'unknown',
            icfHash: data.icfHash,
          })
        })

        setSnapshots(snapshotsList)
      } catch (error) {
        console.error('Error loading snapshots:', error)
        setSnapshots([])
      } finally {
        setLoadingSnapshots(false)
      }
    }

    loadSnapshots()
  }, [open, projectId, selectedFolderId])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Project Structure</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Folders List */}
          <div className="w-1/2 border-r border-gray-200 overflow-y-auto">
            <div className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                Folders
              </h3>
              {loading ? (
                <div className="text-center py-8 text-gray-500">Loading folders...</div>
              ) : folders.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No folders found</div>
              ) : (
                <div className="space-y-1">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => onFolderClick(folder.id)}
                      className={`w-full text-left px-4 py-3 rounded-md transition-colors ${
                        selectedFolderId === folder.id
                          ? 'bg-blue-100 text-blue-900 font-medium'
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                          />
                        </svg>
                        <span>{folder.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Snapshots List */}
          <div className="w-1/2 overflow-y-auto">
            <div className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                {selectedFolderId ? 'Snapshots' : 'Select a folder'}
              </h3>
              {!selectedFolderId ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Select a folder to view snapshots
                </div>
              ) : loadingSnapshots ? (
                <div className="text-center py-8 text-gray-500">Loading snapshots...</div>
              ) : snapshots.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No snapshots found in this folder
                </div>
              ) : (
                <div className="space-y-2">
                  {snapshots.map((snapshot) => (
                    <button
                      key={snapshot.id}
                      onClick={() => onSnapshotClick(snapshot.snapshotId)}
                      className="w-full text-left px-4 py-3 rounded-md border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <code className="text-xs font-mono text-gray-900 bg-gray-100 px-2 py-1 rounded">
                            {snapshot.snapshotId}
                          </code>
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              snapshot.status === 'complete'
                                ? 'bg-green-100 text-green-700'
                                : snapshot.status === 'partial'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {snapshot.status}
                          </span>
                        </div>
                        {snapshot.createdAt && (
                          <div className="text-xs text-gray-500">
                            {snapshot.createdAt.toDate
                              ? snapshot.createdAt.toDate().toLocaleString()
                              : new Date(snapshot.createdAt).toLocaleString()}
                          </div>
                        )}
                        {snapshot.icfHash && (
                          <div className="text-xs text-gray-400 font-mono truncate">
                            Hash: {snapshot.icfHash.substring(0, 16)}...
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
