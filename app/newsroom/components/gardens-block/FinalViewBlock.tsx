'use client'

import React, { useState, useEffect, useRef } from 'react'
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL, listAll } from 'firebase/storage'
import { initializeApp, getApps } from 'firebase/app'
import { toPng } from 'html-to-image'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

interface FinalViewBlockProps {
  blockId: string
  projectId: string
  folderId: string
  onEditClick?: () => void
}

interface GardensProposal {
  id: string
  proposalNumber: number
  title?: string
  requestedAmount: string
  tokenSymbol?: string
  summary?: string
  github?: string | null
  karmaProfile?: string | null
  proposalUrl?: string
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig as any)
const db = getFirestore(app)
const storage = getStorage(app)

export function FinalViewBlock({ blockId, projectId, folderId, onEditClick }: FinalViewBlockProps) {
  const [sourceBlockId, setSourceBlockId] = useState<string>('')
  const [proposals, setProposals] = useState<GardensProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isBoxPreviewVisible, setIsBoxPreviewVisible] = useState<boolean>(true)
  const [boxPreviewBackgroundColor, setBoxPreviewBackgroundColor] = useState<string>('#adaba9')
  const [boxPreviewCardColorType, setBoxPreviewCardColorType] = useState<'solid' | 'gradient'>('solid')
  const [boxPreviewCardColor, setBoxPreviewCardColor] = useState<string>('#c9fdc9')
  const [boxPreviewCardGradientColor, setBoxPreviewCardGradientColor] = useState<string>('#a8e6a8')
  const [boxPreviewCardBorderColor, setBoxPreviewCardBorderColor] = useState<string>('#006400')
  const [boxPreviewCardBorderSize, setBoxPreviewCardBorderSize] = useState<number>(3)
  const [boxPreviewSpaceBetweenCards, setBoxPreviewSpaceBetweenCards] = useState<number>(8)
  const [boxPreviewSpaceBetweenColumns, setBoxPreviewSpaceBetweenColumns] = useState<number>(1)
  const [boxPreviewFontSize, setBoxPreviewFontSize] = useState<number>(10)
  const [boxPreviewColumnWidths, setBoxPreviewColumnWidths] = useState<{ title: number; summary: number; amount: number; links: number }>({ title: 25, summary: 40, amount: 20, links: 15 })
  const [boxPreviewLinksColor, setBoxPreviewLinksColor] = useState<string>('#0066cc')
  const [boxPreviewSortBy, setBoxPreviewSortBy] = useState<'amount-desc' | 'number-asc' | 'title-asc'>('amount-desc')
  const [isResizingColumn, setIsResizingColumn] = useState<string | null>(null)
  const [boxPreviewRef, setBoxPreviewRef] = useState<HTMLDivElement | null>(null)
  const [savingPng, setSavingPng] = useState(false)
  const [addingToCanvas, setAddingToCanvas] = useState(false)
  const [showSendToCanvasModal, setShowSendToCanvasModal] = useState(false)
  const [sendToCanvasWidth, setSendToCanvasWidth] = useState(90)
  const [sendToCanvasY, setSendToCanvasY] = useState(0)
  const [sendToCanvasAlignment, setSendToCanvasAlignment] = useState<'left' | 'center' | 'right'>('center')
  const [childCanvases, setChildCanvases] = useState<Array<{ id: string; name: string }>>([])
  const [selectedChildCanvas, setSelectedChildCanvas] = useState<string>('')
  const [loadingChildCanvases, setLoadingChildCanvases] = useState(false)
  const [projectExists, setProjectExists] = useState<boolean | null>(null)
  const [loadingExistingReport, setLoadingExistingReport] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const isSyncingFromFirestoreRef = useRef(false)

  // Load block configuration and data
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
        setSourceBlockId(blockData['source-block-id'] || '')
        
        // Load styling settings
        if (blockData['box-preview-settings']) {
          const settings = blockData['box-preview-settings']
          if (settings.backgroundColor) setBoxPreviewBackgroundColor(settings.backgroundColor)
          if (settings.cardColorType) setBoxPreviewCardColorType(settings.cardColorType)
          if (settings.cardColor) setBoxPreviewCardColor(settings.cardColor)
          if (settings.cardGradientColor) setBoxPreviewCardGradientColor(settings.cardGradientColor)
          if (settings.cardBorderColor) setBoxPreviewCardBorderColor(settings.cardBorderColor)
          if (settings.cardBorderSize !== undefined) setBoxPreviewCardBorderSize(settings.cardBorderSize)
          if (settings.spaceBetweenCards !== undefined) setBoxPreviewSpaceBetweenCards(settings.spaceBetweenCards)
          if (settings.spaceBetweenColumns !== undefined) setBoxPreviewSpaceBetweenColumns(settings.spaceBetweenColumns)
          if (settings.fontSize !== undefined) setBoxPreviewFontSize(settings.fontSize)
          if (settings.columnWidths) setBoxPreviewColumnWidths(settings.columnWidths)
          if (settings.linksColor) setBoxPreviewLinksColor(settings.linksColor)
          if (settings.sortBy) setBoxPreviewSortBy(settings.sortBy)
        }

        // Load proposals from source general-table block
        if (blockData['source-block-id']) {
          await loadProposalsFromSource(blockData['source-block-id'])
        } else {
          setError('No source block configured. Please edit the block to select a source.')
          setLoading(false)
        }
      } catch (err) {
        console.error('Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoading(false)
      }
    }

    loadData()
  }, [blockId, projectId, folderId])

  // Load proposals from general-table block
  const loadProposalsFromSource = async (sourceBlockIdParam: string) => {
    try {
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', sourceBlockIdParam, 'table-data', 'general-table')
      const tableDataSnap = await getDoc(tableDataRef)
      
      if (!tableDataSnap.exists()) {
        setError('Source block has no data. Please ensure the general-table block has been generated.')
        setLoading(false)
        return
      }

      const tableData = tableDataSnap.data()
      if (tableData.proposals && Array.isArray(tableData.proposals) && tableData.proposals.length > 0) {
        setProposals(tableData.proposals as GardensProposal[])
        setLoading(false)
      } else {
        setError('Source block has no proposals. Please ensure the general-table block has been generated.')
        setLoading(false)
      }
    } catch (err) {
      console.error('Error loading proposals:', err)
      setError(err instanceof Error ? err.message : 'Failed to load proposals')
      setLoading(false)
    }
  }

  // Check if project exists in interoperable-canvas and load child canvases
  useEffect(() => {
    const checkProjectAndLoadChildCanvases = async () => {
      if (!projectId) return
      
      setLoadingChildCanvases(true)
      try {
        // Check if project exists
        const projectRef = doc(db, 'interoperable-canvas', projectId)
        const projectSnap = await getDoc(projectRef)
        setProjectExists(projectSnap.exists())

        if (projectSnap.exists()) {
          // Load child canvases
          const childCanvasesRef = collection(db, 'interoperable-canvas', projectId, 'child-canvases')
          const childCanvasesSnap = await getDocs(childCanvasesRef)
          
          const childs: Array<{ id: string; name: string }> = []
          childCanvasesSnap.forEach((doc) => {
            childs.push({
              id: doc.id,
              name: doc.data().name || doc.id
            })
          })
          
          setChildCanvases(childs.sort((a, b) => a.id.localeCompare(b.id)))
          
          // Auto-select first child if only one exists
          if (childs.length === 1) {
            setSelectedChildCanvas(childs[0].id)
          }
        }
      } catch (err) {
        console.error('Error checking project and loading child canvases:', err)
        setProjectExists(false)
      } finally {
        setLoadingChildCanvases(false)
      }
    }

    checkProjectAndLoadChildCanvases()
  }, [projectId])

  // Save styling settings to Firestore
  const saveBoxPreviewSettings = async (updates: Partial<{
    backgroundColor: string
    cardColorType: 'solid' | 'gradient'
    cardColor: string
    cardGradientColor: string
    cardBorderColor: string
    cardBorderSize: number
    spaceBetweenCards: number
    spaceBetweenColumns: number
    fontSize: number
    columnWidths: { title: number; summary: number; amount: number; links: number }
    linksColor: string
    sortBy: 'amount-desc' | 'number-asc' | 'title-asc'
  }>) => {
    if (!blockId || !projectId || !folderId) return
    if (isSyncingFromFirestoreRef.current) return

    try {
      const blockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId)
      const blockSnap = await getDoc(blockRef)
      const currentSettings = blockSnap.exists() ? (blockSnap.data()['box-preview-settings'] || {}) : {}

      await setDoc(blockRef, {
        'box-preview-settings': {
          ...currentSettings,
          ...updates
        },
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      console.error('Error saving box preview settings:', error)
    }
  }

  // Styling change handlers
  const handleBackgroundColorChange = async (color: string) => {
    setBoxPreviewBackgroundColor(color)
    await saveBoxPreviewSettings({ backgroundColor: color })
  }

  const handleCardColorTypeChange = async (type: 'solid' | 'gradient') => {
    setBoxPreviewCardColorType(type)
    await saveBoxPreviewSettings({ cardColorType: type })
  }

  const handleCardColorChange = async (color: string) => {
    setBoxPreviewCardColor(color)
    await saveBoxPreviewSettings({ cardColor: color })
  }

  const handleCardGradientColorChange = async (color: string) => {
    setBoxPreviewCardGradientColor(color)
    await saveBoxPreviewSettings({ cardGradientColor: color })
  }

  const handleCardBorderColorChange = async (color: string) => {
    setBoxPreviewCardBorderColor(color)
    await saveBoxPreviewSettings({ cardBorderColor: color })
  }

  const handleCardBorderSizeChange = async (value: number) => {
    setBoxPreviewCardBorderSize(value)
    await saveBoxPreviewSettings({ cardBorderSize: value })
  }

  const handleSpaceBetweenCardsChange = async (value: number) => {
    setBoxPreviewSpaceBetweenCards(value)
    await saveBoxPreviewSettings({ spaceBetweenCards: value })
  }

  const handleSpaceBetweenColumnsChange = async (value: number) => {
    setBoxPreviewSpaceBetweenColumns(value)
    await saveBoxPreviewSettings({ spaceBetweenColumns: value })
  }

  const handleFontSizeChange = async (value: number) => {
    setBoxPreviewFontSize(value)
    await saveBoxPreviewSettings({ fontSize: value })
  }

  const handleLinksColorChange = async (color: string) => {
    setBoxPreviewLinksColor(color)
    await saveBoxPreviewSettings({ linksColor: color })
  }

  const handleColumnWidthsChange = async (widths: { title: number; summary: number; amount: number; links: number }) => {
    setBoxPreviewColumnWidths(widths)
    await saveBoxPreviewSettings({ columnWidths: widths })
  }

  const handleResetColumns = async () => {
    const equalWidths = { title: 25, summary: 40, amount: 20, links: 15 }
    setBoxPreviewColumnWidths(equalWidths)
    await saveBoxPreviewSettings({ columnWidths: equalWidths })
  }

  // Format amount helper
  const formatAmount = (amount: string): string => {
    try {
      const amountBigInt = BigInt(amount)
      const divisor = BigInt('1000000000000000000')
      const wholePart = amountBigInt / divisor
      return wholePart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    } catch {
      return amount
    }
  }

  // Handle column resize drag
  const handleColumnResizeStart = (column: 'title' | 'summary' | 'amount' | 'links', e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingColumn(column)
    const startX = e.clientX
    const startWidths: { title: number; summary: number; amount: number; links: number } = { ...boxPreviewColumnWidths }
    const containerWidth = 1000 // Fixed container width
    let currentWidths: { title: number; summary: number; amount: number; links: number } = { ...startWidths }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const deltaPercent = (deltaX / containerWidth) * 100

      let newWidths = { ...currentWidths }
      
      if (column === 'title') {
        newWidths.title = Math.max(10, Math.min(70, startWidths.title + deltaPercent))
        const remaining = 100 - newWidths.title
        const otherTotal = startWidths.summary + startWidths.amount + startWidths.links
        if (otherTotal > 0) {
          newWidths.summary = (startWidths.summary / otherTotal) * remaining
          newWidths.amount = (startWidths.amount / otherTotal) * remaining
          newWidths.links = (startWidths.links / otherTotal) * remaining
        }
      } else if (column === 'summary') {
        newWidths.summary = Math.max(10, Math.min(70, startWidths.summary + deltaPercent))
        const remaining = 100 - newWidths.summary
        const otherTotal = startWidths.title + startWidths.amount + startWidths.links
        if (otherTotal > 0) {
          newWidths.title = (startWidths.title / otherTotal) * remaining
          newWidths.amount = (startWidths.amount / otherTotal) * remaining
          newWidths.links = (startWidths.links / otherTotal) * remaining
        }
      } else if (column === 'amount') {
        newWidths.amount = Math.max(10, Math.min(70, startWidths.amount + deltaPercent))
        const remaining = 100 - newWidths.amount
        const otherTotal = startWidths.title + startWidths.summary + startWidths.links
        if (otherTotal > 0) {
          newWidths.title = (startWidths.title / otherTotal) * remaining
          newWidths.summary = (startWidths.summary / otherTotal) * remaining
          newWidths.links = (startWidths.links / otherTotal) * remaining
        }
      } else if (column === 'links') {
        newWidths.links = Math.max(5, Math.min(30, startWidths.links + deltaPercent))
        const remaining = 100 - newWidths.links
        const otherTotal = startWidths.title + startWidths.summary + startWidths.amount
        if (otherTotal > 0) {
          newWidths.title = (startWidths.title / otherTotal) * remaining
          newWidths.summary = (startWidths.summary / otherTotal) * remaining
          newWidths.amount = (startWidths.amount / otherTotal) * remaining
        }
      }

      // Ensure all widths sum to 100%
      const total = newWidths.title + newWidths.summary + newWidths.amount + newWidths.links
      if (Math.abs(total - 100) > 0.01) {
        const scale = 100 / total
        newWidths.title *= scale
        newWidths.summary *= scale
        newWidths.amount *= scale
        newWidths.links *= scale
      }

      // Round to 2 decimal places
      newWidths.title = Math.round(newWidths.title * 100) / 100
      newWidths.summary = Math.round(newWidths.summary * 100) / 100
      newWidths.amount = Math.round(newWidths.amount * 100) / 100
      newWidths.links = Math.round(newWidths.links * 100) / 100

      currentWidths = newWidths
      setBoxPreviewColumnWidths(newWidths)
    }

    const handleMouseUp = () => {
      setIsResizingColumn(null)
      // Save final widths to Firestore
      handleColumnWidthsChange(currentWidths)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Handle Save PNG Click
  const handleSavePngClick = async () => {
    if (!projectId || !selectedChildCanvas || !boxPreviewRef) {
      alert('Please ensure project ID, child canvas, and box preview are set')
      return
    }

    if (!sourceBlockId) {
      alert('No source block configured. Please edit the block to select a source.')
      return
    }

    // Use source block ID as filename
    const filename = sourceBlockId

    setSavingPng(true)
    try {
      const baseFilename = filename.endsWith('.png') 
        ? filename.replace('.png', '') 
        : filename

      // Temporarily remove background color for transparent export
      const originalBg = boxPreviewRef.style.backgroundColor
      boxPreviewRef.style.setProperty('background-color', 'transparent', 'important')

      try {
        // Generate PNGs at 1x, 2x, and 3x resolutions
        const scales = [1, 2, 3]
        const uploadPromises = scales.map(async (scale) => {
          const dataUrl = await toPng(boxPreviewRef, {
            pixelRatio: scale,
          })

          // Convert data URL to blob
          const response = await fetch(dataUrl)
          const blob = await response.blob()

          const pngFilename = scale === 1 
            ? `${baseFilename}.png`
            : `${baseFilename}@${scale}x.png`
          
          const storagePath = `interoperable-canvas/assets/${projectId}/child-canvases/${selectedChildCanvas}/gardens-reports/${pngFilename}`
          const storageRef = ref(storage, storagePath)
          
          await uploadBytes(storageRef, blob, {
            contentType: 'image/png',
            cacheControl: 'public, max-age=31536000',
          })

          return pngFilename
        })

        const savedFiles = await Promise.all(uploadPromises)
        alert(`✅ PNG saved successfully:\n${savedFiles.join('\n')}`)
      } finally {
        // Restore original background
        if (originalBg) {
          boxPreviewRef.style.backgroundColor = originalBg
        } else {
          boxPreviewRef.style.backgroundColor = ''
        }
      }
    } catch (error) {
      console.error('Error saving PNG:', error)
      alert(`❌ Error saving PNG: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSavingPng(false)
    }
  }

  // Find or generate a unique prefix for this final view block
  const findOrGeneratePrefix = async (): Promise<string> => {
    if (!projectId || !selectedChildCanvas) return 'gardens-final-view'

    try {
      const firestorePath = `interoperable-canvas/${projectId}/child-canvases/${selectedChildCanvas}/canvases/root`
      const overlayCollectionPath = `${firestorePath}/overlay`
      const overlayCollectionRef = collection(db, overlayCollectionPath)
      const allBoxesSnapshot = await getDocs(overlayCollectionRef)
      
      // Check if this blockId already has boxes on the canvas
      let existingPrefix: string | null = null
      allBoxesSnapshot.forEach((docSnap) => {
        const boxId = docSnap.id
        const data = docSnap.data() as any
        
        // Check if this box belongs to this final view block
        if (data.finalViewBlockId === blockId && !boxId.includes('_overlay_')) {
          // Extract prefix from boxId (e.g., "gardens-final-view" or "gardens-final-view2")
          if (boxId.startsWith('gardens-final-view')) {
            const match = boxId.match(/^(gardens-final-view\d*)/)
            if (match) {
              existingPrefix = match[1]
            }
          }
        }
      })
      
      if (existingPrefix) {
        return existingPrefix
      }
      
      // Find the next available number
      const usedPrefixes = new Set<string>()
      allBoxesSnapshot.forEach((docSnap) => {
        const boxId = docSnap.id
        if (boxId.startsWith('gardens-final-view') && !boxId.includes('_overlay_')) {
          const match = boxId.match(/^(gardens-final-view\d*)/)
          if (match) {
            usedPrefixes.add(match[1])
          }
        }
      })
      
      // Find next available number
      if (!usedPrefixes.has('gardens-final-view')) {
        return 'gardens-final-view'
      }
      
      let num = 2
      while (usedPrefixes.has(`gardens-final-view${num}`)) {
        num++
      }
      
      return `gardens-final-view${num}`
    } catch (error) {
      console.error('Error finding prefix:', error)
      return 'gardens-final-view'
    }
  }

  // Check for existing report and load its values
  const checkExistingReport = async (): Promise<{ id: string; width: number; y: number; alignment: 'left' | 'center' | 'right' } | null> => {
    if (!projectId || !selectedChildCanvas) return null

    setLoadingExistingReport(true)
    try {
      const firestorePath = `interoperable-canvas/${projectId}/child-canvases/${selectedChildCanvas}/canvases/root`
      const overlayCollectionPath = `${firestorePath}/overlay`
      const overlayCollectionRef = collection(db, overlayCollectionPath)
      const allBoxesSnapshot = await getDocs(overlayCollectionRef)
      
      let existingReport: { id: string; width: number; y: number; alignment: 'left' | 'center' | 'right' } | null = null
      allBoxesSnapshot.forEach((docSnap) => {
        const boxId = docSnap.id
        const data = docSnap.data() as any
        
        // Check if this box belongs to this final view block
        if (data.finalViewBlockId === blockId && !boxId.includes('_overlay_')) {
          const canvasWidth = 1100
          const currentWidth = data.w || canvasWidth * 0.9
          const widthPercent = Math.round((currentWidth / canvasWidth) * 100)
          
          const currentX = data.x || 0
          const centerX = (canvasWidth - currentWidth) / 2
          const leftX = 0
          const rightX = canvasWidth - currentWidth
          
          let alignment: 'left' | 'center' | 'right' = 'center'
          if (Math.abs(currentX - centerX) < 5) {
            alignment = 'center'
          } else if (Math.abs(currentX - leftX) < 5) {
            alignment = 'left'
          } else if (Math.abs(currentX - rightX) < 5) {
            alignment = 'right'
          }
          
          existingReport = {
            id: boxId,
            width: Math.max(50, Math.min(90, widthPercent)),
            y: data.y || 0,
            alignment
          }
        }
      })
      
      return existingReport
    } catch (error) {
      console.error('Error checking existing report:', error)
      return null
    } finally {
      setLoadingExistingReport(false)
    }
  }

  // Handle opening Send to Canvas modal
  const handleSendToCanvasClick = async () => {
    if (!projectId || !selectedChildCanvas || !boxPreviewRef) {
      alert('Please ensure project ID, child canvas, and box preview are set')
      return
    }

    if (!sourceBlockId) {
      alert('No source block configured. Please edit the block to select a source.')
      return
    }

    // Check for existing report and load values
    const existing = await checkExistingReport()
    if (existing !== null) {
      setSendToCanvasWidth(existing.width)
      setSendToCanvasY(existing.y)
      setSendToCanvasAlignment(existing.alignment)
    } else {
      setSendToCanvasWidth(90)
      setSendToCanvasY(0)
      setSendToCanvasAlignment('center')
    }
    
    setShowSendToCanvasModal(true)
  }

  // Handle Add to Canvas
  const handleAddToCanvas = async (widthPercent: number, yPosition: number, alignment: 'left' | 'center' | 'right') => {
    if (!projectId || !selectedChildCanvas || !boxPreviewRef) {
      alert('Please ensure project ID, child canvas, and box preview are set')
      return
    }

    if (!sourceBlockId) {
      alert('No source block configured. Please edit the block to select a source.')
      return
    }

    const pngFilenameToUse = sourceBlockId

    // Verify the PNG file exists
    try {
      const png1xPath = `interoperable-canvas/assets/${projectId}/child-canvases/${selectedChildCanvas}/gardens-reports/${pngFilenameToUse}.png`
      const png1xRef = ref(storage, png1xPath)
      await getDownloadURL(png1xRef)
    } catch (error) {
      alert(`PNG file "${pngFilenameToUse}.png" not found. Please save a PNG first using "Save as PNG" button.`)
      return
    }

    setAddingToCanvas(true)
    try {
      const png1xPath = `interoperable-canvas/assets/${projectId}/child-canvases/${selectedChildCanvas}/gardens-reports/${pngFilenameToUse}.png`
      const png1xRef = ref(storage, png1xPath)
      const png1xUrl = await getDownloadURL(png1xRef)

      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = png1xUrl
      })

      const canvasWidth = 1100
      const boxWidth = Math.round((widthPercent / 100) * canvasWidth)
      
      let boxX = 0
      if (alignment === 'center') {
        boxX = Math.round((canvasWidth - boxWidth) / 2)
      } else if (alignment === 'right') {
        boxX = Math.round(canvasWidth - boxWidth)
      } else {
        boxX = 0
      }
      
      const aspectRatio = img.height / img.width
      const boxHeight = Math.round(boxWidth * aspectRatio)

      // Find or generate the prefix for this final view block
      const prefix = await findOrGeneratePrefix()
      
      const firestorePath = `interoperable-canvas/${projectId}/child-canvases/${selectedChildCanvas}/canvases/root`
      const overlayCollectionPath = `${firestorePath}/overlay`
      const overlayCollectionRef = collection(db, overlayCollectionPath)
      const allBoxesSnapshot = await getDocs(overlayCollectionRef)
      
      // Find all boxes with this specific prefix (for this final view block)
      const boxesToDelete: string[] = []
      allBoxesSnapshot.forEach((docSnap) => {
        const boxId = docSnap.id
        const data = docSnap.data() as any
        
        // Check if box belongs to this final view block and uses the prefix
        if (data.finalViewBlockId === blockId && boxId.startsWith(prefix)) {
          boxesToDelete.push(boxId)
        }
      })
      
      // Remove all boxes with this prefix (main box + all overlays)
      if (boxesToDelete.length > 0) {
        const deletePromises = boxesToDelete.map(async (boxIdToDelete) => {
          const boxRef = doc(db, overlayCollectionPath, boxIdToDelete)
          await deleteDoc(boxRef)
        })
        
        await Promise.all(deletePromises)
        
        // Update layers to remove deleted boxes
        const canvasRef = doc(db, firestorePath)
        const canvasSnap = await getDoc(canvasRef)
        if (canvasSnap.exists()) {
          const currentLayers = canvasSnap.data().layers || []
          const newLayers = currentLayers.filter((id: string) => !boxesToDelete.includes(id))
          const newZIndexMap: Record<string, number> = {}
          newLayers.forEach((id: string, idx: number) => {
            newZIndexMap[id] = idx
          })
          await setDoc(canvasRef, { layers: newLayers, zIndexMap: newZIndexMap }, { merge: true })
        }
      }

      const baseStoragePath = `interoperable-canvas/assets/${projectId}/child-canvases/${selectedChildCanvas}/gardens-reports`
      const png2xRef = ref(storage, `${baseStoragePath}/${pngFilenameToUse}@2x.png`)
      const png3xRef = ref(storage, `${baseStoragePath}/${pngFilenameToUse}@3x.png`)
      
      const [png2xUrl, png3xUrl] = await Promise.all([
        getDownloadURL(png2xRef).catch(() => null),
        getDownloadURL(png3xRef).catch(() => null),
      ])

      const srcsetParts: string[] = []
      srcsetParts.push(`${png1xUrl} 1x`)
      if (png2xUrl) srcsetParts.push(`${png2xUrl} 2x`)
      if (png3xUrl) srcsetParts.push(`${png3xUrl} 3x`)
      const srcset = srcsetParts.join(', ')

      const toTimestampSuffix = () => {
        const d = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const yyyy = d.getFullYear()
        const MM = pad(d.getMonth() + 1)
        const dd = pad(d.getDate())
        const hh = pad(d.getHours())
        const mm = pad(d.getMinutes())
        const ss = pad(d.getSeconds())
        return `${yyyy}${MM}${dd}${hh}${mm}${ss}`
      }

      // Use same timestamp for all boxes (main + overlays) so they can be identified together
      const timestampSuffix = toTimestampSuffix()
      const boxId = `${prefix}_${timestampSuffix}`
      const boxName = 'Gardens Final View'
      const boxNameKey = `${boxName}_${timestampSuffix}`

      const containerRect = boxPreviewRef.getBoundingClientRect()
      const containerWidth = containerRect.width
      const containerHeight = containerRect.height

      const overlayElements = boxPreviewRef.querySelectorAll('[data-overlay-type][data-overlay-url]')
      const overlayBoxes: Array<{
        proposalId: string
        linkType: 'proposal' | 'github' | 'karma'
        url: string
        x: number
        y: number
        w: number
        h: number
      }> = []

      overlayElements.forEach((element) => {
        const url = element.getAttribute('data-overlay-url')
        if (!url || url === '') return

        const linkType = element.getAttribute('data-overlay-type') as 'proposal' | 'github' | 'karma'
        const proposalId = element.getAttribute('data-proposal-id') || ''
        
        const rect = element.getBoundingClientRect()
        
        const xPercent = ((rect.left - containerRect.left) / containerWidth) * 100
        const yPercent = ((rect.top - containerRect.top) / containerHeight) * 100
        const wPercent = (rect.width / containerWidth) * 100
        const hPercent = (rect.height / containerHeight) * 100

        const overlayX = Math.round((xPercent / 100) * boxWidth) + boxX
        const overlayY = Math.round((yPercent / 100) * boxHeight) + yPosition
        const overlayW = Math.round((wPercent / 100) * boxWidth)
        const overlayH = Math.round((hPercent / 100) * boxHeight)

        overlayBoxes.push({
          proposalId,
          linkType,
          url,
          x: overlayX,
          y: overlayY,
          w: overlayW,
          h: overlayH,
        })
      })

      const boxRef = doc(db, overlayCollectionPath, boxId)
      await setDoc(boxRef, {
        id: boxId,
        x: boxX,
        y: yPosition,
        w: boxWidth,
        h: boxHeight,
        contentType: 'image',
        imageSrc: png1xUrl,
        imageSrcset: srcset,
        imageBehavior: 'contain',
        name: boxName,
        nameKey: boxNameKey,
        finalViewBlockId: blockId, // Store blockId to identify which final view block created this
      }, { merge: true })

      const overlayBoxPromises = overlayBoxes.map(async (overlay, index) => {
        // Use same prefix for all overlay boxes to match main box prefix
        // Reuse the same timestampSuffix so all boxes are grouped together
        const overlayBoxId = `${prefix}_${timestampSuffix}_overlay_${overlay.proposalId}_${overlay.linkType}_${index}`
        const overlayBoxRef = doc(db, overlayCollectionPath, overlayBoxId)
        
        await setDoc(overlayBoxRef, {
          id: overlayBoxId,
          x: overlay.x,
          y: overlay.y,
          w: overlay.w,
          h: overlay.h,
          contentType: 'link',
          url: overlay.url,
          clickable: true,
          openIn: 'new-tab',
          linkType: overlay.linkType,
          proposalId: overlay.proposalId,
          name: `${overlay.linkType.charAt(0).toUpperCase() + overlay.linkType.slice(1)} Link`,
          background: {
            mode: 'none'
          },
          finalViewBlockId: blockId, // Store blockId to identify which final view block created this
        }, { merge: true })

        return overlayBoxId
      })

      const overlayBoxIds = await Promise.all(overlayBoxPromises)

      // Add new boxes to layers (old boxes with this prefix have already been removed)
      const canvasRef = doc(db, firestorePath)
      const canvasSnap = await getDoc(canvasRef)
      const currentLayers = canvasSnap.exists() ? (canvasSnap.data().layers || []) : ['background']
      const currentZIndexMap = canvasSnap.exists() ? (canvasSnap.data().zIndexMap || {}) : { background: 0 }

      const layersWithoutNewBoxes = currentLayers.filter((id: string) => 
        id !== 'background' && id !== boxId && !overlayBoxIds.includes(id)
      )
      const newLayers = ['background', ...layersWithoutNewBoxes, boxId, ...overlayBoxIds]
      const newZIndexMap: Record<string, number> = {}
      newLayers.forEach((id: string, idx: number) => {
        newZIndexMap[id] = idx
      })

      await setDoc(canvasRef, {
        layers: newLayers,
        zIndexMap: newZIndexMap,
      }, { merge: true })

      setShowSendToCanvasModal(false)
      alert(`✅ Gardens report added to canvas successfully! ${overlayBoxes.length} clickable links created.`)
    } catch (error) {
      console.error('Error adding to canvas:', error)
      alert(`❌ Error adding to canvas: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setAddingToCanvas(false)
    }
  }

  // Manual refresh
  const handleRefresh = async () => {
    if (!sourceBlockId) {
      setError('No source block configured')
      return
    }
    setIsRefreshing(true)
    setError(null)
    try {
      await loadProposalsFromSource(sourceBlockId)
    } catch (err) {
      console.error('Error refreshing proposals:', err)
      setError(err instanceof Error ? err.message : 'Failed to refresh proposals')
    } finally {
      setIsRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading final view...
      </div>
    )
  }

  if (error && proposals.length === 0) {
    return (
      <div className="p-4 text-center text-red-500">
        {error}
        {sourceBlockId && (
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="ml-4 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 flex-1 flex flex-col overflow-hidden">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Refresh button */}
      {proposals.length > 0 && sourceBlockId && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || loading || !sourceBlockId}
            className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Box Preview Section */}
      {proposals.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-2">
              {/* Child Canvas Dropdown */}
              {projectExists === false && (
                <div className="text-sm text-red-600 mr-2">
                  Project does not exist in interoperable-canvas. Please create it manually.
                </div>
              )}
              {projectExists === true && (
                <select
                  value={selectedChildCanvas}
                  onChange={(e) => setSelectedChildCanvas(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 bg-white"
                  disabled={loadingChildCanvases}
                >
                  <option value="">Select child canvas...</option>
                  {childCanvases.length === 0 ? (
                    <option value="" disabled>No child canvases found</option>
                  ) : (
                    childCanvases.map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.name}
                      </option>
                    ))
                  )}
                </select>
              )}
              <button
                onClick={handleSavePngClick}
                disabled={savingPng || !projectId || !selectedChildCanvas || !boxPreviewRef || projectExists === false}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  savingPng || !projectId || !selectedChildCanvas || !boxPreviewRef || projectExists === false
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {savingPng ? 'Saving...' : 'Save as PNG'}
              </button>
              <button
                onClick={handleSendToCanvasClick}
                disabled={addingToCanvas || !projectId || !selectedChildCanvas || loadingExistingReport || projectExists === false}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  addingToCanvas || !projectId || !selectedChildCanvas || loadingExistingReport || projectExists === false
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
              >
                {loadingExistingReport ? 'Loading...' : addingToCanvas ? 'Adding...' : 'Send to Canvas'}
              </button>
            </div>
          </div>
          <div className="space-y-4">
              {/* Styling Controls */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {/* Background Color */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Background (not exported):</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={boxPreviewBackgroundColor}
                      onChange={(e) => handleBackgroundColorChange(e.target.value)}
                      className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600">{boxPreviewBackgroundColor}</span>
                  </div>
                </div>

                {/* Card Color */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Card Color:</label>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="flex items-center gap-1 text-xs text-gray-900">
                      <input
                        type="radio"
                        name="cardColorType"
                        checked={boxPreviewCardColorType === 'solid'}
                        onChange={() => handleCardColorTypeChange('solid')}
                        className="cursor-pointer"
                      />
                      Solid
                    </label>
                    <label className="flex items-center gap-1 text-xs text-gray-900">
                      <input
                        type="radio"
                        name="cardColorType"
                        checked={boxPreviewCardColorType === 'gradient'}
                        onChange={() => handleCardColorTypeChange('gradient')}
                        className="cursor-pointer"
                      />
                      Gradient
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={boxPreviewCardColor}
                      onChange={(e) => handleCardColorChange(e.target.value)}
                      className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600">{boxPreviewCardColor}</span>
                  </div>
                  {boxPreviewCardColorType === 'gradient' && (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="color"
                        value={boxPreviewCardGradientColor}
                        onChange={(e) => handleCardGradientColorChange(e.target.value)}
                        className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                      />
                      <span className="text-xs text-gray-600">{boxPreviewCardGradientColor}</span>
                    </div>
                  )}
                </div>

                {/* Card Border Size */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Border Size:</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCardBorderSizeChange(Math.max(0, boxPreviewCardBorderSize - 1))}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >-</button>
                    <span className="text-xs text-gray-900 w-8 text-center">{boxPreviewCardBorderSize}px</span>
                    <button
                      onClick={() => handleCardBorderSizeChange(boxPreviewCardBorderSize + 1)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >+</button>
                  </div>
                </div>

                {/* Card Border Color */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Card Border Color:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={boxPreviewCardBorderColor}
                      onChange={(e) => handleCardBorderColorChange(e.target.value)}
                      className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600">{boxPreviewCardBorderColor}</span>
                  </div>
                </div>

                {/* Space Between Cards */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Space Between Cards:</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSpaceBetweenCardsChange(Math.max(0, boxPreviewSpaceBetweenCards - 1))}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >-</button>
                    <span className="text-xs text-gray-600 w-8 text-center">{boxPreviewSpaceBetweenCards}px</span>
                    <button
                      onClick={() => handleSpaceBetweenCardsChange(boxPreviewSpaceBetweenCards + 1)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >+</button>
                  </div>
                </div>

                {/* Space Between Columns */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Space Between Columns:</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSpaceBetweenColumnsChange(Math.max(0, boxPreviewSpaceBetweenColumns - 1))}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >-</button>
                    <span className="text-xs text-gray-600 w-8 text-center">{boxPreviewSpaceBetweenColumns}px</span>
                    <button
                      onClick={() => handleSpaceBetweenColumnsChange(boxPreviewSpaceBetweenColumns + 1)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >+</button>
                  </div>
                </div>

                {/* Font Size */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Font Size:</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleFontSizeChange(Math.max(8, boxPreviewFontSize - 1))}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >-</button>
                    <span className="text-xs text-gray-900 w-10 text-center">{boxPreviewFontSize}pt</span>
                    <button
                      onClick={() => handleFontSizeChange(boxPreviewFontSize + 1)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                    >+</button>
                  </div>
                </div>

                {/* Links Color */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Links Color:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={boxPreviewLinksColor}
                      onChange={(e) => handleLinksColorChange(e.target.value)}
                      className="w-10 h-8 border border-gray-300 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600">{boxPreviewLinksColor}</span>
                  </div>
                </div>

                {/* Sort Cards */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Sort Cards:</label>
                  <select
                    value={boxPreviewSortBy}
                    onChange={(e) => {
                      const newSort = e.target.value as 'amount-desc' | 'number-asc' | 'title-asc'
                      setBoxPreviewSortBy(newSort)
                      saveBoxPreviewSettings({ sortBy: newSort })
                    }}
                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-600"
                    style={{ color: '#4b5563' }}
                  >
                    <option value="amount-desc" style={{ color: '#4b5563' }}>Amount (descending)</option>
                    <option value="number-asc" style={{ color: '#4b5563' }}>Proposal Number (ascending)</option>
                    <option value="title-asc" style={{ color: '#4b5563' }}>Proposal Title (ascending)</option>
                  </select>
                </div>

                {/* Reset Columns */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">&nbsp;</label>
                  <button
                    onClick={handleResetColumns}
                    className="text-xs border border-gray-300 rounded px-3 py-1 bg-white text-gray-600 hover:bg-gray-50"
                  >
                    Reset Columns
                  </button>
                </div>
              </div>
              
              {/* Preview Container with Cards */}
              <div className="bg-gray-200 p-8 flex justify-center">
                <div 
                  ref={setBoxPreviewRef}
                  className="rounded-lg shadow-lg p-4 relative"
                  style={{ 
                    width: '1000px', 
                    minHeight: '200px', 
                    backgroundColor: boxPreviewBackgroundColor 
                  }}
                >
                  {/* Cards Container */}
                  <div style={{ width: '100%' }}>
                    {[...proposals].sort((a, b) => {
                      if (boxPreviewSortBy === 'amount-desc') {
                        return Number(b.requestedAmount) - Number(a.requestedAmount)
                      } else if (boxPreviewSortBy === 'number-asc') {
                        return Number(a.id) - Number(b.id)
                      } else if (boxPreviewSortBy === 'title-asc') {
                        return (a.title || '').localeCompare(b.title || '')
                      }
                      return 0
                    }).map((proposal, index) => (
                      <div
                        key={proposal.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `${boxPreviewColumnWidths.title}% ${boxPreviewSpaceBetweenColumns}px ${boxPreviewColumnWidths.summary}% ${boxPreviewSpaceBetweenColumns}px ${boxPreviewColumnWidths.amount}% ${boxPreviewSpaceBetweenColumns}px ${boxPreviewColumnWidths.links}%`,
                          marginBottom: index < proposals.length - 1 ? `${boxPreviewSpaceBetweenCards}px` : '0',
                          backgroundColor: boxPreviewCardColorType === 'gradient' 
                            ? undefined 
                            : boxPreviewCardColor,
                          backgroundImage: boxPreviewCardColorType === 'gradient'
                            ? `linear-gradient(to bottom right, ${boxPreviewCardColor}, ${boxPreviewCardGradientColor})`
                            : undefined,
                          border: `${boxPreviewCardBorderSize}px solid ${boxPreviewCardBorderColor}`,
                          borderRadius: '50px',
                          padding: '12px 16px',
                          fontSize: `${boxPreviewFontSize}pt`,
                          width: '100%'
                        }}
                      >
                        {/* Title Column */}
                        <div style={{ 
                          fontWeight: 'bold', 
                          color: '#1f2937', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          paddingRight: '8px'
                        }}>
                          {proposal.title || '-'}
                        </div>
                        
                        {/* Divider */}
                        <div style={{
                          width: '6px',
                          height: '100%',
                          margin: '0 auto',
                          position: 'relative',
                          background: 'transparent'
                        }}>
                          <div style={{
                            position: 'absolute',
                            left: '0',
                            top: '0',
                            bottom: '0',
                            width: '2px',
                            backgroundColor: boxPreviewCardBorderColor,
                            opacity: 0.3,
                            boxShadow: '-1px 0 1px rgba(255, 255, 255, 0.1)'
                          }} />
                          <div style={{
                            position: 'absolute',
                            right: '0',
                            top: '0',
                            bottom: '0',
                            width: '2px',
                            backgroundColor: boxPreviewCardBorderColor,
                            opacity: 0.3,
                            boxShadow: '-1px 0 1px rgba(255, 255, 255, 0.1)'
                          }} />
                        </div>
                        
                        {/* Summary Column */}
                        <div style={{ 
                          color: '#4b5563', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          paddingLeft: '8px',
                          paddingRight: '8px'
                        }}>
                          {proposal.summary || '-'}
                        </div>
                        
                        {/* Divider */}
                        <div style={{
                          width: '6px',
                          height: '100%',
                          margin: '0 auto',
                          position: 'relative',
                          background: 'transparent'
                        }}>
                          <div style={{
                            position: 'absolute',
                            left: '0',
                            top: '0',
                            bottom: '0',
                            width: '2px',
                            backgroundColor: boxPreviewCardBorderColor,
                            opacity: 0.3,
                            boxShadow: '-1px 0 1px rgba(255, 255, 255, 0.1)'
                          }} />
                          <div style={{
                            position: 'absolute',
                            right: '0',
                            top: '0',
                            bottom: '0',
                            width: '2px',
                            backgroundColor: boxPreviewCardBorderColor,
                            opacity: 0.3,
                            boxShadow: '-1px 0 1px rgba(255, 255, 255, 0.1)'
                          }} />
                        </div>
                        
                        {/* Requested Amount Column */}
                        <div style={{ 
                          color: '#1f2937', 
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          paddingLeft: '8px',
                          paddingRight: '8px'
                        }}>
                          <div>This proposal received</div>
                          <div style={{ fontWeight: 'bold' }}>
                            {formatAmount(proposal.requestedAmount)} {proposal.tokenSymbol || ''}
                          </div>
                        </div>

                        {/* Divider */}
                        <div style={{
                          width: '6px',
                          height: '100%',
                          margin: '0 auto',
                          position: 'relative',
                          background: 'transparent'
                        }}>
                          <div style={{
                            position: 'absolute',
                            left: '0',
                            top: '0',
                            bottom: '0',
                            width: '2px',
                            backgroundColor: boxPreviewCardBorderColor,
                            opacity: 0.3,
                            boxShadow: '-1px 0 1px rgba(255, 255, 255, 0.1)'
                          }} />
                          <div style={{
                            position: 'absolute',
                            right: '0',
                            top: '0',
                            bottom: '0',
                            width: '2px',
                            backgroundColor: boxPreviewCardBorderColor,
                            opacity: 0.3,
                            boxShadow: '-1px 0 1px rgba(255, 255, 255, 0.1)'
                          }} />
                        </div>

                        {/* Links Column */}
                        <div style={{ 
                          display: 'flex',
                          flexDirection: 'column',
                          height: '100%',
                          paddingLeft: '8px'
                        }}>
                          {/* Proposal Link */}
                          <div 
                            data-overlay-type="proposal"
                            data-proposal-id={proposal.id}
                            data-overlay-url={proposal.proposalUrl || ''}
                            style={{
                              flex: '1',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              position: 'relative',
                              cursor: proposal.proposalUrl ? 'pointer' : 'default'
                            }}
                            onClick={() => {
                              if (proposal.proposalUrl) {
                                window.open(proposal.proposalUrl as string, '_blank', 'noopener,noreferrer')
                              }
                            }}
                          >
                            {proposal.proposalUrl && (
                              <>
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  zIndex: 1
                                }} />
                                <span style={{
                                  fontWeight: 'bold',
                                  color: boxPreviewLinksColor,
                                  textDecoration: 'underline',
                                  position: 'relative',
                                  zIndex: 0,
                                  pointerEvents: 'none'
                                }}>
                                  Proposal
                                </span>
                              </>
                            )}
                          </div>
                          
                          {/* Github Link */}
                          <div 
                            data-overlay-type="github"
                            data-proposal-id={proposal.id}
                            data-overlay-url={proposal.github || ''}
                            style={{
                              flex: '1',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              position: 'relative',
                              cursor: proposal.github ? 'pointer' : 'default'
                            }}
                            onClick={() => {
                              if (proposal.github) {
                                window.open(proposal.github as string, '_blank', 'noopener,noreferrer')
                              }
                            }}
                          >
                            {proposal.github && (
                              <>
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  zIndex: 1
                                }} />
                                <span style={{
                                  fontWeight: 'bold',
                                  color: boxPreviewLinksColor,
                                  textDecoration: 'underline',
                                  position: 'relative',
                                  zIndex: 0,
                                  pointerEvents: 'none'
                                }}>
                                  Github
                                </span>
                              </>
                            )}
                          </div>
                          
                          {/* Karma Link */}
                          <div 
                            data-overlay-type="karma"
                            data-proposal-id={proposal.id}
                            data-overlay-url={proposal.karmaProfile || ''}
                            style={{
                              flex: '1',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              position: 'relative',
                              cursor: proposal.karmaProfile ? 'pointer' : 'default'
                            }}
                            onClick={() => {
                              if (proposal.karmaProfile) {
                                window.open(proposal.karmaProfile as string, '_blank', 'noopener,noreferrer')
                              }
                            }}
                          >
                            {proposal.karmaProfile && (
                              <>
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  zIndex: 1
                                }} />
                                <span style={{
                                  fontWeight: 'bold',
                                  color: boxPreviewLinksColor,
                                  textDecoration: 'underline',
                                  position: 'relative',
                                  zIndex: 0,
                                  pointerEvents: 'none'
                                }}>
                                  Karma
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Resize Handles */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '16px',
                      left: '16px',
                      right: '16px',
                      bottom: '16px',
                      pointerEvents: 'none',
                      zIndex: 10
                    }}
                  >
                    {/* Resize handle between title and summary */}
                    <div
                      onMouseDown={(e) => handleColumnResizeStart('title', e)}
                      style={{
                        position: 'absolute',
                        left: `calc(${boxPreviewColumnWidths.title}% - ${boxPreviewSpaceBetweenColumns / 2}px)`,
                        top: '0',
                        bottom: '0',
                        width: '6px',
                        cursor: 'col-resize',
                        pointerEvents: 'auto',
                        zIndex: 20
                      }}
                    />
                    
                    {/* Resize handle between summary and amount */}
                    <div
                      onMouseDown={(e) => handleColumnResizeStart('summary', e)}
                      style={{
                        position: 'absolute',
                        left: `calc(${boxPreviewColumnWidths.title}% + ${boxPreviewSpaceBetweenColumns}px + ${boxPreviewColumnWidths.summary}% - ${boxPreviewSpaceBetweenColumns / 2}px)`,
                        top: '0',
                        bottom: '0',
                        width: '6px',
                        cursor: 'col-resize',
                        pointerEvents: 'auto',
                        zIndex: 20
                      }}
                    />
                    
                    {/* Resize handle between amount and links */}
                    <div
                      onMouseDown={(e) => handleColumnResizeStart('amount', e)}
                      style={{
                        position: 'absolute',
                        left: `calc(${boxPreviewColumnWidths.title}% + ${boxPreviewSpaceBetweenColumns}px + ${boxPreviewColumnWidths.summary}% + ${boxPreviewSpaceBetweenColumns}px + ${boxPreviewColumnWidths.amount}% - ${boxPreviewSpaceBetweenColumns / 2}px)`,
                        top: '0',
                        bottom: '0',
                        width: '6px',
                        cursor: 'col-resize',
                        pointerEvents: 'auto',
                        zIndex: 20
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Send to Canvas Modal */}
      {showSendToCanvasModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-gray-900">Send to Canvas</h3>
                <button
                  onClick={() => setShowSendToCanvasModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Width: {sendToCanvasWidth}% ({Math.round((sendToCanvasWidth / 100) * 1100)}px)
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    value={sendToCanvasWidth}
                    onChange={(e) => setSendToCanvasWidth(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Y Position: {sendToCanvasY}px
                  </label>
                  <input
                    type="number"
                    value={sendToCanvasY}
                    onChange={(e) => setSendToCanvasY(Math.max(0, Number(e.target.value)))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Alignment</label>
                  <div className="flex gap-2">
                    <button
                      className={`px-4 py-2 rounded-md text-sm ${
                        sendToCanvasAlignment === 'left' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                      onClick={() => setSendToCanvasAlignment('left')}
                    >
                      Left
                    </button>
                    <button
                      className={`px-4 py-2 rounded-md text-sm ${
                        sendToCanvasAlignment === 'center' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                      onClick={() => setSendToCanvasAlignment('center')}
                    >
                      Center
                    </button>
                    <button
                      className={`px-4 py-2 rounded-md text-sm ${
                        sendToCanvasAlignment === 'right' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                      onClick={() => setSendToCanvasAlignment('right')}
                    >
                      Right
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-200">
                  <div className="text-sm text-gray-600 space-y-1">
                    <div>Width: {Math.round((sendToCanvasWidth / 100) * 1100)}px ({sendToCanvasWidth}% of canvas)</div>
                    <div>Y Position: {sendToCanvasY}px</div>
                    <div>Alignment: {sendToCanvasAlignment}</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowSendToCanvasModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setShowSendToCanvasModal(false)
                    await handleAddToCanvas(sendToCanvasWidth, sendToCanvasY, sendToCanvasAlignment)
                  }}
                  disabled={addingToCanvas}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {addingToCanvas ? 'Sending...' : 'Send to Canvas'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

