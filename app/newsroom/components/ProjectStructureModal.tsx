'use client'

import React, { useEffect, useState } from 'react'
import { getFirestore, collection, query, getDocs, orderBy, doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { initializeApp, getApps } from 'firebase/app'

// Firebase config (same as NewsroomApp)
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
  parentId: string | null
  path: string
  order?: number
}

type Artifact = {
  id: string
  name: string
  folderId: string | null
  artifact_type: string
}

type TreeNode = {
  id: string
  name: string
  type: 'folder' | 'artifact'
  parentId: string | null
  path: string
  children: TreeNode[]
  expanded?: boolean
  artifact_type?: string
}

type Props = {
  open: boolean
  onClose: () => void
  projectId: string
  onFolderClick?: (folderId: string, folderName: string) => void
}

export function ProjectStructureModal({ open, onClose, projectId, onFolderClick }: Props) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)

  // Load folders and artifacts from Firestore
  useEffect(() => {
    if (!open || !projectId) return

    const loadStructure = async () => {
      setLoading(true)
      try {
        // Load folders - use simple query to avoid index requirement
        const foldersRef = collection(db, 'newsroom', projectId, 'folders')
        const foldersQuery = query(foldersRef, orderBy('name', 'asc'))
        const foldersSnap = await getDocs(foldersQuery)
        const foldersData: Folder[] = []
        foldersSnap.forEach((doc) => {
          foldersData.push({
            id: doc.id,
            ...doc.data(),
          } as Folder)
        })
        
        // Sort by order manually if needed
        foldersData.sort((a, b) => {
          if (a.parentId !== b.parentId) {
            // Group by parent first
            if (a.parentId === null) return -1
            if (b.parentId === null) return 1
            return (a.parentId || '').localeCompare(b.parentId || '')
          }
          // Then by order, then by name
          const orderDiff = (a.order || 0) - (b.order || 0)
          return orderDiff !== 0 ? orderDiff : a.name.localeCompare(b.name)
        })
        
        setFolders(foldersData)

        // Load artifacts
        const artifactsRef = collection(db, 'newsroom', projectId, 'artifacts')
        const artifactsQuery = query(artifactsRef, orderBy('name', 'asc'))
        const artifactsSnap = await getDocs(artifactsQuery)
        const artifactsData: Artifact[] = []
        artifactsSnap.forEach((doc) => {
          artifactsData.push({
            id: doc.id,
            ...doc.data(),
          } as Artifact)
        })
        setArtifacts(artifactsData)

        // Build tree structure
        buildTree(foldersData, artifactsData, expandedIds)
      } catch (error) {
        console.error('Error loading project structure:', error)
      } finally {
        setLoading(false)
      }
    }

    loadStructure()
  }, [open, projectId])

  const buildTree = (foldersData: Folder[], artifactsData: Artifact[], expandedSet: Set<string>) => {
    // Create a map of all nodes
    const nodeMap = new Map<string, TreeNode>()

    // Add folders to map
    foldersData.forEach((folder) => {
      nodeMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        type: 'folder',
        parentId: folder.parentId,
        path: folder.path,
        children: [],
        expanded: expandedSet.has(folder.id),
      })
    })

    // Add artifacts to map
    artifactsData.forEach((artifact) => {
      nodeMap.set(artifact.id, {
        id: artifact.id,
        name: artifact.name,
        type: 'artifact',
        parentId: artifact.folderId,
        path: artifact.folderId ? `${foldersData.find((f) => f.id === artifact.folderId)?.path}/${artifact.name}` : artifact.name,
        children: [],
        artifact_type: artifact.artifact_type,
      })
    })

    // Build tree hierarchy
    const rootNodes: TreeNode[] = []
    nodeMap.forEach((node) => {
      if (node.parentId === null) {
        rootNodes.push(node)
      } else {
        const parent = nodeMap.get(node.parentId)
        if (parent) {
          parent.children.push(node)
        } else {
          // Parent not found, treat as root
          rootNodes.push(node)
        }
      }
    })

    // Sort children: folders first, then artifacts
    const sortChildren = (nodes: TreeNode[]) => {
      nodes.forEach((node) => {
        node.children.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })
        sortChildren(node.children)
      })
    }

    sortChildren(rootNodes)
    setTree(rootNodes)
  }

  const toggleExpand = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      // Rebuild tree with new expanded state
      buildTree(folders, artifacts, next)
      return next
    })
  }

  const handleFolderClick = (node: TreeNode, e: React.MouseEvent) => {
    e.stopPropagation()
    // Any folder can be clicked to show its content
    if (onFolderClick) {
      onFolderClick(node.id, node.name)
    }
  }

  // Convert folder name to a valid Firestore document ID (slug)
  const nameToSlug = (name: string): string => {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dashes
      .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
      .substring(0, 50) // Limit length
  }

  const calculatePath = (name: string, parentId: string | null): string => {
    if (!parentId) return name
    const parent = folders.find((f) => f.id === parentId)
    return parent ? `${parent.path}/${name}` : name
  }

  const createFolder = async () => {
    if (!newFolderName.trim() || creatingFolder) return

    setCreatingFolder(true)
    try {
      const foldersRef = collection(db, 'newsroom', projectId, 'folders')
      const folderSlug = nameToSlug(newFolderName.trim())
      
      // Check if folder with this slug already exists
      const existingFolderRef = doc(foldersRef, folderSlug)
      const existingFolder = folders.find((f) => f.id === folderSlug)
      if (existingFolder) {
        alert(`A folder with the name "${folderSlug}" already exists. Please choose a different name.`)
        setCreatingFolder(false)
        return
      }

      const path = calculatePath(newFolderName.trim(), selectedParentId)
      
      const newFolder = {
        name: newFolderName.trim(),
        parentId: selectedParentId,
        path: path,
        order: folders.filter((f) => f.parentId === selectedParentId).length,
        createdAt: serverTimestamp(),
        createdBy: 'user', // TODO: Get actual user ID
      }

      console.log('Creating folder:', { projectId, folderSlug, path: `newsroom/${projectId}/folders/${folderSlug}`, newFolder })
      
      // Use setDoc with custom document ID (slug)
      await setDoc(existingFolderRef, newFolder)
      console.log('Folder created successfully')

      // Reload structure - use simpler query to avoid index requirement
      // Just order by name, which should have a default index
      const foldersSnap = await getDocs(query(foldersRef, orderBy('name', 'asc')))
      const foldersData: Folder[] = []
      foldersSnap.forEach((doc) => {
        foldersData.push({
          id: doc.id,
          ...doc.data(),
        } as Folder)
      })
      
      // Sort by order manually if needed
      foldersData.sort((a, b) => {
        if (a.parentId !== b.parentId) {
          // Group by parent first
          if (a.parentId === null) return -1
          if (b.parentId === null) return 1
          return a.parentId.localeCompare(b.parentId)
        }
        // Then by order, then by name
        const orderDiff = (a.order || 0) - (b.order || 0)
        return orderDiff !== 0 ? orderDiff : a.name.localeCompare(b.name)
      })
      
      setFolders(foldersData)
      buildTree(foldersData, artifacts, expandedIds)

      // Reset form
      setNewFolderName('')
      setSelectedParentId(null)
      setShowCreateFolder(false)
    } catch (error: any) {
      console.error('Error creating folder:', error)
      const errorMessage = error?.message || 'Unknown error occurred'
      const errorCode = error?.code || 'unknown'
      
      // Don't show error if folder was actually created (check if it's just an index error)
      if (errorCode === 'failed-precondition' && errorMessage.includes('index')) {
        // Folder was created, but query failed - reload without the problematic query
        console.log('Folder created but query requires index. Reloading structure...')
        try {
          const foldersRef = collection(db, 'newsroom', projectId, 'folders')
          const foldersSnap = await getDocs(foldersRef) // No orderBy to avoid index requirement
          const foldersData: Folder[] = []
          foldersSnap.forEach((doc) => {
            foldersData.push({
              id: doc.id,
              ...doc.data(),
            } as Folder)
          })
          setFolders(foldersData)
          buildTree(foldersData, artifacts, expandedIds)
          setNewFolderName('')
          setSelectedParentId(null)
          setShowCreateFolder(false)
          return
        } catch (reloadError) {
          console.error('Error reloading structure:', reloadError)
        }
      }
      
      alert(`Failed to create folder: ${errorMessage} (Code: ${errorCode})`)
    } finally {
      setCreatingFolder(false)
    }
  }

  // Get all folders for parent selection (flattened list)
  const getAllFolders = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = []
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        result.push(node)
        result.push(...getAllFolders(node.children))
      }
    })
    return result
  }

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedIds.has(node.id)
    const hasChildren = node.children.length > 0
    const indent = depth * 20
    const isFolder = node.type === 'folder'

    return (
      <div key={node.id}>
        <div
          className={`flex items-center py-1 px-2 rounded ${
            isFolder && onFolderClick ? 'hover:bg-blue-900/50' : 'hover:bg-gray-700'
          }`}
          style={{ paddingLeft: `${indent + 8}px` }}
        >
          {/* Expand/Collapse Arrow */}
          {node.type === 'folder' && (
            <div 
              className="w-4 h-4 flex items-center justify-center mr-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                if (hasChildren) {
                  toggleExpand(node.id, e)
                }
              }}
            >
              {hasChildren ? (
                <svg
                  className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              ) : (
                <div className="w-3 h-3" />
              )}
            </div>
          )}
          {node.type === 'artifact' && <div className="w-4 mr-1" />}

          {/* Icon */}
          {node.type === 'folder' ? (
            <svg className="w-4 h-4 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}

          {/* Name - Clickable for folders */}
          {isFolder && onFolderClick ? (
            <span 
              className="text-sm flex-1 truncate text-blue-300 font-medium cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                handleFolderClick(node, e)
              }}
            >
              {node.name}
            </span>
          ) : (
            <span className="text-sm flex-1 truncate text-gray-300">
              {node.name}
            </span>
          )}

          {/* Artifact type badge */}
          {node.type === 'artifact' && node.artifact_type && (
            <span className="text-xs text-gray-500 ml-2 px-1.5 py-0.5 bg-gray-800 rounded">
              {node.artifact_type}
            </span>
          )}
        </div>

        {/* Render children if expanded */}
        {node.type === 'folder' && isExpanded && hasChildren && (
          <div>{node.children.map((child) => renderTreeNode(child, depth + 1))}</div>
        )}
      </div>
    )
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-200">Project Structure</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-gray-400">Loading structure...</div>
            </div>
          ) : tree.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="mb-2">No folders or artifacts yet</p>
              <p className="text-sm">Create folders and artifacts to see them here</p>
            </div>
          ) : (
            <div className="space-y-1">
              {tree.map((node) => renderTreeNode(node))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex items-center justify-between">
          <button
            onClick={() => setShowCreateFolder(!showCreateFolder)}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm"
          >
            {showCreateFolder ? 'Cancel' : 'Create Sub-folder'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 transition-colors"
          >
            Close
          </button>
        </div>

        {/* Create Folder Form */}
        {showCreateFolder && (
          <div className="p-4 border-t border-gray-700 bg-gray-800">
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Folder Name</label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Enter folder name"
                  className="w-full px-3 py-2 bg-gray-700 text-gray-200 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      createFolder()
                    } else if (e.key === 'Escape') {
                      setShowCreateFolder(false)
                    }
                  }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Parent Folder (optional)</label>
                <select
                  value={selectedParentId || ''}
                  onChange={(e) => setSelectedParentId(e.target.value || null)}
                  className="w-full px-3 py-2 bg-gray-700 text-gray-200 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Root level</option>
                  {getAllFolders(tree).map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.path}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={createFolder}
                disabled={!newFolderName.trim() || creatingFolder}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creatingFolder ? 'Creating...' : 'Create Folder'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

