'use client'

import React, { useState, useEffect, useRef } from 'react'
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { initializeApp, getApps } from 'firebase/app'
import { toPng, toJpeg } from 'html-to-image'
import { createSnapshotArchive, generateSnapshotId } from '../../utils/snapshotArchive'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

interface KarmaSerpentineBlockProps {
  blockId: string
  projectId: string
  folderId: string
  onEditClick?: () => void
}

interface FilteredRow {
  officialDate: string
  summary: string
  status: string
  slug: string
  title: string
  images?: {
    main?: string
    image2?: string
    image3?: string
  }
}

interface MonthData {
  month: string // "Dec-2024" format
  year: number
  monthIndex: number // 0-11
  rows: FilteredRow[]
  hasData: boolean
}

// Node represents a circle on the serpentine path
// A month with 1 row = 1 node, a month with 2 rows = 2 nodes (second is halfway to next month)
interface SerpentineNode {
  monthDataIndex: number // Index into monthsData array
  rowIndex: number // Which row within that month (0, 1)
  isExtraNode: boolean // True if this is the "halfway" node for 2nd row
  row: FilteredRow | null // The actual row data (null for months without data)
  month: string // "Dec-2024" format for label
  hasData: boolean
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig as any)
const db = getFirestore(app)
const storage = getStorage(app)

// Parse "nov-2025" or "Nov-2025" format to Date
const parseOfficialDate = (dateStr: string): Date | null => {
  if (!dateStr || typeof dateStr !== 'string') return null
  
  const parts = dateStr.toLowerCase().split('-')
  if (parts.length !== 2) return null
  
  const monthMap: Record<string, number> = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
  }
  
  const monthIndex = monthMap[parts[0]]
  const year = parseInt(parts[1], 10)
  
  if (monthIndex === undefined || isNaN(year)) return null
  
  return new Date(year, monthIndex, 1)
}

// Format date to "Dec-2024" format
const formatMonthYear = (date: Date): string => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]}-${date.getFullYear()}`
}

// Get first N characters from a string
const getFirstNCharacters = (str: string, n: number): string => {
  if (!str) return ''
  const trimmed = str.trim()
  if (trimmed.length <= n) return trimmed
  return trimmed.substring(0, n) + '...'
}

// Helper function to get the date value from a row based on priority order (from newsroom)
const getRowDate = (row: any): Date | null => {
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

// Sort rows: first rows with summary AND single date (ascending), then rest by date (descending, using newsroom logic)
const sortAttestationRows = (rows: any[]): any[] => {
  // Separate rows into two groups
  const withSummaryAndDate: any[] = []
  const rest: any[] = []

  rows.forEach((row) => {
    const hasSummary = row.summary && row.summary.trim() !== ''
    const hasSingleDate = row.officialDate && row.officialDate.trim() !== ''
    
    if (hasSummary && hasSingleDate) {
      withSummaryAndDate.push(row)
    } else {
      rest.push(row)
    }
  })

  // Sort first group by single date ascending
  withSummaryAndDate.sort((a, b) => {
    const dateA = new Date(a.officialDate)
    const dateB = new Date(b.officialDate)
    if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0
    if (isNaN(dateA.getTime())) return 1
    if (isNaN(dateB.getTime())) return -1
    return dateA.getTime() - dateB.getTime() // Ascending
  })

  // Sort rest using newsroom logic (descending, newest first)
  rest.sort((a, b) => {
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

  // Combine: first group first, then rest
  return [...withSummaryAndDate, ...rest]
}

// Compute SHA-256 hash of a string
const computeSHA256 = async (text: string): Promise<string> => {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

// Sanitize name for use in snapshot ID (filesystem-safe)
const sanitizeNameForId = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // Replace non-alphanumeric with dash
    .replace(/-+/g, '-') // Replace multiple dashes with single dash
    .replace(/^-|-$/g, '') // Remove leading/trailing dashes
}

// Convert image URL to base64 data URI
const imageUrlToBase64 = async (imageUrl: string): Promise<string | null> => {
  try {
    const response = await fetch(imageUrl)
    const blob = await response.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        resolve(result) // Returns data:image/png;base64,... format
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.error('Error converting image to base64:', error)
    return null
  }
}

// Darken a hex color by a percentage (0-1)
const darkenColor = (hex: string, amount: number = 0.4): string => {
  if (!hex) return '#000000'
  
  // Remove # if present
  hex = hex.replace('#', '')
  
  // Handle 3-digit hex colors
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('')
  }
  
  // Parse RGB values
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  
  // Darken by reducing RGB values
  const darkenedR = Math.max(0, Math.floor(r * (1 - amount)))
  const darkenedG = Math.max(0, Math.floor(g * (1 - amount)))
  const darkenedB = Math.max(0, Math.floor(b * (1 - amount)))
  
  // Convert back to hex
  const toHex = (n: number) => {
    const hex = n.toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }
  
  return `#${toHex(darkenedR)}${toHex(darkenedG)}${toHex(darkenedB)}`
}

// Generate SVG path for serpentine curve
const generateSerpentinePath = (
  width: number,
  height: number,
  rows: number,
  topPadding: number = 0,
  bottomPadding: number = 100,
  sidePadding: number = 50
): { path: string; points: { x: number; y: number }[] } => {
  const effectiveWidth = width - sidePadding * 2
  const effectiveHeight = height - topPadding - bottomPadding
  
  // For 30 months, we'll do 5 rows of 6 months each
  const monthsPerRow = 6
  const numRows = Math.ceil(rows / monthsPerRow)
  // Make vertical spacing shorter (reduced from 0.7 to 0.6 for tighter rows)
  const baseRowHeight = effectiveHeight / (numRows - 1 || 1)
  const rowHeight = baseRowHeight * 0.6
  
  const points: { x: number; y: number }[] = []
  let pathData = ''
  
  for (let i = 0; i < rows; i++) {
    const rowIndex = Math.floor(i / monthsPerRow)
    const posInRow = i % monthsPerRow
    const isLeftToRight = rowIndex % 2 === 0
    
    // Calculate x position based on direction
    const xProgress = posInRow / (monthsPerRow - 1 || 1)
    const x = isLeftToRight 
      ? sidePadding + xProgress * effectiveWidth
      : sidePadding + effectiveWidth - xProgress * effectiveWidth
    
    // Adjust y position: start at topPadding with no offset
    const y = topPadding + rowIndex * rowHeight
    
    points.push({ x, y })
  }
  
  // Build smooth SVG path using bezier curves
  if (points.length > 0) {
    pathData = `M ${points[0].x} ${points[0].y}`
    
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      
      // Check if we're transitioning between rows
      const prevRow = Math.floor((i - 1) / monthsPerRow)
      const currRow = Math.floor(i / monthsPerRow)
      
      if (prevRow !== currRow) {
        // Vertical transition with curve
        const midY = (prev.y + curr.y) / 2
        pathData += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`
      } else {
        // Horizontal movement with slight curve for smoothness
        const dx = (curr.x - prev.x) / 3
        pathData += ` C ${prev.x + dx} ${prev.y}, ${curr.x - dx} ${curr.y}, ${curr.x} ${curr.y}`
      }
    }
  }
  
  return { path: pathData, points }
}

export function KarmaSerpentineBlock({ blockId, projectId, folderId, onEditClick }: KarmaSerpentineBlockProps) {
  const [sourceBlockId, setSourceBlockId] = useState<string>('')
  const [monthsToShow, setMonthsToShow] = useState<number>(30)
  const [monthsInput, setMonthsInput] = useState<string>('30')
  const [monthsData, setMonthsData] = useState<MonthData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number>(1100)
  const [backgroundType, setBackgroundType] = useState<'solid' | 'gradient'>('gradient')
  const [backgroundFromColor, setBackgroundFromColor] = useState<string>('#dbe96d')
  const [backgroundToColor, setBackgroundToColor] = useState<string>('#4de538')
  
  // Serpentine styling
  const [serpentineColor, setSerpentineColor] = useState<string>('#94a3b8')
  const [serpentineStroke, setSerpentineStroke] = useState<number>(8)
  
  // Month node styling
  const [inactiveMonthSize, setInactiveMonthSize] = useState<number>(16)
  const [inactiveMonthColor, setInactiveMonthColor] = useState<string>('#e2e8f0')
  const [milestoneMonthSize, setMilestoneMonthSize] = useState<number>(40)
  const [milestoneMonthColor, setMilestoneMonthColor] = useState<string>('#3b82f6')
  const [showMilestoneImage, setShowMilestoneImage] = useState<boolean>(true)
  
  const isSyncingFromFirestoreRef = useRef(false)
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const circleRefs = useRef<Map<number, SVGCircleElement>>(new Map())
  const [cardCenters, setCardCenters] = useState<Map<number, { x: number; y: number }>>(new Map())
  
  // Card positions from Firestore (absolute x, y coordinates)
  const [cardPositions, setCardPositions] = useState<Record<number, { x: number; y: number }>>({})
  
  // Drag state
  const [draggingCardIndex, setDraggingCardIndex] = useState<number | null>(null)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const svgContainerRef = useRef<HTMLDivElement>(null)
  
  // Parameters modal state
  const [showParametersModal, setShowParametersModal] = useState(false)
  
  // Alert for 3+ rows in same month
  const [showMultiRowAlert, setShowMultiRowAlert] = useState(false)
  const [multiRowAlertMonths, setMultiRowAlertMonths] = useState<string[]>([])
  
  // Serpentine nodes (circles on the path, including extra nodes for 2nd rows)
  const [serpentineNodes, setSerpentineNodes] = useState<SerpentineNode[]>([])
  
  // Card text settings
  const [charactersInCard, setCharactersInCard] = useState<number>(90)
  const [cardFontSize, setCardFontSize] = useState<number>(10)
  
  // SVG dimensions
  const SVG_HEIGHT = 1300
  const TOP_PADDING = 100 // Top padding
  const BOTTOM_PADDING = 60 // Bottom padding
  const SIDE_PADDING = 60

  // Canvas export state
  const [childCanvases, setChildCanvases] = useState<Array<{ id: string; name: string }>>([])
  const [selectedChildCanvas, setSelectedChildCanvas] = useState<string>('')
  const [loadingChildCanvases, setLoadingChildCanvases] = useState(false)
  const [projectExists, setProjectExists] = useState<boolean | null>(null)
  const [savingPng, setSavingPng] = useState(false)
  const [addingToCanvas, setAddingToCanvas] = useState(false)
  const [showSendToCanvasModal, setShowSendToCanvasModal] = useState(false)
  const [sendToCanvasWidth, setSendToCanvasWidth] = useState(90)
  const [sendToCanvasY, setSendToCanvasY] = useState(0)
  const [sendToCanvasAlignment, setSendToCanvasAlignment] = useState<'left' | 'center' | 'right'>('center')
  const [loadingExistingReport, setLoadingExistingReport] = useState(false)

  // ICF (Immutable Canonical File) state
  const [creatingICF, setCreatingICF] = useState(false)
  const [icfUrl, setIcfUrl] = useState<string | null>(null)
  const [icfSnapshotId, setIcfSnapshotId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [folderName, setFolderName] = useState<string>('')

  // Load block configuration
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load project name
        const projectRef = doc(db, 'newsroom', projectId)
        const projectSnap = await getDoc(projectRef)
        if (projectSnap.exists()) {
          const projectData = projectSnap.data()
          setProjectName(projectData.name || projectId)
        } else {
          setProjectName(projectId)
        }

        // Load folder name
        const folderRef = doc(db, 'newsroom', projectId, 'folders', folderId)
        const folderSnap = await getDoc(folderRef)
        if (folderSnap.exists()) {
          const folderData = folderSnap.data()
          setFolderName(folderData.name || folderId)
        } else {
          setFolderName(folderId)
        }

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
        
        // Load saved months setting
        if (blockData['months-to-show']) {
          setMonthsToShow(blockData['months-to-show'])
          setMonthsInput(String(blockData['months-to-show']))
        }

        // Load background settings
        if (blockData['background-settings']) {
          const bgSettings = blockData['background-settings']
          if (bgSettings.type) setBackgroundType(bgSettings.type)
          if (bgSettings.fromColor) setBackgroundFromColor(bgSettings.fromColor)
          if (bgSettings.toColor) setBackgroundToColor(bgSettings.toColor)
        }

        // Load serpentine styling settings
        if (blockData['serpentine-settings']) {
          const serpSettings = blockData['serpentine-settings']
          if (serpSettings.color) setSerpentineColor(serpSettings.color)
          if (typeof serpSettings.stroke === 'number') setSerpentineStroke(serpSettings.stroke)
          if (typeof serpSettings.inactiveMonthSize === 'number') setInactiveMonthSize(serpSettings.inactiveMonthSize)
          if (serpSettings.inactiveMonthColor) setInactiveMonthColor(serpSettings.inactiveMonthColor)
          if (typeof serpSettings.milestoneMonthSize === 'number') setMilestoneMonthSize(serpSettings.milestoneMonthSize)
          if (serpSettings.milestoneMonthColor) setMilestoneMonthColor(serpSettings.milestoneMonthColor)
          if (typeof serpSettings.showMilestoneImage === 'boolean') setShowMilestoneImage(serpSettings.showMilestoneImage)
        }

        // Load card text settings
        if (typeof blockData['characters-in-card'] === 'number') {
          setCharactersInCard(blockData['characters-in-card'])
        }
        if (typeof blockData['card-font-size'] === 'number') {
          setCardFontSize(blockData['card-font-size'])
        }

        if (!sourceId) {
          setError('No source block configured. Please edit the block to select a source.')
          setLoading(false)
          return
        }

        // Try to load existing serpentine data
        const serpentineDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'serpentine-data', 'config')
        const serpentineDataSnap = await getDoc(serpentineDataRef)
        
        if (serpentineDataSnap.exists()) {
          const savedData = serpentineDataSnap.data()
          if (savedData.monthsData && Array.isArray(savedData.monthsData)) {
            setMonthsData(savedData.monthsData)
            
            // Load saved card positions
            if (savedData.cardPositions && typeof savedData.cardPositions === 'object') {
              // Convert string keys to numbers
              const positions: Record<number, { x: number; y: number }> = {}
              Object.entries(savedData.cardPositions).forEach(([key, value]) => {
                const numKey = parseInt(key, 10)
                if (!isNaN(numKey) && value && typeof value === 'object') {
                  positions[numKey] = value as { x: number; y: number }
                }
              })
              setCardPositions(positions)
            }
            
            setLoading(false)
            return
          }
        }

        // No existing data - generate from source block
        await generateSerpentineData(sourceId, blockData['months-to-show'] || 30)
      } catch (err) {
        console.error('Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoading(false)
      }
    }

    loadData()
  }, [blockId, projectId, folderId])

  // Update container width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth)
      }
    }
    
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

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
          childCanvasesSnap.forEach((docSnap) => {
            childs.push({
              id: docSnap.id,
              name: docSnap.data().name || docSnap.id
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

  // Generate serpentine nodes from monthsData
  // Each month with 1 row = 1 node, month with 2 rows = 2 nodes (second halfway to next)
  // If 3+ rows, show alert and only render first 2
  useEffect(() => {
    if (monthsData.length === 0) return

    const nodes: SerpentineNode[] = []
    const monthsWithTooManyRows: string[] = []

    for (let i = 0; i < monthsData.length; i++) {
      const monthData = monthsData[i]
      
      // Check for 3+ rows
      if (monthData.rows.length >= 3) {
        monthsWithTooManyRows.push(monthData.month)
      }

      if (monthData.rows.length === 0) {
        // No data - just one inactive node
        nodes.push({
          monthDataIndex: i,
          rowIndex: 0,
          isExtraNode: false,
          row: null,
          month: monthData.month,
          hasData: false
        })
      } else if (monthData.rows.length === 1) {
        // Single row - one active node
        nodes.push({
          monthDataIndex: i,
          rowIndex: 0,
          isExtraNode: false,
          row: monthData.rows[0],
          month: monthData.month,
          hasData: true
        })
      } else {
        // 2+ rows - first node at month position
        nodes.push({
          monthDataIndex: i,
          rowIndex: 0,
          isExtraNode: false,
          row: monthData.rows[0],
          month: monthData.month,
          hasData: true
        })
        // Second node (and beyond up to 2) - extra nodes halfway to next month
        // Only render first 2 rows as per requirement
        const maxRows = Math.min(monthData.rows.length, 2)
        for (let r = 1; r < maxRows; r++) {
          nodes.push({
            monthDataIndex: i,
            rowIndex: r,
            isExtraNode: true,
            row: monthData.rows[r],
            month: '', // No label for extra nodes
            hasData: true
          })
        }
      }
    }

    setSerpentineNodes(nodes)

    // Show alert if any month has 3+ rows
    if (monthsWithTooManyRows.length > 0) {
      setMultiRowAlertMonths(monthsWithTooManyRows)
      setShowMultiRowAlert(true)
    }
  }, [monthsData])

  // Calculate card centers after cards are rendered
  useEffect(() => {
    if (serpentineNodes.length === 0) return

    // Use requestAnimationFrame to ensure cards are positioned before measuring
    const measureCards = () => {
      const container = svgContainerRef.current
      if (!container) return
      
      const newCenters = new Map<number, { x: number; y: number }>()
      
      cardRefs.current.forEach((cardElement, index) => {
        if (cardElement) {
          const cardRect = cardElement.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          
          // Calculate center relative to container
          const centerX = cardRect.left - containerRect.left + cardRect.width / 2
          const centerY = cardRect.top - containerRect.top + cardRect.height / 2
          
          newCenters.set(index, { x: centerX, y: centerY })
        }
      })
      
      if (newCenters.size > 0) {
        setCardCenters(newCenters)
      }
    }

    requestAnimationFrame(measureCards)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serpentineNodes.length, containerWidth, Object.keys(cardPositions).length])

  // Generate serpentine data from source block
  const generateSerpentineData = async (sourceBlockIdParam: string, months: number = 30) => {
    try {
      // Load rows from karma-general-table source block
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', sourceBlockIdParam, 'table-data', 'karma-general-table')
      const tableDataSnap = await getDoc(tableDataRef)
      
      if (!tableDataSnap.exists()) {
        setError('Source block has no data. Please ensure the karma-general-table block has been generated.')
        setLoading(false)
        return
      }

      const tableData = tableDataSnap.data()
      const allRows = tableData.rows || []
      
      // Filter rows: must have officialDate, summary, and status contains "completed" OR "manually approved"
      const filteredRows: FilteredRow[] = allRows.filter((row: any) => {
        const hasOfficialDate = row.officialDate && row.officialDate.trim() !== ''
        const hasSummary = row.summary && row.summary.trim() !== ''
        const status = (row.status || '').toLowerCase()
        const hasValidStatus = status.includes('completed') || status.includes('manually approved')
        
        return hasOfficialDate && hasSummary && hasValidStatus
      }).map((row: any) => {
        const filteredRow: FilteredRow = {
          officialDate: row.officialDate,
          summary: row.summary,
          status: row.status,
          slug: row.slug || '',
          title: row.title || ''
        }
        // Only include images if it exists and has at least one image
        if (row.images && (row.images.main || row.images.image2 || row.images.image3)) {
          filteredRow.images = row.images
        }
        return filteredRow
      })

      // Generate month range: current month back to (months - 1) months ago
      const now = new Date()
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      
      const monthsDataArray: MonthData[] = []
      
      for (let i = months - 1; i >= 0; i--) {
        const monthDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - i, 1)
        const monthKey = formatMonthYear(monthDate)
        
        // Find rows that match this month
        const matchingRows = filteredRows.filter(row => {
          const rowDate = parseOfficialDate(row.officialDate)
          if (!rowDate) return false
          return rowDate.getFullYear() === monthDate.getFullYear() && 
                 rowDate.getMonth() === monthDate.getMonth()
        })
        
        monthsDataArray.push({
          month: monthKey,
          year: monthDate.getFullYear(),
          monthIndex: monthDate.getMonth(),
          rows: matchingRows,
          hasData: matchingRows.length > 0
        })
      }

      setMonthsData(monthsDataArray)
      
      // Save to Firestore
      const serpentineDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'serpentine-data', 'config')
      await setDoc(serpentineDataRef, {
        monthsData: monthsDataArray,
        sourceBlockId: sourceBlockIdParam,
        monthsToShow: months,
        generatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })

      setLoading(false)
    } catch (err) {
      console.error('Error generating serpentine data:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate serpentine data')
      setLoading(false)
    }
  }

  // Save background settings to Firestore
  // Note: When exporting to PNG (similar to FinalViewBlock), the background should be removed
  // by temporarily setting backgroundColor/backgroundImage to transparent before export
  const saveBackgroundSettings = async (updates: Partial<{
    type: 'solid' | 'gradient'
    fromColor: string
    toColor: string
  }>) => {
    if (!blockId || !projectId || !folderId) return
    if (isSyncingFromFirestoreRef.current) return

    try {
      const blockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId)
      const blockSnap = await getDoc(blockRef)
      const currentSettings = blockSnap.exists() ? (blockSnap.data()['background-settings'] || {}) : {}

      await setDoc(blockRef, {
        'background-settings': {
          ...currentSettings,
          ...updates
        },
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      console.error('Error saving background settings:', error)
    }
  }

  // Background change handlers
  const handleBackgroundTypeChange = async (type: 'solid' | 'gradient') => {
    setBackgroundType(type)
    await saveBackgroundSettings({ type })
  }

  const handleBackgroundFromColorChange = async (color: string) => {
    setBackgroundFromColor(color)
    await saveBackgroundSettings({ fromColor: color })
  }

  const handleBackgroundToColorChange = async (color: string) => {
    setBackgroundToColor(color)
    await saveBackgroundSettings({ toColor: color })
  }

  // Save serpentine styling settings to Firestore
  const saveSerpentineSettings = async (updates: Partial<{
    color: string
    stroke: number
    inactiveMonthSize: number
    inactiveMonthColor: string
    milestoneMonthSize: number
    milestoneMonthColor: string
    showMilestoneImage: boolean
  }>) => {
    if (!blockId || !projectId || !folderId) return
    if (isSyncingFromFirestoreRef.current) return

    try {
      const blockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId)
      const blockSnap = await getDoc(blockRef)
      const currentSettings = blockSnap.exists() ? (blockSnap.data()['serpentine-settings'] || {}) : {}

      await setDoc(blockRef, {
        'serpentine-settings': {
          ...currentSettings,
          ...updates
        },
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      console.error('Error saving serpentine settings:', error)
    }
  }

  // Serpentine styling change handlers
  const handleSerpentineColorChange = async (color: string) => {
    setSerpentineColor(color)
    await saveSerpentineSettings({ color })
  }

  const handleSerpentineStrokeChange = async (stroke: number) => {
    setSerpentineStroke(stroke)
    await saveSerpentineSettings({ stroke })
  }

  const handleInactiveMonthSizeChange = async (size: number) => {
    setInactiveMonthSize(size)
    await saveSerpentineSettings({ inactiveMonthSize: size })
  }

  const handleInactiveMonthColorChange = async (color: string) => {
    setInactiveMonthColor(color)
    await saveSerpentineSettings({ inactiveMonthColor: color })
  }

  const handleMilestoneMonthSizeChange = async (size: number) => {
    setMilestoneMonthSize(size)
    await saveSerpentineSettings({ milestoneMonthSize: size })
  }

  const handleMilestoneMonthColorChange = async (color: string) => {
    setMilestoneMonthColor(color)
    await saveSerpentineSettings({ milestoneMonthColor: color })
  }

  const handleShowMilestoneImageChange = async (show: boolean) => {
    setShowMilestoneImage(show)
    await saveSerpentineSettings({ showMilestoneImage: show })
  }

  // Save characters in card setting to Firestore
  const saveCharactersInCard = async (characters: number) => {
    if (!blockId || !projectId || !folderId) return
    if (isSyncingFromFirestoreRef.current) return

    try {
      const blockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId)
      await setDoc(blockRef, {
        'characters-in-card': characters,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      console.error('Error saving characters in card setting:', error)
    }
  }

  const handleCharactersInCardChange = async (characters: number) => {
    if (characters < 1 || characters > 500) return // Reasonable limits
    setCharactersInCard(characters)
    await saveCharactersInCard(characters)
  }

  // Save card font size setting to Firestore
  const saveCardFontSize = async (fontSize: number) => {
    if (!blockId || !projectId || !folderId) return
    if (isSyncingFromFirestoreRef.current) return

    try {
      const blockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId)
      await setDoc(blockRef, {
        'card-font-size': fontSize,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      console.error('Error saving card font size setting:', error)
    }
  }

  const handleCardFontSizeChange = async (fontSize: number) => {
    if (fontSize < 6 || fontSize > 24) return // Reasonable limits
    setCardFontSize(fontSize)
    await saveCardFontSize(fontSize)
  }

  // Save card positions to Firestore
  const saveCardPositions = async (positions: Record<number, { x: number; y: number }>) => {
    if (!blockId || !projectId || !folderId) return

    try {
      const serpentineDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'serpentine-data', 'config')
      await setDoc(serpentineDataRef, {
        cardPositions: positions,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      console.error('Error saving card positions:', error)
    }
  }

  // Get card position (saved or default)
  const getCardPosition = (index: number, point: { x: number; y: number }): { x: number; y: number } => {
    // If we have a saved position, use it
    if (cardPositions[index]) {
      return cardPositions[index]
    }
    
    const node = serpentineNodes[index]
    if (!node) {
      return { x: point.x, y: point.y - 130 }
    }
    
    // Calculate serpentine row (visual row in the path layout)
    const serpentineRowIndex = Math.floor(index / 6)
    const isAbove = serpentineRowIndex % 2 === 0
    const baseY = isAbove ? point.y - 130 : point.y + 100
    
    // For extra nodes (2nd row of same month), offset horizontally
    // Cards are placed side by side: first card slightly left, second card slightly right
    let xOffset = 0
    if (node.isExtraNode) {
      // This is a second row - offset to the right
      xOffset = 90 // Place 90px to the right
    } else if (node.hasData) {
      // Check if there's an extra node following this one for the same month
      const nextNode = serpentineNodes[index + 1]
      if (nextNode && nextNode.isExtraNode && nextNode.monthDataIndex === node.monthDataIndex) {
        // There's a second card - offset this one to the left
        xOffset = -90
      }
    }
    
    return {
      x: point.x + xOffset,
      y: baseY
    }
  }

  // Handle drag start
  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (!svgContainerRef.current) return
    
    const containerRect = svgContainerRef.current.getBoundingClientRect()
    const cardElement = cardRefs.current.get(index)
    if (!cardElement) return
    
    const cardRect = cardElement.getBoundingClientRect()
    
    // Calculate offset from pointer to card's top-left corner (relative to container)
    const cardLeft = cardRect.left - containerRect.left
    const cardTop = cardRect.top - containerRect.top
    const pointerX = e.clientX - containerRect.left
    const pointerY = e.clientY - containerRect.top
    
    setDragOffset({
      x: pointerX - cardLeft,
      y: pointerY - cardTop
    })
    
    setDraggingCardIndex(index)
    cardElement.setPointerCapture(e.pointerId)
  }

  // Handle drag move
  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (draggingCardIndex !== index || !svgContainerRef.current) return
    
    const containerRect = svgContainerRef.current.getBoundingClientRect()
    const pointerX = e.clientX - containerRect.left
    const pointerY = e.clientY - containerRect.top
    
    // Calculate new card position (top-left corner)
    // We store the center position, so adjust by half card dimensions
    const cardElement = cardRefs.current.get(index)
    if (!cardElement) return
    
    const cardWidth = cardElement.offsetWidth
    const cardHeight = cardElement.offsetHeight
    
    // Position is for the card's center (matching the transform: translateX(-50%) behavior)
    const newX = pointerX - dragOffset.x + cardWidth / 2
    const newY = pointerY - dragOffset.y
    
    // Update position in state (for immediate visual feedback)
    setCardPositions(prev => ({
      ...prev,
      [index]: { x: newX, y: newY }
    }))
    
    // Update card center for connecting line
    const newCenterX = newX
    const newCenterY = newY + cardHeight / 2
    setCardCenters(prev => {
      const updated = new Map(prev)
      updated.set(index, { x: newCenterX, y: newCenterY })
      return updated
    })
  }

  // Handle drag end
  const handleDragEnd = async (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (draggingCardIndex !== index) return
    
    const cardElement = cardRefs.current.get(index)
    if (cardElement) {
      cardElement.releasePointerCapture(e.pointerId)
    }
    
    setDraggingCardIndex(null)
    
    // Save updated positions to Firestore (use current state directly)
    // We need to get the latest positions including the one we just moved
    setCardPositions(currentPositions => {
      // Save to Firestore asynchronously
      saveCardPositions(currentPositions)
      return currentPositions
    })
  }

  // Handle refresh button click - regenerates data from source without changing months
  // Preserves existing card positions, only adds new cards if new milestones appear
  const handleRefresh = async () => {
    if (!sourceBlockId) {
      setError('No source block configured')
      return
    }

    setIsRendering(true)
    setError(null)
    
    // Preserve existing card positions - don't clear them
    // New cards will get default positions, existing ones keep their positions
    
    await generateSerpentineData(sourceBlockId, monthsToShow)
    setIsRendering(false)
  }

  // Handle render button click
  const handleRender = async () => {
    const months = parseInt(monthsInput, 10)
    if (isNaN(months) || months < 1 || months > 120) {
      setError('Please enter a valid number of months (1-120)')
      return
    }

    setIsRendering(true)
    setError(null)
    setMonthsToShow(months)
    
    // Clear card positions when re-rendering (user will need to reposition cards)
    setCardPositions({})
    setCardCenters(new Map())
    
    // Save months setting to block
    const blockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId)
    await setDoc(blockRef, { 'months-to-show': months, updatedAt: serverTimestamp() }, { merge: true })
    
    // Clear saved card positions in Firestore
    const serpentineDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'serpentine-data', 'config')
    await setDoc(serpentineDataRef, { cardPositions: {} }, { merge: true })
    
    await generateSerpentineData(sourceBlockId, months)
    setIsRendering(false)
  }

  // Find or generate a unique prefix for this karma-serpentine block
  const findOrGeneratePrefix = async (): Promise<string> => {
    if (!projectId || !selectedChildCanvas) return 'karma-serpentine'

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
        
        // Check if this box belongs to this karma-serpentine block
        if (data.karmaSerpentineBlockId === blockId && !boxId.includes('_overlay_')) {
          // Extract prefix from boxId
          if (boxId.startsWith('karma-serpentine')) {
            const match = boxId.match(/^(karma-serpentine\d*)/)
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
        if (boxId.startsWith('karma-serpentine') && !boxId.includes('_overlay_')) {
          const match = boxId.match(/^(karma-serpentine\d*)/)
          if (match) {
            usedPrefixes.add(match[1])
          }
        }
      })
      
      // Find next available number
      if (!usedPrefixes.has('karma-serpentine')) {
        return 'karma-serpentine'
      }
      
      let num = 2
      while (usedPrefixes.has(`karma-serpentine${num}`)) {
        num++
      }
      
      return `karma-serpentine${num}`
    } catch (error) {
      console.error('Error finding prefix:', error)
      return 'karma-serpentine'
    }
  }

  // Check for existing serpentine report and load its values
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
        
        // Check if this box belongs to this karma-serpentine block
        if (data.karmaSerpentineBlockId === blockId && !boxId.includes('_overlay_')) {
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
            width: Math.max(50, Math.min(100, widthPercent)),
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

  // Handle Create ICF Click
  const handleCreateICFClick = async () => {
    if (!projectId || !sourceBlockId) {
      alert('Please ensure project ID and source block are configured.')
      return
    }

    if (monthsData.length === 0) {
      alert('No data available. Please ensure the serpentine has been generated.')
      return
    }

    setCreatingICF(true)
    setError(null)

    try {
      // Step 1: Generate JSON-LD metadata structure (without hash initially)
      const timestamp = new Date().toISOString()
      const jsonLdMetadataWithoutHash = {
        '@context': 'https://schema.org',
        '@type': 'SerpentineSnapshot',
        '@graph': [
          {
            '@id': '#snapshot',
            '@type': 'SerpentineSnapshot',
            timestamp: timestamp,
            blockId: blockId,
            projectId: projectId,
            projectName: projectName || projectId,
            folderId: folderId,
            folderName: folderName || folderId,
            sourceBlockId: sourceBlockId,
            monthsToShow: monthsToShow,
            charactersInCard: charactersInCard,
            cardFontSize: cardFontSize,
          },
          {
            '@id': '#sourceQuery',
            '@type': 'SourceQuery',
            filters: {
              hasOfficialDate: true,
              hasSummary: true,
              statusFilter: ['completed', 'manually approved'],
            },
          },
        ],
      }

      // Step 2: Load general table data to get links and notes
      let generalTableData: any[] = []
      try {
        const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', sourceBlockId, 'table-data', 'karma-general-table')
        const tableDataSnap = await getDoc(tableDataRef)
        if (tableDataSnap.exists()) {
          const tableData = tableDataSnap.data()
          const unsortedRows = tableData.rows || []
          // Apply same sorting as attestation portal for consistency
          generalTableData = sortAttestationRows(unsortedRows)
        }
      } catch (error) {
        console.error('Error loading general table data:', error)
      }

      // Step 2.5: Load karma query data (most recent document from query-results)
      let karmaQueryResult: any = null
      let karmaQuerySlugs: string[] = []
      let karmaQueryQueriedAt: any = null
      try {
        // First, try to get the karma-query block to get project slugs
        const karmaQueryBlockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', 'karma-query')
        const karmaQueryBlockSnap = await getDoc(karmaQueryBlockRef)
        if (karmaQueryBlockSnap.exists()) {
          const karmaQueryBlockData = karmaQueryBlockSnap.data()
          karmaQuerySlugs = karmaQueryBlockData['karma-project-slugs'] || []
        }

        // Get the most recent document from query-results collection
        const queryResultsRef = collection(db, 'newsroom', projectId, 'folders', folderId, 'blocks', 'karma-query', 'query-results')
        const queryResultsSnap = await getDocs(queryResultsRef)
        
        if (!queryResultsSnap.empty) {
          // Find the most recent document by timestamp (queriedAt or createdAt)
          let mostRecentDoc: any = null
          let mostRecentTime: number = 0
          
          queryResultsSnap.forEach((docSnap) => {
            const data = docSnap.data()
            let docTime = 0
            
            // Try to get timestamp from queriedAt, createdAt, or serverTimestamp
            if (data.queriedAt) {
              if (data.queriedAt.toDate) {
                docTime = data.queriedAt.toDate().getTime()
              } else if (data.queriedAt.seconds) {
                docTime = data.queriedAt.seconds * 1000
              }
            } else if (data.createdAt) {
              if (data.createdAt.toDate) {
                docTime = data.createdAt.toDate().getTime()
              } else if (data.createdAt.seconds) {
                docTime = data.createdAt.seconds * 1000
              }
            }
            
            // If no timestamp found, use document ID as fallback (assuming it might be timestamp-based)
            if (docTime === 0) {
              const docIdNum = parseInt(docSnap.id, 10)
              if (!isNaN(docIdNum)) {
                docTime = docIdNum
              }
            }
            
            if (docTime > mostRecentTime) {
              mostRecentTime = docTime
              mostRecentDoc = { id: docSnap.id, ...data }
            }
          })
          
          if (mostRecentDoc) {
            karmaQueryResult = mostRecentDoc
            karmaQueryQueriedAt = mostRecentDoc.queriedAt
          }
        }
      } catch (error) {
        console.error('Error loading karma query data:', error)
        // Continue without karma query data
      }

      // Helper function to normalize text for comparison
      const normalizeText = (text: string): string => {
        return (text || '').trim().toLowerCase().replace(/\s+/g, ' ')
      }

      // Helper function to format date to "Month-Year" format
      const formatDateToMonthYear = (dateStr: string): string => {
        if (!dateStr) return ''
        try {
          const date = new Date(dateStr)
          if (isNaN(date.getTime())) return dateStr // Return original if invalid
          return formatMonthYear(date)
        } catch {
          return dateStr
        }
      }

      // Helper function to find general table row by title match
      const findGeneralTableRowByTitle = (title: string): any => {
        if (!title || !title.trim()) return null
        
        const normalizedTitle = normalizeText(title)
        
        // Try exact match first
        for (const row of generalTableData) {
          if (row.title && normalizeText(row.title) === normalizedTitle) {
            return row
          }
        }
        
        // Try partial match
        for (const row of generalTableData) {
          if (row.title) {
            const normalizedRowTitle = normalizeText(row.title)
            if (normalizedRowTitle.includes(normalizedTitle) || normalizedTitle.includes(normalizedRowTitle)) {
              if (normalizedRowTitle.length >= normalizedTitle.length * 0.8) {
                return row
              }
            }
          }
        }
        
        return null
      }

      // Helper function to escape HTML
      const escapeHtml = (text: string) => {
        return (text || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;')
      }

      // Helper function to escape URL
      const escapeUrl = (url: string) => {
        return (url || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
      }

      // Helper function to format dates cell (start, end, created, updated)
      const formatDatesCell = (row: any): string => {
        const dates: string[] = []
        if (row.startDate) dates.push(`start = ${escapeHtml(formatDateToMonthYear(row.startDate))}`)
        if (row.endDate) dates.push(`end = ${escapeHtml(formatDateToMonthYear(row.endDate))}`)
        if (row.createdAt) dates.push(`created = ${escapeHtml(formatDateToMonthYear(row.createdAt))}`)
        if (row.updatedAt) dates.push(`updated = ${escapeHtml(formatDateToMonthYear(row.updatedAt))}`)
        return dates.join('<br>')
      }

      // Step 3: Process milestones and add to JSON-LD
      const milestoneEntities: any[] = []
      const milestoneTableRows: string[] = []
      
      for (let i = 0; i < serpentineNodes.length; i++) {
        const node = serpentineNodes[i]
        if (!node || !node.hasData || !node.row) continue

        const milestone = node.row
        const milestoneId = `#milestone-${i}`
        
        // Get corresponding general table row by matching title
        const generalTableRow = findGeneralTableRowByTitle(milestone.title || '')
        
        // Convert all milestone images to base64
        let mainImageBase64: string | null = null
        let image2Base64: string | null = null
        let image3Base64: string | null = null
        
        if (milestone.images?.main) {
          mainImageBase64 = await imageUrlToBase64(milestone.images.main)
        }
        if (milestone.images?.image2) {
          image2Base64 = await imageUrlToBase64(milestone.images.image2)
        }
        if (milestone.images?.image3) {
          image3Base64 = await imageUrlToBase64(milestone.images.image3)
        }

        // Get proofs from general table (array of {title, url} objects, max 3)
        let proofs: Array<{ title: string; url: string }> = []
        if (generalTableRow?.proofs && Array.isArray(generalTableRow.proofs)) {
          proofs = generalTableRow.proofs
            .filter((proof: any) => proof && proof.title && proof.url && proof.title.trim() && proof.url.trim())
            .slice(0, 3) // Max 3 proofs
            .map((proof: any) => ({
              title: proof.title.trim(),
              url: proof.url.trim()
            }))
        }
        
        const notes = generalTableRow?.notes || generalTableRow?.note || ''

        // Create milestone entity (images excluded from JSON-LD - they are stored separately in snapshot storage)
        const milestoneEntity: any = {
          '@id': milestoneId,
          '@type': 'Milestone',
          date: node.month || milestone.officialDate,
          title: milestone.title || '',
          summary: milestone.summary || '',
          slug: milestone.slug || '',
          status: milestone.status || '',
          rowIndex: i,
          monthDataIndex: node.monthDataIndex,
          isExtraNode: node.isExtraNode,
          proofs: proofs,
          notes: notes,
        }

        milestoneEntities.push(milestoneEntity)

        // Generate table row HTML
        const mainImageCell = mainImageBase64
          ? `<td><img src="${mainImageBase64}" class="milestone-image" alt="Main image" /></td>`
          : '<td></td>'
        
        const image2Cell = image2Base64
          ? `<td><img src="${image2Base64}" class="milestone-image" alt="Image 2" /></td>`
          : '<td></td>'
        
        const image3Cell = image3Base64
          ? `<td><img src="${image3Base64}" class="milestone-image" alt="Image 3" /></td>`
          : '<td></td>'
        
        const proofsHtml = proofs.length > 0
          ? `<ul style="margin: 0; padding-left: 20px; list-style-type: disc;">${proofs.map((proof) => {
              const escapedTitle = escapeHtml(proof.title)
              const escapedUrl = escapeUrl(proof.url)
              return `<li><a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedTitle}</a></li>`
            }).join('')}</ul>`
          : '<em>No proofs</em>'
        
        const summaryText = milestone.summary || ''
        
        milestoneTableRows.push(`
      <tr>
        <td>${escapeHtml(node.month || milestone.officialDate || '')}</td>
        <td>${escapeHtml(summaryText)}</td>
        <td>${proofsHtml}</td>
        <td>${escapeHtml(notes || '')}</td>
        ${mainImageCell}
        ${image2Cell}
        ${image3Cell}
      </tr>`)
      }

      // Add milestone entities to JSON-LD graph
      jsonLdMetadataWithoutHash['@graph'].push(...milestoneEntities)

      // Add general table entity to JSON-LD
      jsonLdMetadataWithoutHash['@graph'].push({
        '@id': '#generalTable',
        '@type': 'GeneralTable',
        rows: generalTableData,
      } as any)

      // Add karma query entity to JSON-LD
      if (karmaQueryResult) {
        jsonLdMetadataWithoutHash['@graph'].push({
          '@id': '#karmaQuery',
          '@type': 'KarmaQuery',
          projectSlugs: karmaQuerySlugs,
          queriedAt: karmaQueryQueriedAt,
          success: karmaQueryResult.success,
          error: karmaQueryResult.error || null,
          data: karmaQueryResult.data || null,
        } as any)
      }

      // Generate general table HTML rows
      const generalTableRows: string[] = []
      for (const row of generalTableData) {
        // Count images
        const imageCount = [
          row.images?.main,
          row.images?.image2,
          row.images?.image3,
        ].filter(Boolean).length
        
        const imagesText = imageCount > 0 
          ? `${imageCount} image${imageCount > 1 ? 's' : ''} uploaded. (see them in milestones section)`
          : 'No images'

        // Format proofs as HTML list
        const proofsHtml = row.proofs && Array.isArray(row.proofs) && row.proofs.length > 0
          ? `<ul style="margin: 0; padding-left: 20px; list-style-type: disc;">${row.proofs.map((proof: any) => {
              const escapedTitle = escapeHtml(proof.title || '')
              const escapedUrl = escapeUrl(proof.url || '')
              return `<li><a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedTitle}</a></li>`
            }).join('')}</ul>`
          : '<em>No proofs</em>'

        generalTableRows.push(`
      <tr>
        <td><div class="cell-content">${formatDatesCell(row)}</div></td>
        <td><div class="cell-content">${escapeHtml(formatDateToMonthYear(row.officialDate || ''))}</div></td>
        <td><div class="cell-content">${escapeHtml(row.title || '')}</div></td>
        <td><div class="cell-content">${escapeHtml(row.description || '')}</div></td>
        <td><div class="cell-content">${escapeHtml(row.summary || '')}</div></td>
        <td><div class="cell-content">${escapeHtml(row.status || '')}</div></td>
        <td><div class="cell-content">${escapeHtml(row.proof || '')}</div></td>
        <td><div class="cell-content">${proofsHtml}</div></td>
        <td><div class="cell-content">${escapeHtml(row.notes || '')}</div></td>
        <td><div class="cell-content">${escapeHtml(imagesText)}</div></td>
        <td><div class="cell-content">${escapeHtml(row.slug || '')}</div></td>
      </tr>`)
      }

      // Step 4: Generate serpentine JPG as base64 (with background for ICF)
      let serpentineJpgBase64: string | null = null
      if (svgContainerRef.current) {
        try {
          const container = svgContainerRef.current
          // Save original background styles
          const originalBg = container.style.backgroundColor
          const originalBgImage = container.style.backgroundImage
          
          // Set background for ICF export (keep background visible)
          if (backgroundType === 'solid') {
            container.style.setProperty('background-color', backgroundFromColor, 'important')
            container.style.setProperty('background-image', 'none', 'important')
          } else {
            // Gradient background
            container.style.setProperty('background-color', backgroundFromColor, 'important')
            container.style.setProperty('background-image', `linear-gradient(to bottom right, ${backgroundFromColor}, ${backgroundToColor})`, 'important')
          }

          // Generate JPG with background (smaller file size than PNG)
          const dataUrl = await toJpeg(container, {
            pixelRatio: 1,
            quality: 0.9, // High quality JPG
          })
          serpentineJpgBase64 = dataUrl // toJpeg returns data:image/jpeg;base64,...

          // Restore original background
          if (originalBg) {
            container.style.backgroundColor = originalBg
          } else {
            container.style.backgroundColor = ''
          }
          if (originalBgImage) {
            container.style.backgroundImage = originalBgImage
          } else {
            container.style.backgroundImage = ''
          }
        } catch (error) {
          console.error('Error generating serpentine JPG:', error)
          // Continue without JPG - will show placeholder
        }
      }

      // Step 5: Generate snapshotId (timestamp + random suffix)
      // Note: serpentineJpgBase64 is still generated for HTML display, but not included in JSON-LD
      const snapshotId = generateSnapshotId()

      // Step 6: Compute content hash (canonical JSON string without hash field)
      const canonicalJson = JSON.stringify(jsonLdMetadataWithoutHash, null, 0) // No whitespace for consistency
      const contentHash = await computeSHA256(canonicalJson)

      // Step 7: Generate Karma Query HTML section
      let karmaQueryHtml = ''
      if (karmaQueryResult) {
        // Helper function to get days ago
        const getDaysAgo = (timestamp: any): number | null => {
          if (!timestamp) return null
          let date: Date
          if (timestamp.toDate) {
            date = timestamp.toDate()
          } else if (timestamp.seconds) {
            date = new Date(timestamp.seconds * 1000)
          } else if (typeof timestamp === 'string') {
            date = new Date(timestamp)
          } else {
            return null
          }
          const now = new Date()
          const diffTime = Math.abs(now.getTime() - date.getTime())
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
          return diffDays
        }

        // Helper function to get color class for days ago
        const getDaysAgoColor = (days: number): string => {
          if (days <= 10) return 'color: #16a34a;'
          if (days <= 20) return 'color: #ea580c;'
          return 'color: #dc2626;'
        }

        const daysAgo = karmaQueryQueriedAt ? getDaysAgo(karmaQueryQueriedAt) : null
        const daysAgoText = daysAgo !== null 
          ? `<span style="font-size: 14px; font-weight: 500; ${getDaysAgoColor(daysAgo)}">The Karma API was queried ${daysAgo} ${daysAgo === 1 ? 'day' : 'days'} ago</span>`
          : ''

        const slugsText = karmaQuerySlugs.length > 0 
          ? `<div style="font-size: 14px; color: #111827; margin-bottom: 16px; word-break: break-word;"><span style="font-weight: 500;">Project Slugs:</span> ${escapeHtml(karmaQuerySlugs.join(', ') || 'None')}</div>`
          : `<div style="font-size: 14px; color: #111827; margin-bottom: 16px;"><span style="font-weight: 500;">Project Slugs:</span> None</div>`

        const responseBgColor = karmaQueryResult.success ? '#f0fdf4' : '#fef2f2'
        const responseBorderColor = karmaQueryResult.success ? '#bbf7d0' : '#fecaca'
        const responseStatus = karmaQueryResult.success ? '✓' : '✗'

        let responseContent = ''
        if (karmaQueryResult.error) {
          responseContent += `
            <div style="margin-bottom: 16px;">
              <span style="font-weight: 500; font-size: 14px; color: #111827;">Error:</span>
              <pre style="margin-top: 4px; padding: 8px; background-color: white; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px; color: #111827; overflow-x: hidden; white-space: pre-wrap; word-wrap: break-word; font-family: monospace;">${escapeHtml(karmaQueryResult.error)}</pre>
            </div>`
        }

        if (karmaQueryResult.data && typeof karmaQueryResult.data === 'object') {
          responseContent += '<div style="margin-top: 16px;">'
          Object.entries(karmaQueryResult.data).forEach(([slug, slugData]: [string, any]) => {
            // Skip if slugData is an array (failed queries are stored as empty arrays)
            if (Array.isArray(slugData)) {
              responseContent += `
                <div style="border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 16px; last-child: border-bottom: 0; last-child: padding-bottom: 0;">
                  <div style="font-weight: 600; font-size: 14px; color: #111827; margin-bottom: 8px;">
                    Project: <span style="font-family: monospace;">${escapeHtml(slug)}</span>
                    <span style="margin-left: 8px; font-size: 12px; font-weight: normal; color: #dc2626;">(Failed query)</span>
                  </div>
                </div>`
            } else {
              // slugData is an object with grantMilestones, projectMilestones, projectUpdates, grantUpdates
              const projectUpdates = slugData.projectUpdates || []
              const grantUpdates = slugData.grantUpdates || []
              const projectMilestones = slugData.projectMilestones || []
              const grantMilestones = slugData.grantMilestones || []
              
              const totalUpdates = projectUpdates.length + grantUpdates.length
              const totalMilestones = projectMilestones.length + grantMilestones.length
              const totalItems = totalUpdates + totalMilestones

              const countsText = totalItems > 0
                ? `<span style="margin-left: 8px; font-size: 12px; font-weight: normal; color: #4b5563;">(${totalUpdates} ${totalUpdates === 1 ? 'update' : 'updates'}, ${totalMilestones} ${totalMilestones === 1 ? 'milestone' : 'milestones'})</span>`
                : ''

              responseContent += `
                <div style="border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 16px;">
                  <div style="font-weight: 600; font-size: 14px; color: #111827; margin-bottom: 8px;">
                    Project: <span style="font-family: monospace;">${escapeHtml(slug)}</span>${countsText}
                  </div>
                  <pre style="margin-top: 4px; padding: 8px; background-color: white; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px; color: #111827; overflow-x: hidden; white-space: pre-wrap; word-wrap: break-word; max-height: 240px; overflow-y: auto; font-family: monospace;">${escapeHtml(JSON.stringify(slugData, null, 2))}</pre>
                </div>`
            }
          })
          responseContent += '</div>'
        }

        karmaQueryHtml = `
  <details>
    <summary style="cursor: pointer; font-size: 18px; font-weight: 600; color: #475569; margin: 40px 0 20px 0; padding: 10px; background-color: #f1f5f9; border-radius: 4px;">
      <h2 style="display: inline; margin: 0;">Karma Query (Click to expand)</h2>
    </summary>
    <div style="padding: 16px; border: 1px solid ${responseBorderColor}; border-radius: 6px; background-color: ${responseBgColor};">
      ${daysAgoText ? `<div style="margin-bottom: 16px;">${daysAgoText}</div>` : ''}
      ${slugsText}
      <div style="font-weight: 600; margin-bottom: 8px; color: #111827;">
        Response: ${responseStatus}
      </div>
      ${responseContent}
    </div>
  </details>`
      } else {
        karmaQueryHtml = `
  <details>
    <summary style="cursor: pointer; font-size: 18px; font-weight: 600; color: #475569; margin: 40px 0 20px 0; padding: 10px; background-color: #f1f5f9; border-radius: 4px;">
      <h2 style="display: inline; margin: 0;">Karma Query (Click to expand)</h2>
    </summary>
    <div style="padding: 16px; text-align: center; color: #64748b;">
      <em>No query results yet.</em>
    </div>
  </details>`
      }

      // Step 7.5: Create final JSON-LD with snapshotId and hash
      const jsonLdMetadata = {
        ...jsonLdMetadataWithoutHash,
        '@graph': [
          {
            ...jsonLdMetadataWithoutHash['@graph'][0],
            snapshotId: snapshotId,
            contentHash: contentHash,
          },
          ...jsonLdMetadataWithoutHash['@graph'].slice(1),
        ],
      }

      // Step 8: Create HTML skeleton
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karma Serpentine ICF: ${snapshotId}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.5;
      color: #1e293b;
      font-size: 13px;
    }
    h1 {
      color: #1e293b;
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 10px;
    }
    h2 {
      color: #475569;
      margin-top: 40px;
    }
    #serpentine-preview {
      margin: 40px 0;
      text-align: center;
    }
    #serpentine-preview img {
      max-width: 100%;
      height: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }
    .table-container {
      overflow-x: auto;
      margin: 40px 0;
      width: 100%;
    }
    table {
      width: 100%;
      min-width: 1200px;
      border-collapse: collapse;
    }
    #milestones {
      table-layout: fixed;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border: 1px solid #000000;
    }
    th {
      background-color: #f1f5f9;
      font-weight: 600;
      color: #475569;
      border: 1px solid #000000;
    }
    /* Summary column - twice the width */
    th:nth-child(2),
    td:nth-child(2) {
      width: 400px;
      min-width: 400px;
    }
    /* Other text columns */
    th:nth-child(1),
    td:nth-child(1) {
      width: 150px;
      min-width: 150px;
    }
    th:nth-child(3),
    td:nth-child(3) {
      width: 200px;
      min-width: 200px;
    }
    th:nth-child(4),
    td:nth-child(4) {
      width: 200px;
      min-width: 200px;
    }
    /* Milestone table specific styles */
    #milestones tbody tr {
      max-height: 250px;
      height: 250px;
      display: table-row;
    }
    #milestones tbody td {
      vertical-align: top;
      max-height: 250px;
      overflow-y: auto;
    }
    /* Text columns - max height 250px with scroll */
    #milestones tbody td:nth-child(1),
    #milestones tbody td:nth-child(2),
    #milestones tbody td:nth-child(3),
    #milestones tbody td:nth-child(4) {
      max-height: 250px;
      overflow-y: auto;
    }
    /* Image columns - fixed width 250px, height 250px */
    #milestones th:nth-child(5),
    #milestones th:nth-child(6),
    #milestones th:nth-child(7),
    #milestones tbody td:nth-child(5),
    #milestones tbody td:nth-child(6),
    #milestones tbody td:nth-child(7) {
      width: 250px;
      min-width: 250px;
      padding: 0;
      position: relative;
      height: 250px;
      max-height: 250px;
      overflow: hidden;
      background-color: #f8fafc;
      text-align: center;
    }
    .milestone-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 4px;
      display: block;
      margin: 0 auto;
    }
    /* General table specific styles */
    #general-table {
      min-width: 1800px;
      table-layout: fixed;
    }
    #general-table tbody tr {
      max-height: 50px;
      height: 50px;
      display: table-row;
    }
    #general-table tbody td {
      max-height: 50px;
      height: 50px;
      padding: 4px;
      box-sizing: border-box;
      vertical-align: top;
      position: relative;
    }
    #general-table tbody td .cell-content {
      max-height: 42px;
      height: 42px;
      overflow-y: auto;
      overflow-x: hidden;
      word-wrap: break-word;
      font-size: 12px;
      line-height: 1.4;
    }
    /* Custom scrollbar for cell content */
    #general-table tbody td .cell-content::-webkit-scrollbar {
      width: 6px;
    }
    #general-table tbody td .cell-content::-webkit-scrollbar-track {
      background: #f1f5f9;
    }
    #general-table tbody td .cell-content::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 3px;
    }
    #general-table tbody td .cell-content::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }
    /* General table column widths */
    #general-table th:nth-child(1),
    #general-table td:nth-child(1) { width: 120px; min-width: 120px; } /* Dates */
    #general-table th:nth-child(2),
    #general-table td:nth-child(2) { width: 120px; min-width: 120px; } /* Single Date */
    #general-table th:nth-child(3),
    #general-table td:nth-child(3) { width: 200px; min-width: 200px; } /* Title */
    #general-table th:nth-child(4),
    #general-table td:nth-child(4) { width: 125px; min-width: 125px; } /* Description */
    #general-table th:nth-child(5),
    #general-table td:nth-child(5) { width: 300px; min-width: 300px; } /* Summary */
    #general-table th:nth-child(6),
    #general-table td:nth-child(6) { width: 150px; min-width: 150px; } /* Status */
    #general-table th:nth-child(7),
    #general-table td:nth-child(7) { width: 150px; min-width: 150px; } /* Proof */
    #general-table th:nth-child(8),
    #general-table td:nth-child(8) { width: 200px; min-width: 200px; } /* Add Proof */
    #general-table th:nth-child(9),
    #general-table td:nth-child(9) { width: 200px; min-width: 200px; } /* Notes */
    #general-table th:nth-child(10),
    #general-table td:nth-child(10) { width: 180px; min-width: 180px; } /* Images */
    #general-table th:nth-child(11),
    #general-table td:nth-child(11) { width: 150px; min-width: 150px; } /* Slug */
    details {
      margin-top: 40px;
      padding: 20px;
      background-color: #f8fafc;
      border-radius: 8px;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      color: #3b82f6;
    }
    #json-viewer {
      background-color: #1e293b;
      color: #e2e8f0;
      padding: 20px;
      border-radius: 4px;
      overflow-x: auto;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .metadata {
      background-color: #f1f5f9;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .metadata-item {
      margin: 5px 0;
    }
    .hash {
      font-family: monospace;
      color: #3b82f6;
    }
  </style>
  <script type="application/ld+json">
${JSON.stringify(jsonLdMetadata, null, 2)}
  </script>
</head>
<body>
  <h1>Karma Serpentine Timeline</h1>
  
  <div class="metadata">
    <div class="metadata-item"><strong>Snapshot ID:</strong> <span class="hash">${snapshotId}</span></div>
    <div class="metadata-item"><strong>Content Hash:</strong> <span class="hash">${contentHash}</span></div>
    <div class="metadata-item"><strong>Generated:</strong> ${new Date(timestamp).toLocaleString()}</div>
    <div class="metadata-item"><strong>Project:</strong> ${projectName || projectId}${projectName && projectName !== projectId ? ` (${projectId})` : ''}</div>
    <div class="metadata-item"><strong>Folder:</strong> ${folderName || folderId}${folderName && folderName !== folderId ? ` (${folderId})` : ''}</div>
  </div>

  <h2>Milestones</h2>
  <div class="table-container">
    <table id="milestones">
      <thead>
        <tr>
          <th>Date</th>
          <th>Summary</th>
          <th>Add Proof</th>
          <th>Notes</th>
          <th>Main Image</th>
          <th>Image 2</th>
          <th>Image 3</th>
        </tr>
      </thead>
      <tbody>
${milestoneTableRows.length > 0 ? milestoneTableRows.join('') : `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: #64748b;">
            <em>No milestones found</em>
          </td>
        </tr>`}
      </tbody>
    </table>
  </div>

  <div id="serpentine-preview">
    <h2>Serpentine Visualization</h2>
${serpentineJpgBase64 ? `
    <img src="${serpentineJpgBase64}" alt="Karma Serpentine Timeline" style="max-width: 100%; height: auto;" />` : `
    <p><em>Serpentine JPG could not be generated</em></p>`}
  </div>

  <details>
    <summary style="cursor: pointer; font-size: 18px; font-weight: 600; color: #475569; margin: 40px 0 20px 0; padding: 10px; background-color: #f1f5f9; border-radius: 4px;">
      <h2 style="display: inline; margin: 0;">General Table (Click to expand)</h2>
    </summary>
    <div class="table-container">
      <table id="general-table">
      <thead>
        <tr>
          <th>Dates</th>
          <th>Single Date</th>
          <th>Title</th>
          <th>Description</th>
          <th>Summary</th>
          <th>Status</th>
          <th>Proof</th>
          <th>Add Proof</th>
          <th>Notes</th>
          <th>Images</th>
          <th>Slug</th>
        </tr>
      </thead>
      <tbody>
${generalTableRows.length > 0 ? generalTableRows.join('') : `
        <tr>
          <td colspan="11" style="text-align: center; padding: 40px; color: #64748b;">
            <em>No general table data found</em>
          </td>
        </tr>`}
      </tbody>
    </table>
    </div>
  </details>
${karmaQueryHtml}
  <details>
    <summary>View JSON-LD Data (Technical Details)</summary>
    <pre id="json-viewer"></pre>
  </details>

  <script>
    // Extract and display JSON-LD
    const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
    if (jsonLdScript) {
      try {
        const jsonData = JSON.parse(jsonLdScript.textContent);
        document.getElementById('json-viewer').textContent = JSON.stringify(jsonData, null, 2);
      } catch (e) {
        document.getElementById('json-viewer').textContent = 'Error parsing JSON-LD: ' + e.message;
      }
    }
  </script>
</body>
</html>`

      // Step 8: Upload HTML to Firebase Storage
      const storagePath = `newsroom/assets/${projectId}/${folderId}/icf/${snapshotId}.html`
      const storageRef = ref(storage, storagePath)
      const blob = new Blob([htmlContent], { type: 'text/html' })
      
      await uploadBytes(storageRef, blob, {
        contentType: 'text/html',
        cacheControl: 'public, max-age=31536000',
      })

      // Step 9: Get public Storage URL
      const publicUrl = await getDownloadURL(storageRef)

      // Step 10: Store URL and snapshotId in state
      setIcfUrl(publicUrl)
      setIcfSnapshotId(snapshotId)

      // Step 11: Create snapshot archive (Firestore + Storage)
      try {
        const archiveResult = await createSnapshotArchive(
          projectId,
          folderId,
          snapshotId,
          contentHash,
          publicUrl,
          undefined, // createdBy - can add user ID later
          (status) => {
            console.log('Archive progress:', status)
            // Could update UI here with progress
          }
        )

        if (!archiveResult.success) {
          console.warn('Archive creation had issues:', archiveResult)
          alert(`✅ ICF created successfully!\n\n⚠️ Archive creation ${archiveResult.firestoreSuccess && archiveResult.storageSuccess ? 'completed' : 'partially completed'}.\n\nSnapshot ID: ${snapshotId}\n\nClick "View ICF" to open the file.`)
        } else {
          alert(`✅ ICF and archive created successfully!\n\nSnapshot ID: ${snapshotId}\n\nClick "View ICF" to open the file in a new window.`)
        }
      } catch (archiveError) {
        console.error('Error creating archive:', archiveError)
        // Don't fail the whole operation if archive creation fails
        alert(`✅ ICF created successfully!\n\n⚠️ Archive creation failed (can retry later).\n\nSnapshot ID: ${snapshotId}\n\nClick "View ICF" to open the file.`)
      }
    } catch (error) {
      console.error('Error creating ICF:', error)
      setError(`Failed to create ICF: ${error instanceof Error ? error.message : 'Unknown error'}`)
      alert(`❌ Error creating ICF: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setCreatingICF(false)
    }
  }

  // Handle Download ICF Click (opens in new window)
  const handleDownloadICFClick = () => {
    if (!icfUrl) {
      alert('No ICF available. Please create an ICF first.')
      return
    }

    // Open ICF URL in new window
    window.open(icfUrl, '_blank')
  }

  // Handle Save PNG Click
  const handleSavePngClick = async () => {
    if (!projectId || !selectedChildCanvas || !svgContainerRef.current) {
      alert('Please ensure project ID, child canvas, and serpentine preview are set')
      return
    }

    if (!sourceBlockId) {
      alert('No source block configured. Please edit the block to select a source.')
      return
    }

    const filename = blockId

    setSavingPng(true)
    try {
      const baseFilename = filename.endsWith('.png') 
        ? filename.replace('.png', '') 
        : filename

      // Temporarily remove background for transparent export
      const container = svgContainerRef.current
      const originalBg = container.style.backgroundColor
      const originalBgImage = container.style.backgroundImage
      container.style.setProperty('background-color', 'transparent', 'important')
      container.style.setProperty('background-image', 'none', 'important')

      try {
        // Generate PNGs at 1x, 2x, and 3x resolutions
        const scales = [1, 2, 3]
        const uploadPromises = scales.map(async (scale) => {
          const dataUrl = await toPng(container, {
            pixelRatio: scale,
          })

          // Convert data URL to blob
          const response = await fetch(dataUrl)
          const blob = await response.blob()

          const pngFilename = scale === 1 
            ? `${baseFilename}.png`
            : `${baseFilename}@${scale}x.png`
          
          const storagePath = `interoperable-canvas/assets/${projectId}/child-canvases/${selectedChildCanvas}/karma-serpentine/${pngFilename}`
          const storageRefPath = ref(storage, storagePath)
          
          await uploadBytes(storageRefPath, blob, {
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
          container.style.backgroundColor = originalBg
        } else {
          container.style.backgroundColor = ''
        }
        if (originalBgImage) {
          container.style.backgroundImage = originalBgImage
        } else {
          container.style.backgroundImage = ''
        }
      }
    } catch (error) {
      console.error('Error saving PNG:', error)
      alert(`❌ Error saving PNG: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setSavingPng(false)
    }
  }

  // Handle opening Send to Canvas modal
  const handleSendToCanvasClick = async () => {
    if (!projectId || !selectedChildCanvas || !svgContainerRef.current) {
      alert('Please ensure project ID, child canvas, and serpentine preview are set')
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
    if (!projectId || !selectedChildCanvas || !svgContainerRef.current) {
      alert('Please ensure project ID, child canvas, and serpentine preview are set')
      return
    }

    if (!sourceBlockId) {
      alert('No source block configured. Please edit the block to select a source.')
      return
    }

    const pngFilenameToUse = blockId

    // Verify the PNG file exists
    try {
      const png1xPath = `interoperable-canvas/assets/${projectId}/child-canvases/${selectedChildCanvas}/karma-serpentine/${pngFilenameToUse}.png`
      const png1xRef = ref(storage, png1xPath)
      await getDownloadURL(png1xRef)
    } catch (error) {
      alert(`PNG file "${pngFilenameToUse}.png" not found. Please save a PNG first using "Save as PNG" button.`)
      return
    }

    setAddingToCanvas(true)
    try {
      const png1xPath = `interoperable-canvas/assets/${projectId}/child-canvases/${selectedChildCanvas}/karma-serpentine/${pngFilenameToUse}.png`
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

      // Find or generate the prefix for this karma-serpentine block
      const prefix = await findOrGeneratePrefix()
      
      const firestorePath = `interoperable-canvas/${projectId}/child-canvases/${selectedChildCanvas}/canvases/root`
      const overlayCollectionPath = `${firestorePath}/overlay`
      const overlayCollectionRef = collection(db, overlayCollectionPath)
      const allBoxesSnapshot = await getDocs(overlayCollectionRef)
      
      // Find all boxes with this specific prefix (for this karma-serpentine block)
      const boxesToDelete: string[] = []
      allBoxesSnapshot.forEach((docSnap) => {
        const boxId = docSnap.id
        const data = docSnap.data() as any
        
        // Check if box belongs to this karma-serpentine block and uses the prefix
        if (data.karmaSerpentineBlockId === blockId && boxId.startsWith(prefix)) {
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

      const baseStoragePath = `interoperable-canvas/assets/${projectId}/child-canvases/${selectedChildCanvas}/karma-serpentine`
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
      const mainBoxId = `${prefix}_${timestampSuffix}`
      const boxName = 'Karma Serpentine Timeline'
      const boxNameKey = `${boxName}_${timestampSuffix}`

      // Calculate overlay positions for circles and cards
      const container = svgContainerRef.current
      const containerRect = container.getBoundingClientRect()
      const containerWidthPx = containerRect.width
      const containerHeightPx = containerRect.height

      // Build overlay boxes for each milestone (circle + card)
      // Use actual rendered element positions for pixel-perfect accuracy
      const overlayBoxes: Array<{
        type: 'circle' | 'card'
        nodeIndex: number
        summaryText: string
        x: number
        y: number
        w: number
        h: number
      }> = []

      // Wait for all elements to be fully rendered and measured
      // Use requestAnimationFrame to ensure layout is complete
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 50) // Extra small delay for SVG rendering
          })
        })
      })

      // For each node with data, measure actual rendered elements
      for (let i = 0; i < serpentineNodes.length; i++) {
        const node = serpentineNodes[i]
        if (!node || !node.hasData || !node.row) continue

        // Get summary text (same as what's displayed in the card)
        const summaryText = getFirstNCharacters(node.row.summary, charactersInCard)

        // Measure actual rendered circle element using getBoundingClientRect
        // This gives us pixel-perfect positioning based on what's actually rendered
        const circleElement = circleRefs.current.get(i)
        if (circleElement) {
          const circleRect = circleElement.getBoundingClientRect()
          
          // Calculate circle position relative to container
          // getBoundingClientRect returns viewport coordinates, so subtract container's viewport position
          const circleRelX = circleRect.left - containerRect.left
          const circleRelY = circleRect.top - containerRect.top
          
          // Convert to percentage of container (using actual measured container dimensions)
          const circleXPercent = (circleRelX / containerWidthPx) * 100
          const circleYPercent = (circleRelY / containerHeightPx) * 100
          const circleWPercent = (circleRect.width / containerWidthPx) * 100
          const circleHPercent = (circleRect.height / containerHeightPx) * 100

          // Calculate absolute position on canvas
          // Scale percentages to the actual box dimensions on canvas
          const overlayCircleX = Math.round((circleXPercent / 100) * boxWidth) + boxX
          const overlayCircleY = Math.round((circleYPercent / 100) * boxHeight) + yPosition
          const overlayCircleW = Math.round((circleWPercent / 100) * boxWidth)
          const overlayCircleH = Math.round((circleHPercent / 100) * boxHeight)

          overlayBoxes.push({
            type: 'circle',
            nodeIndex: i,
            summaryText: summaryText,
            x: overlayCircleX,
            y: overlayCircleY,
            w: overlayCircleW,
            h: overlayCircleH,
          })
        }

        // Measure actual rendered card element
        const cardElement = cardRefs.current.get(i)
        if (cardElement) {
          const cardRect = cardElement.getBoundingClientRect()
          
          // Calculate card position relative to container
          const cardRelX = cardRect.left - containerRect.left
          const cardRelY = cardRect.top - containerRect.top
          
          // Convert to percentage
          const cardXPercent = (cardRelX / containerWidthPx) * 100
          const cardYPercent = (cardRelY / containerHeightPx) * 100
          const cardWPercent = (cardRect.width / containerWidthPx) * 100
          const cardHPercent = (cardRect.height / containerHeightPx) * 100

          // Calculate absolute position on canvas
          const overlayCardX = Math.round((cardXPercent / 100) * boxWidth) + boxX
          const overlayCardY = Math.round((cardYPercent / 100) * boxHeight) + yPosition
          const overlayCardW = Math.round((cardWPercent / 100) * boxWidth)
          const overlayCardH = Math.round((cardHPercent / 100) * boxHeight)

          overlayBoxes.push({
            type: 'card',
            nodeIndex: i,
            summaryText: summaryText,
            x: overlayCardX,
            y: overlayCardY,
            w: overlayCardW,
            h: overlayCardH,
          })
        }
      }

      // Create main PNG box
      const mainBoxRef = doc(db, overlayCollectionPath, mainBoxId)
      await setDoc(mainBoxRef, {
        id: mainBoxId,
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
        karmaSerpentineBlockId: blockId, // Store blockId to identify which serpentine block created this
        newsroomProjectId: projectId,
        newsroomFolderId: folderId,
        sourceBlockId: sourceBlockId,
      }, { merge: true })

      // Create overlay boxes for each circle and card
      const overlayBoxPromises = overlayBoxes.map(async (overlay, index) => {
        const overlayBoxId = `${prefix}_${timestampSuffix}_overlay_${overlay.type}_${overlay.nodeIndex}`
        const overlayBoxRef = doc(db, overlayCollectionPath, overlayBoxId)
        
        await setDoc(overlayBoxRef, {
          id: overlayBoxId,
          x: overlay.x,
          y: overlay.y,
          w: overlay.w,
          h: overlay.h,
          contentType: 'milestone', // Special content type for milestone overlays
          clickable: true,
          openIn: 'modal', // Open MilestoneViewer modal instead of URL
          overlayType: overlay.type, // 'circle' or 'card'
          nodeIndex: overlay.nodeIndex,
          summaryText: overlay.summaryText, // Used to identify which milestone to fetch (reverse lookup)
          charactersInCard: charactersInCard, // Store character count used for truncation
          name: `Milestone ${overlay.type === 'circle' ? 'Circle' : 'Card'} ${overlay.nodeIndex}`,
          background: {
            mode: 'none'
          },
          karmaSerpentineBlockId: blockId,
          newsroomProjectId: projectId,
          newsroomFolderId: folderId,
          sourceBlockId: sourceBlockId,
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
        id !== 'background' && id !== mainBoxId && !overlayBoxIds.includes(id)
      )
      const newLayers = ['background', ...layersWithoutNewBoxes, mainBoxId, ...overlayBoxIds]
      const newZIndexMap: Record<string, number> = {}
      newLayers.forEach((id: string, idx: number) => {
        newZIndexMap[id] = idx
      })

      await setDoc(canvasRef, {
        layers: newLayers,
        zIndexMap: newZIndexMap,
      }, { merge: true })

      setShowSendToCanvasModal(false)
      alert(`✅ Karma Serpentine added to canvas successfully! ${overlayBoxes.length} clickable milestone overlays created.`)
    } catch (error) {
      console.error('Error adding to canvas:', error)
      alert(`❌ Error adding to canvas: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setAddingToCanvas(false)
    }
  }

  // Generate path and points based on original months (not nodes)
  // Extra nodes will be positioned along the path segments between months
  const { path, points: monthPoints } = generateSerpentinePath(containerWidth, SVG_HEIGHT, monthsData.length, TOP_PADDING, BOTTOM_PADDING, SIDE_PADDING)
  
  // Calculate positions for all nodes (including extra nodes between months)
  const calculateNodePositions = (): { x: number; y: number }[] => {
    const nodePositions: { x: number; y: number }[] = []
    
    for (let i = 0; i < serpentineNodes.length; i++) {
      const node = serpentineNodes[i]
      
      if (node.isExtraNode) {
        // Extra node: position it halfway between current month and next month
        const monthIndex = node.monthDataIndex
        const nextMonthIndex = monthIndex + 1
        
        if (monthIndex < monthPoints.length && nextMonthIndex < monthPoints.length) {
          const currentPoint = monthPoints[monthIndex]
          const nextPoint = monthPoints[nextMonthIndex]
          
          // Interpolate halfway between the two points
          const x = (currentPoint.x + nextPoint.x) / 2
          const y = (currentPoint.y + nextPoint.y) / 2
          
          nodePositions.push({ x, y })
        } else if (monthIndex < monthPoints.length) {
          // Last month: position extra node slightly offset from the month position
          // (since there's no next month to interpolate with)
          const currentPoint = monthPoints[monthIndex]
          // Offset slightly to the right and down to indicate it's "later" in the timeline
          nodePositions.push({ 
            x: currentPoint.x + 20, 
            y: currentPoint.y + 10 
          })
        } else {
          // Fallback: use current month position
          nodePositions.push(monthPoints[monthIndex] || { x: 0, y: 0 })
        }
      } else {
        // Regular node: use the month's position
        nodePositions.push(monthPoints[node.monthDataIndex] || { x: 0, y: 0 })
      }
    }
    
    return nodePositions
  }
  
  const nodePositions = calculateNodePositions()

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading serpentine timeline...
      </div>
    )
  }

  if (error && monthsData.length === 0) {
    return (
      <div className="p-4 text-center text-red-500">
        {error}
      </div>
    )
  }

  return (
    <div 
      ref={containerRef}
      className="w-full"
      style={{ 
        height: '1300px',
        overflowY: 'hidden',
        overflowX: 'hidden'
      }}
    >
      {/* Parameters Button and Canvas Export */}
      <div className="p-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowParametersModal(true)}
            className="px-4 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            ⚙️ Parameters
          </button>
          <span className="text-xs text-gray-500">
            {monthsToShow} months | {monthsData.filter(m => m.hasData).length} with data
          </span>
        </div>
        
        {/* Canvas Export Controls */}
        <div className="flex items-center gap-2">
          {projectExists === false && (
            <div className="text-sm text-red-600 mr-2">
              Project does not exist in interoperable-canvas. Please create it manually.
            </div>
          )}
          {projectExists === true && (
            <select
              value={selectedChildCanvas}
              onChange={(e) => setSelectedChildCanvas(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-900 bg-white"
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
            onClick={handleCreateICFClick}
            disabled={creatingICF || !projectId || !sourceBlockId || monthsData.length === 0}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              creatingICF || !projectId || !sourceBlockId || monthsData.length === 0
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            title={!sourceBlockId ? 'No source block configured' : monthsData.length === 0 ? 'No data available' : 'Create Immutable Canonical File'}
          >
            {creatingICF ? 'Creating...' : 'Create ICF'}
          </button>
          {icfUrl && (
            <button
              onClick={handleDownloadICFClick}
              className="px-3 py-1.5 rounded text-sm font-medium bg-gray-600 text-white hover:bg-gray-700"
              title="Open ICF HTML file in new window"
            >
              View ICF
            </button>
          )}
          <button
            onClick={handleSavePngClick}
            disabled={savingPng || !projectId || !selectedChildCanvas || !svgContainerRef.current || projectExists === false}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              savingPng || !projectId || !selectedChildCanvas || !svgContainerRef.current || projectExists === false
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {savingPng ? 'Saving...' : 'Save as PNG'}
          </button>
          <button
            onClick={handleSendToCanvasClick}
            disabled={addingToCanvas || !projectId || !selectedChildCanvas || loadingExistingReport || projectExists === false}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              addingToCanvas || !projectId || !selectedChildCanvas || loadingExistingReport || projectExists === false
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-purple-600 text-white hover:bg-purple-700'
            }`}
          >
            {loadingExistingReport ? 'Loading...' : addingToCanvas ? 'Adding...' : 'Send to Canvas'}
          </button>
        </div>
      </div>

      {/* Parameters Modal */}
      {showParametersModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Serpentine Parameters</h2>
                <button
                  onClick={() => setShowParametersModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Refresh Button */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <button
                  onClick={handleRefresh}
                  disabled={isRendering || !sourceBlockId}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isRendering ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh & Look for New Images
                    </>
                  )}
                </button>
                <p className="mt-2 text-xs text-gray-500 text-center">
                  Reload data from source table to find new images. Existing card positions are preserved.
                </p>
              </div>

              {/* Months Section */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-3">Months to Display</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    value={monthsInput}
                    onChange={(e) => setMonthsInput(e.target.value)}
                    min="1"
                    max="120"
                    className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900"
                  />
                  <button
                    onClick={() => {
                      handleRender()
                      setShowParametersModal(false)
                    }}
                    disabled={isRendering}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isRendering ? 'Rendering...' : 'Render'}
                  </button>
                </div>
              </div>

              {/* Characters in Card Section */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-3">Characters in Card</label>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-4">
                    <input
                      type="number"
                      value={charactersInCard}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        if (!isNaN(val) && val >= 1 && val <= 500) {
                          handleCharactersInCardChange(val)
                        }
                      }}
                      min="1"
                      max="500"
                      className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900"
                    />
                    <span className="text-xs text-gray-500">characters</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-xs text-gray-600">Font Size:</label>
                    <input
                      type="number"
                      value={cardFontSize}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        if (!isNaN(val) && val >= 6 && val <= 24) {
                          handleCardFontSizeChange(val)
                        }
                      }}
                      min="6"
                      max="24"
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900"
                    />
                    <span className="text-xs text-gray-500">px</span>
                  </div>
                </div>
              </div>

              {/* Background Section */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Dummy Background (not rendered in canvas)
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Note: Background will not be included when exporting to PNG
                </p>
                <div className="flex items-center gap-4 mb-3">
                  <label className="flex items-center gap-2 text-sm text-gray-900">
                    <input
                      type="radio"
                      name="backgroundType"
                      checked={backgroundType === 'solid'}
                      onChange={() => handleBackgroundTypeChange('solid')}
                      className="cursor-pointer"
                    />
                    Solid
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-900">
                    <input
                      type="radio"
                      name="backgroundType"
                      checked={backgroundType === 'gradient'}
                      onChange={() => handleBackgroundTypeChange('gradient')}
                      className="cursor-pointer"
                    />
                    Gradient
                  </label>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600">{backgroundType === 'gradient' ? 'From:' : 'Color:'}</label>
                    <input
                      type="color"
                      value={backgroundFromColor}
                      onChange={(e) => handleBackgroundFromColorChange(e.target.value)}
                      className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600">{backgroundFromColor}</span>
                  </div>
                  {backgroundType === 'gradient' && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-600">To:</label>
                      <input
                        type="color"
                        value={backgroundToColor}
                        onChange={(e) => handleBackgroundToColorChange(e.target.value)}
                        className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                      />
                      <span className="text-xs text-gray-600">{backgroundToColor}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Serpentine Styling Section */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-3">Serpentine Path</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 w-28">Color:</label>
                    <input
                      type="color"
                      value={serpentineColor}
                      onChange={(e) => handleSerpentineColorChange(e.target.value)}
                      className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600">{serpentineColor}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 w-28">Stroke:</label>
                    <input
                      type="number"
                      value={serpentineStroke}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        if (!isNaN(val) && val > 0) handleSerpentineStrokeChange(val)
                      }}
                      min="1"
                      max="20"
                      className="w-20 px-2 py-2 border border-gray-300 rounded text-sm text-gray-900"
                    />
                    <span className="text-xs text-gray-500">px</span>
                  </div>
                </div>
              </div>

              {/* Inactive Months Section */}
              <div className="mb-6 pb-6 border-b border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-3">Inactive Months</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 w-28">Size:</label>
                    <input
                      type="number"
                      value={inactiveMonthSize}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        if (!isNaN(val) && val > 0) handleInactiveMonthSizeChange(val)
                      }}
                      min="1"
                      max="50"
                      className="w-20 px-2 py-2 border border-gray-300 rounded text-sm text-gray-900"
                    />
                    <span className="text-xs text-gray-500">px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 w-28">Color:</label>
                    <input
                      type="color"
                      value={inactiveMonthColor}
                      onChange={(e) => handleInactiveMonthColorChange(e.target.value)}
                      className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600">{inactiveMonthColor}</span>
                  </div>
                </div>
              </div>

              {/* Milestone Months Section */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">Milestone Months</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 w-28">Size:</label>
                    <input
                      type="number"
                      value={milestoneMonthSize}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        if (!isNaN(val) && val > 0) handleMilestoneMonthSizeChange(val)
                      }}
                      min="1"
                      max="100"
                      className="w-20 px-2 py-2 border border-gray-300 rounded text-sm text-gray-900"
                    />
                    <span className="text-xs text-gray-500">px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 w-28">Color:</label>
                    <input
                      type="color"
                      value={milestoneMonthColor}
                      onChange={(e) => handleMilestoneMonthColorChange(e.target.value)}
                      className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-600">{milestoneMonthColor}</span>
                  </div>
                </div>
                {/* Show Image Toggle */}
                <div className="mt-4 flex items-center gap-3">
                  <label className="text-xs text-gray-600">Show Image:</label>
                  <button
                    onClick={() => handleShowMilestoneImageChange(!showMilestoneImage)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      showMilestoneImage ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        showMilestoneImage ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className="text-xs text-gray-500">
                    {showMilestoneImage ? 'On (show uploaded images in circles)' : 'Off (solid color only)'}
                  </span>
                </div>
              </div>

              {/* Close Button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setShowParametersModal(false)}
                  className="px-6 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alert for 3+ rows in same month */}
      {showMultiRowAlert && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
                  <span className="text-xl">⚠️</span>
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Multiple Rows Detected</h2>
              </div>
              <p className="text-gray-600 mb-4">
                The following month(s) have 3 or more rows. Only the first 2 rows per month will be displayed:
              </p>
              <ul className="list-disc list-inside mb-6 text-gray-700">
                {multiRowAlertMonths.map((month, idx) => (
                  <li key={idx} className="font-medium">{month}</li>
                ))}
              </ul>
              <div className="flex justify-end">
                <button
                  onClick={() => setShowMultiRowAlert(false)}
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                >
                  Understood
                </button>
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

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Serpentine SVG Container */}
      <div 
        ref={svgContainerRef}
        className="relative"
        style={{ 
          height: `${SVG_HEIGHT}px`,
          width: '100%',
          backgroundColor: backgroundType === 'solid' ? backgroundFromColor : undefined,
          backgroundImage: backgroundType === 'gradient' 
            ? `linear-gradient(to bottom right, ${backgroundFromColor}, ${backgroundToColor})`
            : undefined,
        }}
      >
        {/* SVG Path */}
        <svg
          width="100%"
          height={SVG_HEIGHT}
          viewBox={`0 0 ${containerWidth} ${SVG_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute top-0 left-0"
        >
          {/* Main serpentine path */}
          <path
            d={path}
            fill="none"
            stroke={serpentineColor}
            strokeWidth={serpentineStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Connecting lines from circles to summary cards */}
          {nodePositions.map((point, index) => {
            const node = serpentineNodes[index]
            if (!node || !node.hasData) return null
            
            const cardCenter = cardCenters.get(index)
            if (!cardCenter) return null // Wait for card to be measured
            
            // Circle center is at point.x, point.y
            // Card center is measured from actual card dimensions
            return (
              <line
                key={`connector-${index}`}
                x1={point.x}
                y1={point.y}
                x2={cardCenter.x}
                y2={cardCenter.y}
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
              />
            )
          })}
          
          {/* ClipPath definitions for milestone images */}
          <defs>
            {nodePositions.map((point, index) => {
              const node = serpentineNodes[index]
              if (!node || !node.hasData) return null
              
              return (
                <clipPath key={`clip-${index}`} id={`milestone-clip-${index}`}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={milestoneMonthSize}
                  />
                </clipPath>
              )
            })}
          </defs>
          
          {/* Serpentine nodes (circles) */}
          {nodePositions.map((point, index) => {
            const node = serpentineNodes[index]
            if (!node) return null
            
            // Check if this milestone has a main image and showMilestoneImage is enabled
            const hasMainImage = showMilestoneImage && node.hasData && node.row?.images?.main
            const imageUrl = hasMainImage ? node.row?.images?.main : null
            
            return (
              <g key={index}>
                {/* Background circle (fill) - shown when no image */}
                <circle
                  ref={(el) => {
                    if (el && node.hasData) {
                      circleRefs.current.set(index, el)
                    } else {
                      circleRefs.current.delete(index)
                    }
                  }}
                  data-overlay-circle-index={node.hasData ? index : undefined}
                  data-overlay-summary={node.hasData && node.row ? getFirstNCharacters(node.row.summary, charactersInCard) : undefined}
                  cx={point.x}
                  cy={point.y}
                  r={node.hasData ? milestoneMonthSize : inactiveMonthSize}
                  fill={node.hasData ? milestoneMonthColor : inactiveMonthColor}
                />
                
                {/* Image inside circle - only if has main image and toggle is on */}
                {imageUrl && (
                  <image
                    href={imageUrl}
                    x={point.x - milestoneMonthSize}
                    y={point.y - milestoneMonthSize}
                    width={milestoneMonthSize * 2}
                    height={milestoneMonthSize * 2}
                    clipPath={`url(#milestone-clip-${index})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                )}
                
                {/* Border stroke - drawn on top, outside the image area */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={node.hasData ? milestoneMonthSize : inactiveMonthSize}
                  fill="none"
                  stroke={node.hasData ? darkenColor(milestoneMonthColor) : darkenColor(inactiveMonthColor)}
                  strokeWidth="4"
                />
                
                {/* Month label - only show for non-extra nodes */}
                {node.month && (
                  <text
                    x={point.x}
                    y={point.y + (node.hasData ? 68 : 44)}
                    textAnchor="middle"
                    className="text-xs font-medium"
                    fill="#475569"
                  >
                    {node.month}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* Floating cards for nodes with data - each node gets its own card */}
        {nodePositions.map((point, index) => {
          const node = serpentineNodes[index]
          if (!node || !node.hasData || !node.row) return null
          
          // Get summary preview for this specific row (using character count)
          const summaryPreview = getFirstNCharacters(node.row.summary, charactersInCard)
          
          // Get card position (saved or default)
          const cardPos = getCardPosition(index, point)
          
          return (
            <div
              key={`card-${index}`}
              ref={(el) => {
                if (el) {
                  cardRefs.current.set(index, el)
                } else {
                  cardRefs.current.delete(index)
                }
              }}
              data-overlay-card-index={index}
              data-overlay-summary={summaryPreview}
              onPointerDown={(e) => handleDragStart(e, index)}
              onPointerMove={(e) => handleDragMove(e, index)}
              onPointerUp={(e) => handleDragEnd(e, index)}
              className="absolute bg-white border border-blue-200 rounded-lg shadow-sm px-3 py-2 max-w-[160px] select-none touch-none"
              style={{
                left: cardPos.x,
                top: cardPos.y,
                transform: 'translateX(-50%)',
                zIndex: draggingCardIndex === index ? 100 : 10,
                cursor: draggingCardIndex === index ? 'grabbing' : 'grab',
                boxShadow: draggingCardIndex === index ? '0 8px 20px rgba(0,0,0,0.2)' : undefined
              }}
            >
              <p className="text-gray-700 leading-snug" style={{ fontSize: `${cardFontSize}px` }}>
                {summaryPreview}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

