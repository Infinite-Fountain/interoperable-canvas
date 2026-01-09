'use client'

import React, { useState, useEffect } from 'react'
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit, serverTimestamp } from 'firebase/firestore'
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { initializeApp, getApps } from 'firebase/app'
import { MilestoneViewer, type MilestoneData } from '../milestone-viewer'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

interface KarmaGeneralTableBlockProps {
  blockId: string
  projectId: string
  folderId: string
  onEditClick?: () => void
}

interface ProofLink {
  title: string
  url: string
}

interface DeliverableRow {
  slug: string
  title: string
  description: string
  proof: string
  startDate: string // Original ISO date string
  endDate: string // Original ISO date string
  createdAt: string // Original ISO date string
  updatedAt: string // Original ISO date string
  dueDate: string // Original ISO date string (for milestones)
  completedAt: string // Original ISO date string (for milestones)
  status: string // pending, completed, or n/a
  officialDate: string
  addProof?: string // Manually added proof (legacy, not used for new data)
  proofs?: ProofLink[] // Array of proof links (max 3)
  notes?: string // Manual notes
  summary?: string // Summary/AI Description
  images?: {
    main?: string // Main image URL (slot 1)
    image2?: string // Additional image URL (slot 2)
    image3?: string // Additional image URL (slot 3)
  }
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig as any)
const db = getFirestore(app)
const storage = getStorage(app)

// Format date to "MMM-YYYY" format
const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return 'N/A'
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return 'N/A'
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[date.getMonth()]}-${date.getFullYear()}`
  } catch {
    return 'N/A'
  }
}

// Sanitize string for filename: lowercase, replace spaces/special chars with hyphens
const sanitizeForFilename = (str: string): string => {
  if (!str) return ''
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

// Generate image filename: {officialDate}-{first25CharsOfSummary}-{imageNumber}.{ext}
// Example: nov-2025-project-update-completed-1.jpg or nov-2025-project-update-completed-1.png
const generateImageFilename = (officialDate: string, summary: string, imageNumber: number, extension: string = 'jpg'): string => {
  const datePart = officialDate.toLowerCase().trim()
  const summaryPart = sanitizeForFilename(summary.substring(0, 25))
  return `${datePart}-${summaryPart}-${imageNumber}.${extension}`
}

export function KarmaGeneralTableBlock({ blockId, projectId, folderId, onEditClick }: KarmaGeneralTableBlockProps) {
  const [rows, setRows] = useState<DeliverableRow[]>([])
  const [filteredRows, setFilteredRows] = useState<DeliverableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sourceBlockId, setSourceBlockId] = useState<string>('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [statusFilters, setStatusFilters] = useState<{ completed: boolean; pending: boolean; na: boolean; markedCompletedNoProof: boolean; skip: boolean; notInKarma: boolean; manuallyApproved: boolean; hasSummary: boolean }>({
    completed: true,
    pending: true,
    na: true,
    markedCompletedNoProof: true,
    skip: true,
    notInKarma: true,
    manuallyApproved: true,
    hasSummary: true,
  })
  const [hideFilters, setHideFilters] = useState<{ completed: boolean; pending: boolean; na: boolean; markedCompletedNoProof: boolean; skip: boolean; notInKarma: boolean; manuallyApproved: boolean; hasSummary: boolean }>({
    completed: false,
    pending: false,
    na: false,
    markedCompletedNoProof: false,
    skip: false,
    notInKarma: false,
    manuallyApproved: false,
    hasSummary: false,
  })
  const [showFiltersModalOpen, setShowFiltersModalOpen] = useState(false)
  const [hideFiltersModalOpen, setHideFiltersModalOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<DeliverableRow | null>(null)
  const [editingField, setEditingField] = useState<'officialDate' | 'addProof' | 'notes' | 'status' | 'summary' | null>(null)
  const [modalValue, setModalValue] = useState<string>('')
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  
  // Proofs editing state (for addProof modal)
  const [editingProofs, setEditingProofs] = useState<ProofLink[]>([
    { title: '', url: '' },
    { title: '', url: '' },
    { title: '', url: '' }
  ])
  
  // Add Row Modal State
  const [addRowModalOpen, setAddRowModalOpen] = useState(false)
  const [newRowData, setNewRowData] = useState<{
    officialDate: string
    summary: string
    status: string[]
    addProof: string
    notes: string
  }>({
    officialDate: '',
    summary: '',
    status: ['not in karma'],
    addProof: '',
    notes: '',
  })
  const [isAddingRow, setIsAddingRow] = useState(false)

  // Image Upload Modal State
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [imageModalRow, setImageModalRow] = useState<DeliverableRow | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState<number | null>(null) // Which slot is uploading (1-3)
  const [imageUploadError, setImageUploadError] = useState<string | null>(null)
  const [karmaSubtype, setKarmaSubtype] = useState<string>('')
  
  // Alert for missing officialDate
  const [showDateRequiredAlert, setShowDateRequiredAlert] = useState(false)
  
  // Image Viewer Modal State
  const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null)

  // Milestone Viewer State
  const [milestoneViewerOpen, setMilestoneViewerOpen] = useState(false)
  const [milestoneViewerData, setMilestoneViewerData] = useState<MilestoneData | null>(null)

  // Load block configuration and generate table
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load block configuration
        const blockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId)
        const blockSnap = await getDoc(blockRef)
        
        if (!blockSnap.exists()) {
          setError('Block configuration not found')
          setLoading(false)
          return
        }

        const blockData = blockSnap.data()
        const sourceId = blockData['source-block-id'] || ''
        setSourceBlockId(sourceId)
        
        // Load karma-subtype for image storage path
        const subtype = blockData['karma-subtype'] || 'karma-general-table'
        setKarmaSubtype(subtype)

        if (!sourceId) {
          setError('No source block configured. Please edit the block to select a source.')
          setLoading(false)
          return
        }

        // Try to load existing table-data first
        const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'karma-general-table')
        const tableDataSnap = await getDoc(tableDataRef)
        
        if (tableDataSnap.exists()) {
          const tableData = tableDataSnap.data()
          if (tableData.rows && Array.isArray(tableData.rows) && tableData.rows.length > 0) {
            // Load existing rows (preserves any edits) and sort by date
            const loadedRows = tableData.rows as DeliverableRow[]
            const sortedRows = sortRowsByDate(loadedRows)
            setRows(sortedRows)
            setLoading(false)
            return
          }
        }

        // No existing data - generate from source block
        await generateTableFromSource(sourceId)
      } catch (err) {
        console.error('Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoading(false)
      }
    }

    loadData()
  }, [blockId, projectId, folderId])

  // Filter rows based on status filters (supports multiple selections and comma-separated statuses)
  useEffect(() => {
    const filtered = rows.filter(row => {
      const status = row.status || ''
      // Handle comma-separated statuses
      const statusArray = status.includes(',') 
        ? status.split(',').map(s => s.trim().toLowerCase()).filter(s => s)
        : status ? [status.toLowerCase()] : []
      
      // Check summary filter first (independent of status filters)
      const hasSummaryText = !!(row.summary && row.summary.trim() !== '')
      
      // If "has summary" is checked in Hide, hide rows without summary
      if (hideFilters.hasSummary && !hasSummaryText) return false
      
      // First check hide filters - if row contains any hidden status, exclude it
      for (const rowStatus of statusArray) {
        if (rowStatus === 'completed' && hideFilters.completed) return false
        if (rowStatus === 'pending' && hideFilters.pending) return false
        if (rowStatus === 'marked completed, no proof' && hideFilters.markedCompletedNoProof) return false
        if (rowStatus === 'skip' && hideFilters.skip) return false
        if (rowStatus === 'not in karma' && hideFilters.notInKarma) return false
        if (rowStatus === 'manually approved' && hideFilters.manuallyApproved) return false
        if ((rowStatus === 'n/a' || !rowStatus) && hideFilters.na) return false
      }
      
      // Handle empty status for hide filter
      if (statusArray.length === 0 && hideFilters.na) return false
      
      // Check if "has summary" filter in Show is active
      // If checked, only show rows with summary text
      if (statusFilters.hasSummary && !hasSummaryText) return false
      
      // Then check show filters - if row contains any shown status, include it
      for (const rowStatus of statusArray) {
        if (rowStatus === 'completed' && statusFilters.completed) return true
        if (rowStatus === 'pending' && statusFilters.pending) return true
        if (rowStatus === 'marked completed, no proof' && statusFilters.markedCompletedNoProof) return true
        if (rowStatus === 'skip' && statusFilters.skip) return true
        if (rowStatus === 'not in karma' && statusFilters.notInKarma) return true
        if (rowStatus === 'manually approved' && statusFilters.manuallyApproved) return true
        if ((rowStatus === 'n/a' || !rowStatus) && statusFilters.na) return true
      }
      
      // Handle empty status for show filter
      if (statusArray.length === 0 && statusFilters.na) return true
      
      return false
    })
    setFilteredRows(filtered)
  }, [rows, statusFilters, hideFilters])

  // Open modal for editing
  const openModal = (row: DeliverableRow, field: 'officialDate' | 'addProof' | 'notes' | 'status' | 'summary') => {
    setEditingRow(row)
    setEditingField(field)
    if (field === 'status') {
      // Parse status string into array (handle comma-separated or single value)
      const statusStr = row.status || ''
      const statusArray = statusStr.includes(',') 
        ? statusStr.split(',').map(s => s.trim()).filter(s => s)
        : statusStr ? [statusStr] : []
      setSelectedStatuses(statusArray)
      setModalValue(statusStr)
    } else if (field === 'addProof') {
      // Load existing proofs or initialize empty
      const existingProofs = row.proofs || []
      setEditingProofs([
        existingProofs[0] || { title: '', url: '' },
        existingProofs[1] || { title: '', url: '' },
        existingProofs[2] || { title: '', url: '' }
      ])
      setModalValue('')
      setSelectedStatuses([])
    } else {
      setModalValue(row[field] || '')
      setSelectedStatuses([])
    }
    setModalOpen(true)
  }

  // Close modal
  const closeModal = () => {
    setModalOpen(false)
    setEditingRow(null)
    setEditingField(null)
    setModalValue('')
    setSelectedStatuses([])
    setEditingProofs([
      { title: '', url: '' },
      { title: '', url: '' },
      { title: '', url: '' }
    ])
  }

  // Handle status checkbox change
  const handleStatusToggle = (status: string) => {
    setSelectedStatuses(prev => {
      const newStatuses = prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
      // Update modalValue to comma-separated string
      setModalValue(newStatuses.join(', '))
      return newStatuses
    })
  }

  // Add Row Modal functions
  const openAddRowModal = () => {
    setNewRowData({
      officialDate: '',
      summary: '',
      status: ['not in karma'],
      addProof: '',
      notes: '',
    })
    setAddRowModalOpen(true)
  }

  const closeAddRowModal = () => {
    setAddRowModalOpen(false)
    setNewRowData({
      officialDate: '',
      summary: '',
      status: ['not in karma'],
      addProof: '',
      notes: '',
    })
  }

  const handleNewRowStatusToggle = (status: string) => {
    setNewRowData(prev => ({
      ...prev,
      status: prev.status.includes(status)
        ? prev.status.filter(s => s !== status)
        : [...prev.status, status]
    }))
  }

  const handleAddRowSave = async () => {
    // Validate required fields
    if (!newRowData.officialDate.trim()) {
      setError('Single Date is required')
      return
    }
    if (!newRowData.summary.trim()) {
      setError('Summary is required')
      return
    }

    setIsAddingRow(true)
    setError(null)

    try {
      // Create new row with "not in karma" as slug
      const newRow: DeliverableRow = {
        slug: 'not in karma',
        title: '',
        description: '',
        proof: 'n/a',
        startDate: '',
        endDate: '',
        createdAt: new Date().toISOString(),
        updatedAt: '',
        dueDate: '',
        completedAt: '',
        status: newRowData.status.join(', '),
        officialDate: newRowData.officialDate,
        addProof: newRowData.addProof,
        notes: newRowData.notes,
        summary: newRowData.summary,
      }

      // Add to existing rows and sort
      const updatedRows = sortRowsByDate([...rows, newRow])
      setRows(updatedRows)

      // Save to Firestore
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'karma-general-table')
      const cleanedRows = updatedRows.map(row => {
        const cleaned: any = { 
          ...row,
          officialDate: row.officialDate !== undefined ? row.officialDate : '',
          addProof: row.addProof !== undefined ? row.addProof : '',
          notes: row.notes !== undefined ? row.notes : '',
          summary: row.summary !== undefined ? row.summary : '',
        }
        Object.keys(cleaned).forEach(key => {
          if (cleaned[key] === undefined) {
            delete cleaned[key]
          }
        })
        return cleaned
      })
      
      await setDoc(tableDataRef, {
        rows: cleanedRows,
        updatedAt: serverTimestamp(),
      }, { merge: true })

      closeAddRowModal()
    } catch (err) {
      console.error('Error adding row:', err)
      setError(err instanceof Error ? err.message : 'Failed to add row')
    } finally {
      setIsAddingRow(false)
    }
  }

  // Remove row function
  const handleRemoveRow = async (rowToRemove: DeliverableRow) => {
    if (!confirm('Are you sure you want to remove this row?')) {
      return
    }

    try {
      // Filter out the row
      const updatedRows = rows.filter(row => 
        !(row.slug === rowToRemove.slug && 
          row.title === rowToRemove.title && 
          row.createdAt === rowToRemove.createdAt)
      )
      setRows(updatedRows)

      // Save to Firestore
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'karma-general-table')
      const cleanedRows = updatedRows.map(row => {
        const cleaned: any = { 
          ...row,
          officialDate: row.officialDate !== undefined ? row.officialDate : '',
          addProof: row.addProof !== undefined ? row.addProof : '',
          notes: row.notes !== undefined ? row.notes : '',
          summary: row.summary !== undefined ? row.summary : '',
        }
        Object.keys(cleaned).forEach(key => {
          if (cleaned[key] === undefined) {
            delete cleaned[key]
          }
        })
        return cleaned
      })
      
      await setDoc(tableDataRef, {
        rows: cleanedRows,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (err) {
      console.error('Error removing row:', err)
      setError(err instanceof Error ? err.message : 'Failed to remove row')
    }
  }

  // Helper function to check if row has any proof (from proof, addProof, or proofs columns)
  const hasAnyProof = (row: DeliverableRow): boolean => {
    const hasProof = !!(row.proof && row.proof !== 'n/a' && row.proof.trim() !== '')
    const hasAddProof = !!(row.addProof && row.addProof.trim() !== '')
    const hasProofs = !!(row.proofs && row.proofs.length > 0 && row.proofs.some(p => p.title.trim() && p.url.trim()))
    return hasProof || hasAddProof || hasProofs
  }

  // Helper function to get the date value from a row based on priority order
  const getRowDate = (row: DeliverableRow): Date | null => {
    // Priority order: officialDate (single date) first, then endDate, dueDate, startDate, createdAt, completedAt, updatedAt
    const dateFields = [
      row.officialDate,
      row.endDate,
      row.dueDate,
      row.startDate,
      row.createdAt,
      row.completedAt,
      row.updatedAt,
    ]

    for (const dateStr of dateFields) {
      if (dateStr && dateStr.trim() !== '') {
        const date = new Date(dateStr)
        if (!isNaN(date.getTime())) {
          return date
        }
      }
    }
    return null
  }

  // Helper function to sort rows by date
  const sortRowsByDate = (rows: DeliverableRow[]): DeliverableRow[] => {
    return [...rows].sort((a, b) => {
      const dateA = getRowDate(a)
      const dateB = getRowDate(b)
      
      // If both have dates, sort descending (newest first)
      if (dateA && dateB) {
        return dateB.getTime() - dateA.getTime()
      }
      // If only one has a date, put it first
      if (dateA && !dateB) return -1
      if (!dateA && dateB) return 1
      // If neither has a date, maintain original order
      return 0
    })
  }

  // Save row updates to Firestore
  const saveRowUpdate = async (rowToUpdate: DeliverableRow, field: 'officialDate' | 'addProof' | 'notes' | 'status' | 'summary', value: string) => {
    try {
      const updatedRows = rows.map(row => {
        // Match row by slug + title combination (or other unique identifier)
        if (row.slug === rowToUpdate.slug && row.title === rowToUpdate.title && 
            row.createdAt === rowToUpdate.createdAt) {
          const updatedRow = { ...row, [field]: value }
          
          // Only auto-update status if we're not explicitly setting the status field
          if (field !== 'status') {
            // If status is "marked completed, no proof" but now has proof in either column, change to "completed"
            if (updatedRow.status === 'marked completed, no proof' && hasAnyProof(updatedRow)) {
              updatedRow.status = 'completed'
            }
            // If status is "completed" but proof was removed (no proof in either column), change to "marked completed, no proof"
            else if (updatedRow.status === 'completed' && !hasAnyProof(updatedRow)) {
              updatedRow.status = 'marked completed, no proof'
            }
          }
          
          return updatedRow
        }
        return row
      })
      setRows(updatedRows)

      // Save to Firestore
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'karma-general-table')
      const cleanedRows = updatedRows.map(row => {
        const cleaned: any = { 
          ...row,
          // Ensure officialDate, addProof, notes, and summary are always strings (even if empty) so they get saved to Firestore
          officialDate: row.officialDate !== undefined ? row.officialDate : '',
          addProof: row.addProof !== undefined ? row.addProof : '',
          notes: row.notes !== undefined ? row.notes : '',
          summary: row.summary !== undefined ? row.summary : '',
        }
        Object.keys(cleaned).forEach(key => {
          // Remove undefined values (but we've already ensured officialDate, addProof, and notes are strings)
          if (cleaned[key] === undefined) {
            delete cleaned[key]
          }
        })
        return cleaned
      })
      
      await setDoc(tableDataRef, {
        rows: cleanedRows,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (err) {
      console.error('Error saving row update:', err)
      setError(err instanceof Error ? err.message : 'Failed to save update')
    }
  }

  // Handle modal save
  const handleModalSave = async () => {
    if (editingRow && editingField) {
      if (editingField === 'addProof') {
        // Save proofs array instead of single string
        await saveProofsUpdate(editingRow, editingProofs)
      } else {
        await saveRowUpdate(editingRow, editingField, modalValue)
      }
      closeModal()
    }
  }

  // Save proofs array update
  const saveProofsUpdate = async (rowToUpdate: DeliverableRow, proofs: ProofLink[]) => {
    try {
      // Filter out empty proofs (both title and url must have content)
      const validProofs = proofs.filter(p => p.title.trim() && p.url.trim())
      
      const updatedRows = rows.map(row => {
        if (row.slug === rowToUpdate.slug && row.title === rowToUpdate.title && 
            row.createdAt === rowToUpdate.createdAt) {
          const updatedRow = { ...row, proofs: validProofs.length > 0 ? validProofs : undefined }
          
          // Update status based on proof presence
          if (updatedRow.status === 'marked completed, no proof' && validProofs.length > 0) {
            updatedRow.status = 'completed'
          } else if (updatedRow.status === 'completed' && validProofs.length === 0 && !hasAnyProof(updatedRow)) {
            updatedRow.status = 'marked completed, no proof'
          }
          
          return updatedRow
        }
        return row
      })
      setRows(updatedRows)

      // Save to Firestore
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'karma-general-table')
      const cleanedRows = updatedRows.map(row => {
        const cleaned: any = { 
          ...row,
          officialDate: row.officialDate !== undefined ? row.officialDate : '',
          addProof: row.addProof !== undefined ? row.addProof : '',
          notes: row.notes !== undefined ? row.notes : '',
          summary: row.summary !== undefined ? row.summary : '',
        }
        // Only include proofs if it has valid entries
        if (row.proofs && row.proofs.length > 0) {
          cleaned.proofs = row.proofs
        } else {
          delete cleaned.proofs
        }
        Object.keys(cleaned).forEach(key => {
          if (cleaned[key] === undefined) {
            delete cleaned[key]
          }
        })
        return cleaned
      })
      
      await setDoc(tableDataRef, {
        rows: cleanedRows,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (err) {
      console.error('Error saving proofs:', err)
      setError(err instanceof Error ? err.message : 'Failed to save proofs')
    }
  }

  // Helper to match rows by unique identifier (slug + title + createdAt)
  const rowsMatch = (a: DeliverableRow, b: DeliverableRow): boolean => {
    return a.slug === b.slug && a.title === b.title && a.createdAt === b.createdAt
  }

  // Open image modal - checks for officialDate first
  const openImageModal = (row: DeliverableRow) => {
    if (!row.officialDate || row.officialDate.trim() === '') {
      setShowDateRequiredAlert(true)
      return
    }
    setImageModalRow(row)
    setImageUploadError(null)
    setImageModalOpen(true)
  }

  // Close image modal
  const closeImageModal = () => {
    setImageModalOpen(false)
    setImageModalRow(null)
    setImageUploadError(null)
    setIsUploadingImage(null)
  }

  // Handle image upload for a specific slot
  const handleImageUpload = async (file: File, slot: 1 | 2 | 3) => {
    if (!imageModalRow) return
    
    setImageUploadError(null)
    
    // Validate file type
    if (file.type !== 'image/jpeg' && file.type !== 'image/jpg' && file.type !== 'image/png') {
      setImageUploadError('Only JPEG and PNG files are accepted.')
      return
    }
    
    // Validate file size (max 3MB)
    if (file.size > 3 * 1024 * 1024) {
      setImageUploadError('Maximum file size is 3MB.')
      return
    }
    
    setIsUploadingImage(slot)
    
    try {
      // Determine file extension from MIME type
      const extension = file.type === 'image/png' ? 'png' : 'jpg'
      
      // Generate filename
      const filename = generateImageFilename(
        imageModalRow.officialDate,
        imageModalRow.summary || imageModalRow.title || 'image',
        slot,
        extension
      )
      
      // Build storage path: newsroom/assets/{projectId}/{folderId}/{karmaSubtype}/{filename}
      const storagePath = `newsroom/assets/${projectId}/${folderId}/${karmaSubtype}/${filename}`
      const fileRef = storageRef(storage, storagePath)
      
      // Upload file with correct content type
      await uploadBytes(fileRef, file, {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000, immutable',
      })
      
      // Get download URL
      const downloadUrl = await getDownloadURL(fileRef)
      
      // Update the row with the new image URL
      const slotKey = slot === 1 ? 'main' : `image${slot}` as 'main' | 'image2' | 'image3'
      const updatedImages = {
        ...imageModalRow.images,
        [slotKey]: downloadUrl
      }
      
      // Update local state - match by unique identifier (slug + title + createdAt)
      const updatedRows = rows.map((row) => {
        if (rowsMatch(row, imageModalRow)) {
          return { ...row, images: updatedImages }
        }
        return row
      })
      setRows(updatedRows)
      
      // Update modal row state
      setImageModalRow(prev => prev ? { ...prev, images: updatedImages } : null)
      
      // Save to Firestore
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'karma-general-table')
      const cleanedRows = updatedRows.map(row => {
        const cleaned: any = { 
          ...row,
          officialDate: row.officialDate !== undefined ? row.officialDate : '',
          addProof: row.addProof !== undefined ? row.addProof : '',
          notes: row.notes !== undefined ? row.notes : '',
          summary: row.summary !== undefined ? row.summary : '',
        }
        Object.keys(cleaned).forEach(key => {
          if (cleaned[key] === undefined) {
            delete cleaned[key]
          }
        })
        return cleaned
      })
      
      await setDoc(tableDataRef, {
        rows: cleanedRows,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      
    } catch (err) {
      console.error('Error uploading image:', err)
      setImageUploadError(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setIsUploadingImage(null)
    }
  }

  // Refresh table data by regenerating from source block
  const refreshTableData = async () => {
    if (!sourceBlockId) {
      setError('No source block configured')
      return
    }

    setIsRefreshing(true)
    setError(null)

    try {
      await generateTableFromSource(sourceBlockId)
    } catch (err) {
      console.error('Error refreshing table:', err)
      setError(err instanceof Error ? err.message : 'Failed to refresh table')
    } finally {
      setIsRefreshing(false)
    }
  }

  const generateTableFromSource = async (sourceBlockIdParam: string) => {
    try {
      // First, try to load existing table-data to preserve manual edits
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'karma-general-table')
      const tableDataSnap = await getDoc(tableDataRef)
      let existingRows: DeliverableRow[] = []
      
      if (tableDataSnap.exists()) {
        const tableData = tableDataSnap.data()
        if (tableData.rows && Array.isArray(tableData.rows) && tableData.rows.length > 0) {
          existingRows = tableData.rows as DeliverableRow[]
        }
      }

      // Load query results from source block - get the most recent one by queriedAt
      const queryResultsRef = collection(db, 'newsroom', projectId, 'folders', folderId, 'blocks', sourceBlockIdParam, 'query-results')
      
      // Try to get the most recent by queriedAt, fallback to getting all and sorting
      let queryResultsSnap
      try {
        const queryResultsQuery = query(queryResultsRef, orderBy('queriedAt', 'desc'), limit(1))
        queryResultsSnap = await getDocs(queryResultsQuery)
      } catch (queryError) {
        // If orderBy fails (no index), get all and sort manually
        console.warn('OrderBy query failed, fetching all and sorting manually:', queryError)
        const allResultsSnap = await getDocs(queryResultsRef)
        const allDocs = allResultsSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }))
        
        // Sort by queriedAt descending
        allDocs.sort((a, b) => {
          const aTime = a.data.queriedAt?.toDate?.()?.getTime() || a.data.queriedAt?.seconds * 1000 || 0
          const bTime = b.data.queriedAt?.toDate?.()?.getTime() || b.data.queriedAt?.seconds * 1000 || 0
          return bTime - aTime
        })
        
        if (allDocs.length === 0) {
          setError('No query results found in source block')
          setLoading(false)
          return
        }
        
        // Create a mock query snapshot structure
        const latestDoc = allDocs[0]
        queryResultsSnap = {
          docs: [{
            id: latestDoc.id,
            data: () => latestDoc.data
          }]
        }
      }

      if (!queryResultsSnap || queryResultsSnap.docs.length === 0) {
        setError('No query results found in source block')
        setLoading(false)
        return
      }

      const latestResult = queryResultsSnap.docs[0]
      const resultData = latestResult.data()

      if (!resultData.success) {
        setError('Query was not successful')
        console.error('Query failed:', resultData.error)
        setLoading(false)
        return
      }

      // Data structure: data = { 'slug-1': { projectUpdates: [...], grantUpdates: [...], ... }, 'slug-2': {...} }
      const groupedData = resultData.data || {}
      
      // Flatten all updates from all slugs
      const allRows: DeliverableRow[] = []

      // Helper function to check if row has any proof (from proof, addProof, or proofs columns)
      const hasAnyProof = (row: DeliverableRow): boolean => {
        const hasProof = !!(row.proof && row.proof !== 'n/a' && row.proof.trim() !== '')
        const hasAddProof = !!(row.addProof && row.addProof.trim() !== '')
        const hasProofs = !!(row.proofs && row.proofs.length > 0 && row.proofs.some(p => p.title.trim() && p.url.trim()))
        return hasProof || hasAddProof || hasProofs
      }

      // Helper function to determine status
      const determineStatus = (update: any, proof: string): string => {
        const hasProof = proof && proof !== 'n/a' && proof.trim() !== ''
        
        // Check explicit status fields first
        const explicitStatus = update.status || update.currentStatus
        
        // If status is "completed" but no proof exists, mark as "marked completed, no proof"
        if (explicitStatus === 'completed' && !hasProof) {
          return 'marked completed, no proof'
        }
        
        // If explicit status field exists and has proof (or is not completed), use it
        if (explicitStatus) {
          return explicitStatus
        }
        
        // If verified is explicitly set
        if (update.verified !== undefined) {
          // If verified is true, check if there's proof
          if (update.verified) {
            return hasProof ? 'completed' : 'marked completed, no proof'
          }
          // If verified is false but has proof, proof overrides → completed
          if (hasProof) {
            return 'completed'
          }
          // If verified is false and no proof → pending
          return 'pending'
        }
        
        // If no status fields but has proof → completed
        if (hasProof) {
          return 'completed'
        }
        
        // If no status and no proof → pending
        return 'pending'
      }

      // Helper function to process projectUpdates (has deliverables)
      const processProjectUpdates = (updates: any[], slug: string) => {
        if (!Array.isArray(updates) || updates.length === 0) return

        updates.forEach((update: any) => {
          const updateTitle = update.title || ''
          // Deliverables are nested under associations.deliverables
          const deliverables = update.associations?.deliverables || []

          if (!Array.isArray(deliverables) || deliverables.length === 0) {
            // If no deliverables, create one row with update info
            const proof = 'n/a'
            const status = determineStatus(update, proof)
            allRows.push({
              slug,
              title: updateTitle,
              description: update.description || '',
              proof,
              startDate: update.startDate || '',
              endDate: update.endDate || '',
              createdAt: update.createdAt || '',
              updatedAt: '',
              dueDate: '',
              completedAt: '',
              status,
              officialDate: '',
            })
          } else {
            // Create a row for each deliverable
            deliverables.forEach((deliverable: any) => {
              const deliverableName = deliverable.name || ''
              // Title structure: deliverableName (updateTitle)
              const stitchedTitle = deliverableName && updateTitle
                ? `${deliverableName} (${updateTitle})`
                : deliverableName || updateTitle || 'Untitled'

              const proof = deliverable.proof || 'n/a'
              const status = determineStatus(update, proof)
              allRows.push({
                slug,
                title: stitchedTitle,
                description: deliverable.description || '',
                proof,
                startDate: update.startDate || '',
                endDate: update.endDate || '',
                createdAt: update.createdAt || '',
                updatedAt: '',
                dueDate: '',
                completedAt: '',
                status,
                officialDate: '',
              })
            })
          }
        })
      }

      // Helper function to process grantUpdates (different structure, no deliverables)
      const processGrantUpdates = (updates: any[], slug: string) => {
        if (!Array.isArray(updates) || updates.length === 0) return

        updates.forEach((update: any) => {
          const updateTitle = update.title || ''
          const proof = update.proofOfWork || 'n/a'
          const status = determineStatus(update, proof)
          // grantUpdates have no deliverables, create one row per update
          allRows.push({
            slug,
            title: updateTitle,
            description: update.text || '',
            proof,
            startDate: '', // grantUpdates don't have startDate
            endDate: '', // grantUpdates don't have endDate
            createdAt: update.createdAt || '',
            updatedAt: update.statusUpdatedAt || '',
            dueDate: '',
            completedAt: '',
            status,
            officialDate: '',
          })
        })
      }

      // Helper function to process milestones (used for both grantMilestones and projectMilestones)
      const processMilestones = (milestones: any[], slug: string) => {
        if (!Array.isArray(milestones) || milestones.length === 0) return

        milestones.forEach((milestone: any) => {
          const milestoneTitle = milestone.title || ''
          const deliverables = milestone.completionDetails?.deliverables || []

          if (!Array.isArray(deliverables) || deliverables.length === 0) {
            // If no deliverables, create one row with milestone info
            const description = milestone.completionDetails?.description || milestone.description || ''
            const proof = milestone.completionDetails?.proofOfWork || 'n/a'
            const status = determineStatus(milestone, proof)
            
            allRows.push({
              slug,
              title: milestoneTitle,
              description,
              proof,
              startDate: milestone.startDate || '',
              endDate: '',
              createdAt: milestone.createdAt || '',
              updatedAt: '',
              dueDate: milestone.dueDate || '',
              completedAt: milestone.completionDetails?.completedAt || '',
              status,
              officialDate: '',
            })
          } else {
            // Create a row for each deliverable
            deliverables.forEach((deliverable: any) => {
              const deliverableName = deliverable.name || ''
              // Title structure: deliverableName (milestoneTitle)
              const stitchedTitle = deliverableName && milestoneTitle
                ? `${deliverableName} (${milestoneTitle})`
                : deliverableName || milestoneTitle || 'Untitled'

              const description = deliverable.description || milestone.completionDetails?.description || milestone.description || ''
              const proof = deliverable.proof || milestone.completionDetails?.proofOfWork || 'n/a'
              const status = determineStatus(milestone, proof)

              allRows.push({
                slug,
                title: stitchedTitle,
                description,
                proof,
                startDate: milestone.startDate || '',
                endDate: '',
                createdAt: milestone.createdAt || '',
                updatedAt: '',
                dueDate: milestone.dueDate || '',
                completedAt: milestone.completionDetails?.completedAt || '',
                status,
                officialDate: '',
              })
            })
          }
        })
      }

      Object.entries(groupedData).forEach(([slug, slugData]: [string, any]) => {
        // Skip if slugData is not an object or is an array (failed queries are stored as empty arrays)
        if (!slugData || Array.isArray(slugData) || typeof slugData !== 'object') return

        // Process projectUpdates, grantUpdates, grantMilestones, and projectMilestones separately (different structures)
        const projectUpdates = slugData.projectUpdates || []
        const grantUpdates = slugData.grantUpdates || []
        const grantMilestones = slugData.grantMilestones || []
        const projectMilestones = slugData.projectMilestones || []

        processProjectUpdates(projectUpdates, slug)
        processGrantUpdates(grantUpdates, slug)
        processMilestones(grantMilestones, slug)
        processMilestones(projectMilestones, slug)
      })

      // Merge with existing rows to preserve manual edits (officialDate and addProof)
      const mergedRows = allRows.map(newRow => {
        // Find matching existing row by slug + title + createdAt
        const existingRow = existingRows.find(existing => 
          existing.slug === newRow.slug && 
          existing.title === newRow.title && 
          existing.createdAt === newRow.createdAt
        )
        
        if (existingRow) {
          // Preserve manual edits - keep existing values if they exist, otherwise use new values
          const mergedRow = {
            ...newRow,
            officialDate: existingRow.officialDate !== undefined && existingRow.officialDate !== '' 
              ? existingRow.officialDate 
              : (newRow.officialDate || ''),
            addProof: existingRow.addProof !== undefined && existingRow.addProof !== '' 
              ? existingRow.addProof 
              : (newRow.addProof || ''),
            notes: existingRow.notes !== undefined && existingRow.notes !== '' 
              ? existingRow.notes 
              : (newRow.notes || ''),
            summary: existingRow.summary !== undefined && existingRow.summary !== '' 
              ? existingRow.summary 
              : (newRow.summary || ''),
          }
          
          // If status is "marked completed, no proof" but now has proof in either column, change to "completed"
          if (mergedRow.status === 'marked completed, no proof' && hasAnyProof(mergedRow)) {
            mergedRow.status = 'completed'
          }
          
          return mergedRow
        }
        
        // Also check new rows that might have addProof from previous saves
        if (newRow.status === 'marked completed, no proof' && hasAnyProof(newRow)) {
          newRow.status = 'completed'
        }
        
        return newRow
      })

      // Sort rows by date before setting
      const sortedMergedRows = sortRowsByDate(mergedRows)
      setRows(sortedMergedRows)

      // Save to table-data subcollection (always create/update)
      // Note: tableDataRef was already defined above, but we'll use it again here
      
      // Clean rows array to remove any undefined values (but ensure officialDate, addProof, and notes are always strings)
      const cleanedRows = sortedMergedRows.map(row => {
        const cleaned: any = { 
          ...row,
          // Ensure officialDate, addProof, notes, and summary are always strings (even if empty) so they get saved to Firestore
          officialDate: row.officialDate !== undefined ? row.officialDate : '',
          addProof: row.addProof !== undefined ? row.addProof : '',
          notes: row.notes !== undefined ? row.notes : '',
          summary: row.summary !== undefined ? row.summary : '',
        }
        Object.keys(cleaned).forEach(key => {
          // Remove undefined values (but we've already ensured officialDate, addProof, and notes are strings)
          if (cleaned[key] === undefined) {
            delete cleaned[key]
          }
        })
        return cleaned
      })
      
      const tableDataToSave: any = {
        rows: cleanedRows,
        sourceBlockId: sourceBlockIdParam || '',
        generatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      
      // Remove undefined values from the entire object
      Object.keys(tableDataToSave).forEach(key => {
        if (tableDataToSave[key] === undefined) {
          delete tableDataToSave[key]
        }
      })
      
      await setDoc(tableDataRef, tableDataToSave, { merge: true })

      setLoading(false)
    } catch (err) {
      console.error('Error generating table:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate table')
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading table data...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-700">
          <div className="font-semibold mb-1">Error</div>
          <div className="text-sm">{error}</div>
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No data available. Please ensure the source block has been queried and contains updates.
      </div>
    )
  }

  return (
    <div className="p-4">
      {/* Status Filters */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={openAddRowModal}
            className="px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
          >
            Add Row
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFiltersModalOpen(true)}
            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
          >
            Show Filters
          </button>
          <button
            onClick={() => setHideFiltersModalOpen(true)}
            className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
          >
            Hide Filters
          </button>
        </div>
      </div>

      {/* Table container with sticky header and scrollable body */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[100px] min-w-[100px] max-w-[100px]">
                Dates
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                Single Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                Title
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[200px] min-w-[200px] max-w-[200px]">
                Description
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[200px] min-w-[200px] max-w-[200px]">
                Summary
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[150px] min-w-[150px] max-w-[150px]">
                Proof
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[150px] min-w-[150px] max-w-[150px]">
                Add Proof
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                Notes
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[120px] min-w-[120px] max-w-[120px]">
                Images
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[75px] min-w-[75px] max-w-[75px]">
                Slug
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[90px] min-w-[90px] max-w-[90px]">
                Preview
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredRows.map((row, index) => (
              <tr key={index} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[100px] min-w-[100px] max-w-[100px]">
                  <div className="break-words">
                    <div className="space-y-1">
                      {row.startDate && <div>start = {formatDate(row.startDate)}</div>}
                      {row.endDate && <div>end = {formatDate(row.endDate)}</div>}
                      {row.createdAt && <div>created = {formatDate(row.createdAt)}</div>}
                      {row.updatedAt && <div>updated = {formatDate(row.updatedAt)}</div>}
                      {row.dueDate && <div>due = {formatDate(row.dueDate)}</div>}
                      {row.completedAt && <div>completed = {formatDate(row.completedAt)}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                  <button
                    onClick={() => openModal(row, 'officialDate')}
                    className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                  >
                    Modify
                  </button>
                  {row.officialDate && (
                    <div className="mt-1 text-xs text-gray-900 break-words whitespace-normal">
                      {row.officialDate}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                  <div className="max-h-[200px] overflow-y-auto">
                    {row.title}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[200px] min-w-[200px] max-w-[200px]">
                  <div className="max-h-[200px] overflow-y-auto overflow-x-hidden break-words">
                    {row.description || ''}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[200px] min-w-[200px] max-w-[200px]">
                  <button
                    onClick={() => openModal(row, 'summary')}
                    className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors mb-1"
                  >
                    Modify
                  </button>
                  {row.summary && (
                    <div className="max-h-[200px] overflow-y-auto overflow-x-hidden break-words text-xs text-gray-900">
                      {row.summary}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => openModal(row, 'status')}
                      className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors w-fit"
                    >
                      Modify
                    </button>
                    <span className={`px-2 py-1 rounded text-xs font-medium w-fit ${
                      (() => {
                        const firstStatus = row.status?.split(',')[0]?.trim() || ''
                        if (firstStatus === 'completed') return 'bg-green-100 text-green-800'
                        if (firstStatus === 'pending') return 'bg-yellow-100 text-yellow-800'
                        if (firstStatus === 'marked completed, no proof') return 'bg-blue-100 text-blue-800'
                        if (firstStatus === 'skip') return 'bg-gray-200 text-gray-700'
                        if (firstStatus === 'not in karma') return 'bg-purple-100 text-purple-800'
                        if (firstStatus === 'manually approved') return 'bg-cyan-100 text-cyan-800'
                        return 'bg-gray-100 text-gray-800'
                      })()
                    }`}>
                      {row.status || 'n/a'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[150px] min-w-[150px] max-w-[150px]">
                  <div className="max-h-[200px] overflow-y-auto break-words whitespace-normal">
                    {row.proof !== 'n/a' ? (
                      <a href={row.proof} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                        {row.proof}
                      </a>
                    ) : (
                      'n/a'
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[150px] min-w-[150px] max-w-[150px]">
                  <button
                    onClick={() => openModal(row, 'addProof')}
                    className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                  >
                    Modify
                  </button>
                  {row.proofs && row.proofs.length > 0 && (
                    <div className="mt-1 text-xs text-gray-900 break-words whitespace-normal">
                      {row.proofs.map((proof, idx) => proof.title.trim()).filter(Boolean).join(', ')}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                  <button
                    onClick={() => openModal(row, 'notes')}
                    className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                  >
                    Modify
                  </button>
                  {row.notes && (
                    <div className="mt-1 text-xs text-gray-900 break-words whitespace-normal max-h-[200px] overflow-y-auto">
                      {row.notes}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-200 w-[120px] min-w-[120px] max-w-[120px]">
                  <button
                    onClick={() => openImageModal(row)}
                    className="px-3 py-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors"
                  >
                    Add Images
                  </button>
                  {row.images && (row.images.main || row.images.image2 || row.images.image3) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {row.images.main && (
                        <img 
                          src={row.images.main} 
                          alt="Main" 
                          className="w-12 h-12 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setViewerImageUrl(row.images!.main!)}
                        />
                      )}
                      {row.images.image2 && (
                        <img 
                          src={row.images.image2} 
                          alt="Image 2" 
                          className="w-12 h-12 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setViewerImageUrl(row.images!.image2!)}
                        />
                      )}
                      {row.images.image3 && (
                        <img 
                          src={row.images.image3} 
                          alt="Image 3" 
                          className="w-12 h-12 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setViewerImageUrl(row.images!.image3!)}
                        />
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 font-mono w-[75px] min-w-[75px] max-w-[75px] break-words">
                  {row.slug === 'not in karma' ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs break-words">{row.slug}</span>
                      <button
                        onClick={() => handleRemoveRow(row)}
                        className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors"
                      >
                        Remove Row
                      </button>
                    </div>
                  ) : (
                    row.slug
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 w-[90px] min-w-[90px] max-w-[90px]">
                  <button
                    onClick={() => {
                      // Open the milestone viewer
                      setMilestoneViewerData({
                        officialDate: row.officialDate || '',
                        summary: row.summary,
                        notes: row.notes,
                        addProof: row.addProof,
                        proofs: row.proofs,
                        images: row.images,
                      })
                      setMilestoneViewerOpen(true)
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors"
                  >
                    Preview
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Edit Modal */}
      {modalOpen && editingRow && editingField && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={closeModal}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Edit {editingField === 'officialDate' ? 'Single Date' : editingField === 'addProof' ? 'Proof Links' : editingField === 'status' ? 'Status' : editingField === 'summary' ? 'Summary' : 'Notes'}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {editingRow.title}
              </p>
            </div>
            <div className="px-6 py-4 flex-1 overflow-y-auto">
              {editingField !== 'addProof' && (
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {editingField === 'officialDate' ? 'Date' : editingField === 'status' ? 'Status' : editingField === 'summary' ? 'Summary' : 'Notes'}
                </label>
              )}
              {editingField === 'status' ? (
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes('pending')}
                      onChange={() => handleStatusToggle('pending')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Pending</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes('completed')}
                      onChange={() => handleStatusToggle('completed')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Completed</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes('marked completed, no proof')}
                      onChange={() => handleStatusToggle('marked completed, no proof')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Marked Completed, No Proof</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes('skip')}
                      onChange={() => handleStatusToggle('skip')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Skip</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes('n/a')}
                      onChange={() => handleStatusToggle('n/a')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">N/A</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes('not in karma')}
                      onChange={() => handleStatusToggle('not in karma')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Not in Karma</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.includes('manually approved')}
                      onChange={() => handleStatusToggle('manually approved')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Manually Approved</span>
                  </label>
                </div>
              ) : editingField === 'addProof' ? (
                <div className="space-y-6">
                  <p className="text-sm text-gray-500">Add up to 3 proof links. Each needs a title (max 25 characters) and URL.</p>
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                      <div className="text-sm font-medium text-gray-700 mb-3">Proof {index + 1}</div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Title (max 25 chars)</label>
                          <input
                            type="text"
                            value={editingProofs[index]?.title || ''}
                            onChange={(e) => {
                              const newProofs = [...editingProofs]
                              newProofs[index] = { 
                                ...newProofs[index], 
                                title: e.target.value.slice(0, 25) 
                              }
                              setEditingProofs(newProofs)
                            }}
                            placeholder="e.g., GitHub PR, Tweet, Forum Post"
                            className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            maxLength={25}
                          />
                          <div className="text-xs text-gray-400 mt-1 text-right">
                            {editingProofs[index]?.title?.length || 0}/25
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">URL</label>
                          <input
                            type="url"
                            value={editingProofs[index]?.url || ''}
                            onChange={(e) => {
                              const newProofs = [...editingProofs]
                              newProofs[index] = { 
                                ...newProofs[index], 
                                url: e.target.value 
                              }
                              setEditingProofs(newProofs)
                            }}
                            placeholder="https://..."
                            className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <textarea
                  value={modalValue}
                  onChange={(e) => setModalValue(e.target.value)}
                  placeholder={editingField === 'officialDate' ? 'Enter date' : editingField === 'summary' ? 'Enter summary' : 'Enter notes'}
                  className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  rows={editingField === 'officialDate' ? 3 : editingField === 'summary' ? 10 : 10}
                />
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleModalSave}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Row Modal */}
      {addRowModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={closeAddRowModal}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Add New Row
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Fields marked with <span className="text-red-500">*</span> are required
              </p>
            </div>
            <div className="px-6 py-4 flex-1 overflow-y-auto space-y-4">
              {/* Single Date (Required) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Single Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newRowData.officialDate}
                  onChange={(e) => setNewRowData(prev => ({ ...prev, officialDate: e.target.value }))}
                  placeholder="Enter date (e.g., 2024-01-15 or Jan 2024)"
                  className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              {/* Summary (Required) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Summary <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={newRowData.summary}
                  onChange={(e) => setNewRowData(prev => ({ ...prev, summary: e.target.value }))}
                  placeholder="Enter summary"
                  className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                  rows={4}
                />
              </div>

              {/* Status (Multi-select, "not in karma" selected by default) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-2 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRowData.status.includes('not in karma')}
                      onChange={() => handleNewRowStatusToggle('not in karma')}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Not in Karma</span>
                    <span className="text-xs text-gray-500">(default)</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRowData.status.includes('pending')}
                      onChange={() => handleNewRowStatusToggle('pending')}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Pending</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRowData.status.includes('completed')}
                      onChange={() => handleNewRowStatusToggle('completed')}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Completed</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRowData.status.includes('marked completed, no proof')}
                      onChange={() => handleNewRowStatusToggle('marked completed, no proof')}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Marked Completed, No Proof</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRowData.status.includes('skip')}
                      onChange={() => handleNewRowStatusToggle('skip')}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Skip</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRowData.status.includes('n/a')}
                      onChange={() => handleNewRowStatusToggle('n/a')}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">N/A</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRowData.status.includes('manually approved')}
                      onChange={() => handleNewRowStatusToggle('manually approved')}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-900">Manually Approved</span>
                  </label>
                </div>
              </div>

              {/* Add Proof (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Add Proof
                </label>
                <textarea
                  value={newRowData.addProof}
                  onChange={(e) => setNewRowData(prev => ({ ...prev, addProof: e.target.value }))}
                  placeholder="Enter proof URL (optional)"
                  className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                  rows={3}
                />
              </div>

              {/* Notes (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  value={newRowData.notes}
                  onChange={(e) => setNewRowData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Enter notes (optional)"
                  className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                  rows={3}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={closeAddRowModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddRowSave}
                disabled={isAddingRow}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAddingRow ? 'Adding...' : 'Add Row'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Show Filters Modal */}
      {showFiltersModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowFiltersModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Show Filters
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Select which items to show in the table
              </p>
            </div>
            <div className="px-6 py-4 flex-1 overflow-y-auto space-y-3">
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilters.completed}
                  onChange={(e) => setStatusFilters(prev => ({ ...prev, completed: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Completed</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilters.pending}
                  onChange={(e) => setStatusFilters(prev => ({ ...prev, pending: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Pending</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilters.na}
                  onChange={(e) => setStatusFilters(prev => ({ ...prev, na: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">N/A</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilters.markedCompletedNoProof}
                  onChange={(e) => setStatusFilters(prev => ({ ...prev, markedCompletedNoProof: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Marked Completed, No Proof</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilters.skip}
                  onChange={(e) => setStatusFilters(prev => ({ ...prev, skip: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Skip</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilters.notInKarma}
                  onChange={(e) => setStatusFilters(prev => ({ ...prev, notInKarma: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Not in Karma</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilters.manuallyApproved}
                  onChange={(e) => setStatusFilters(prev => ({ ...prev, manuallyApproved: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Manually Approved</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={statusFilters.hasSummary}
                  onChange={(e) => setStatusFilters(prev => ({ ...prev, hasSummary: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Has Summary</span>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowFiltersModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hide Filters Modal */}
      {hideFiltersModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setHideFiltersModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Hide Filters
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Select which items to hide from the table
              </p>
            </div>
            <div className="px-6 py-4 flex-1 overflow-y-auto space-y-3">
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideFilters.completed}
                  onChange={(e) => setHideFilters(prev => ({ ...prev, completed: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Completed</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideFilters.pending}
                  onChange={(e) => setHideFilters(prev => ({ ...prev, pending: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Pending</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideFilters.na}
                  onChange={(e) => setHideFilters(prev => ({ ...prev, na: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">N/A</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideFilters.markedCompletedNoProof}
                  onChange={(e) => setHideFilters(prev => ({ ...prev, markedCompletedNoProof: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Marked Completed, No Proof</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideFilters.skip}
                  onChange={(e) => setHideFilters(prev => ({ ...prev, skip: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Skip</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideFilters.notInKarma}
                  onChange={(e) => setHideFilters(prev => ({ ...prev, notInKarma: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Not in Karma</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideFilters.manuallyApproved}
                  onChange={(e) => setHideFilters(prev => ({ ...prev, manuallyApproved: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Manually Approved</span>
              </label>
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideFilters.hasSummary}
                  onChange={(e) => setHideFilters(prev => ({ ...prev, hasSummary: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-900">Has Summary</span>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setHideFiltersModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Upload Modal */}
      {imageModalOpen && imageModalRow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={closeImageModal}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Add Images
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {imageModalRow.title}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Date: {imageModalRow.officialDate}
              </p>
            </div>
            <div className="px-6 py-4 flex-1 overflow-y-auto">
              {imageUploadError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                  {imageUploadError}
                </div>
              )}
              
              <div className="space-y-4">
                {/* Main Image (Slot 1) */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-bold text-gray-700">Main Image</label>
                    {isUploadingImage === 1 && (
                      <span className="text-xs text-blue-600">Uploading...</span>
                    )}
                  </div>
                  {imageModalRow.images?.main ? (
                    <div className="flex items-center gap-3">
                      <img 
                        src={imageModalRow.images.main} 
                        alt="Main" 
                        className="w-20 h-20 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setViewerImageUrl(imageModalRow.images!.main!)}
                      />
                      <label className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 cursor-pointer transition-colors">
                        Replace
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleImageUpload(file, 1)
                          }}
                          disabled={isUploadingImage !== null}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center w-full h-20 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 cursor-pointer transition-colors">
                      <span className="text-sm text-gray-500">Click to upload JPEG or PNG</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleImageUpload(file, 1)
                        }}
                        disabled={isUploadingImage !== null}
                      />
                    </label>
                  )}
                </div>

                {/* Additional Images (Slots 2, 3) */}
                {[2, 3].map((slot) => {
                  const slotKey = `image${slot}` as 'image2' | 'image3'
                  const imageUrl = imageModalRow.images?.[slotKey]
                  
                  return (
                    <div key={slot} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">Image {slot}</label>
                        {isUploadingImage === slot && (
                          <span className="text-xs text-blue-600">Uploading...</span>
                        )}
                      </div>
                      {imageUrl ? (
                        <div className="flex items-center gap-3">
                          <img 
                            src={imageUrl} 
                            alt={`Image ${slot}`} 
                            className="w-20 h-20 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setViewerImageUrl(imageUrl)}
                          />
                          <label className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 cursor-pointer transition-colors">
                            Replace
                            <input
                              type="file"
                              accept="image/jpeg,image/jpg,image/png"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleImageUpload(file, slot as 2 | 3)
                              }}
                              disabled={isUploadingImage !== null}
                            />
                          </label>
                        </div>
                      ) : (
                        <label className="flex items-center justify-center w-full h-20 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 cursor-pointer transition-colors">
                          <span className="text-sm text-gray-500">Click to upload JPEG or PNG</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/jpg,image/png"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) handleImageUpload(file, slot as 2 | 3)
                            }}
                            disabled={isUploadingImage !== null}
                          />
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={closeImageModal}
                className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Date Required Alert */}
      {showDateRequiredAlert && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
                  <span className="text-xl">⚠️</span>
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Single Date Required</h2>
              </div>
              <p className="text-gray-600 mb-6">
                Please add a Single Date (officialDate) to this row before uploading images. The date is used to generate the image filename.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => setShowDateRequiredAlert(false)}
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                >
                  Understood
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Viewer Modal */}
      {viewerImageUrl && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60]"
          onClick={() => setViewerImageUrl(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center">
            <img 
              src={viewerImageUrl} 
              alt="Full size" 
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setViewerImageUrl(null)}
              className="mt-6 px-8 py-3 text-lg font-semibold text-white bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors shadow-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}


      {/* Milestone Viewer */}
      <MilestoneViewer
        isOpen={milestoneViewerOpen}
        onClose={() => {
          setMilestoneViewerOpen(false)
          setMilestoneViewerData(null)
        }}
        milestone={milestoneViewerData}
      />
    </div>
  )
}

