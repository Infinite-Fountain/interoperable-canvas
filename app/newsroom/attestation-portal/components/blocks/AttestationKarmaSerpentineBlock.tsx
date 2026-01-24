'use client'

/**
 * NOTE: This component has been adapted from the source to use wallet-based authentication
 * instead of Privy. Authorization uses wallet address instead of Privy user ID.
 */

import React, { useState, useEffect, useRef } from 'react'
import { ethers } from 'ethers'
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { initializeApp, getApps } from 'firebase/app'
import { MilestoneViewer, type MilestoneData, type MilestoneButton } from '../../../components/milestone-viewer'
import { AttestationFormModal } from '../AttestationFormModal'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
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

// Darken a hex color by a percentage (0-1)
const darkenColor = (hex: string, amount: number = 0.4): string => {
  if (!hex) return '#000000'
  
  hex = hex.replace('#', '')
  
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('')
  }
  
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  
  const darkenedR = Math.max(0, Math.floor(r * (1 - amount)))
  const darkenedG = Math.max(0, Math.floor(g * (1 - amount)))
  const darkenedB = Math.max(0, Math.floor(b * (1 - amount)))
  
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
  
  const monthsPerRow = 6
  const numRows = Math.ceil(rows / monthsPerRow)
  const baseRowHeight = effectiveHeight / (numRows - 1 || 1)
  const rowHeight = baseRowHeight * 0.6
  
  const points: { x: number; y: number }[] = []
  let pathData = ''
  
  for (let i = 0; i < rows; i++) {
    const rowIndex = Math.floor(i / monthsPerRow)
    const posInRow = i % monthsPerRow
    const isLeftToRight = rowIndex % 2 === 0
    
    const xProgress = posInRow / (monthsPerRow - 1 || 1)
    const x = isLeftToRight 
      ? sidePadding + xProgress * effectiveWidth
      : sidePadding + effectiveWidth - xProgress * effectiveWidth
    
    const y = topPadding + rowIndex * rowHeight
    
    points.push({ x, y })
  }
  
  if (points.length > 0) {
    pathData = `M ${points[0].x} ${points[0].y}`
    
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      
      const prevRow = Math.floor((i - 1) / monthsPerRow)
      const currRow = Math.floor(i / monthsPerRow)
      
      if (prevRow !== currRow) {
        const midY = (prev.y + curr.y) / 2
        pathData += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`
      } else {
        const dx = (curr.x - prev.x) / 3
        pathData += ` C ${prev.x + dx} ${prev.y}, ${curr.x - dx} ${curr.y}, ${curr.x} ${curr.y}`
      }
    }
  }
  
  return { path: pathData, points }
}

type Props = {
  blockId: string
  projectId: string
  folderId: string
  snapshotId: string
}

export function AttestationKarmaSerpentineBlock({
  blockId,
  projectId,
  folderId,
  snapshotId,
}: Props) {
  const [account, setAccount] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [monthsData, setMonthsData] = useState<MonthData[]>([])
  const [serpentineNodes, setSerpentineNodes] = useState<SerpentineNode[]>([])
  const [cardPositions, setCardPositions] = useState<Record<number, { x: number; y: number }>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number>(1100)
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const circleRefs = useRef<Map<number, SVGCircleElement>>(new Map())
  const [cardCenters, setCardCenters] = useState<Map<number, { x: number; y: number }>>(new Map())

  // MilestoneViewer state
  const [milestoneViewerOpen, setMilestoneViewerOpen] = useState(false)
  const [milestoneViewerData, setMilestoneViewerData] = useState<MilestoneData | null>(null)
  const [buttonConfig, setButtonConfig] = useState<MilestoneButton[]>([])
  const [loadingButtonConfig, setLoadingButtonConfig] = useState(false)
  const [loadingMilestone, setLoadingMilestone] = useState(false)
  
  // Authorization state for attestation buttons
  const [canAttest, setCanAttest] = useState<boolean>(false)
  
  // Attestation form modal state
  const [attestationFormOpen, setAttestationFormOpen] = useState(false)
  const [attestationType, setAttestationType] = useState<'outcomes' | 'reporting'>('outcomes')

  // Parameters loaded from snapshot
  const [monthsToShow, setMonthsToShow] = useState<number>(30)
  const [backgroundType, setBackgroundType] = useState<'solid' | 'gradient'>('gradient')
  const [backgroundFromColor, setBackgroundFromColor] = useState<string>('#dbe96d')
  const [backgroundToColor, setBackgroundToColor] = useState<string>('#4de538')
  const [serpentineColor, setSerpentineColor] = useState<string>('#94a3b8')
  const [serpentineStroke, setSerpentineStroke] = useState<number>(8)
  const [inactiveMonthSize, setInactiveMonthSize] = useState<number>(16)
  const [inactiveMonthColor, setInactiveMonthColor] = useState<string>('#e2e8f0')
  const [milestoneMonthSize, setMilestoneMonthSize] = useState<number>(40)
  const [milestoneMonthColor, setMilestoneMonthColor] = useState<string>('#3b82f6')
  const [showMilestoneImage, setShowMilestoneImage] = useState<boolean>(true)
  const [charactersInCard, setCharactersInCard] = useState<number>(90)
  const [cardFontSize, setCardFontSize] = useState<number>(10)

  // SVG dimensions
  const SVG_HEIGHT = 1300
  const TOP_PADDING = 100
  const BOTTOM_PADDING = 60
  const SIDE_PADDING = 60

  // Load block configuration and data from snapshot
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load block from snapshot
        const blockPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks/${blockId}`
        const blockRef = doc(db, blockPath)
        const blockSnap = await getDoc(blockRef)

        if (!blockSnap.exists()) {
          setError('Block not found in snapshot')
          setLoading(false)
          return
        }

        const blockData = blockSnap.data()

        // Load parameters from block data
        if (blockData['months-to-show']) {
          setMonthsToShow(blockData['months-to-show'])
        }

        if (blockData['background-settings']) {
          const bgSettings = blockData['background-settings']
          if (bgSettings.type) setBackgroundType(bgSettings.type)
          if (bgSettings.fromColor) setBackgroundFromColor(bgSettings.fromColor)
          if (bgSettings.toColor) setBackgroundToColor(bgSettings.toColor)
        }

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

        if (typeof blockData['characters-in-card'] === 'number') {
          setCharactersInCard(blockData['characters-in-card'])
        }
        if (typeof blockData['card-font-size'] === 'number') {
          setCardFontSize(blockData['card-font-size'])
        }

        // Load serpentine data from snapshot
        // Path: newsroom/{projectId}/folders/{folderId}/snapshots/{snapshotId}/blocks/{blockId}/serpentine-data/config
        const serpentineDataRef = doc(
          db,
          'newsroom',
          projectId,
          'folders',
          folderId,
          'snapshots',
          snapshotId,
          'blocks',
          blockId,
          'serpentine-data',
          'config'
        )
        const serpentineDataSnap = await getDoc(serpentineDataRef)

        if (serpentineDataSnap.exists()) {
          const savedData = serpentineDataSnap.data()
          if (savedData.monthsData && Array.isArray(savedData.monthsData)) {
            setMonthsData(savedData.monthsData)

            // Load saved card positions
            if (savedData.cardPositions && typeof savedData.cardPositions === 'object') {
              const positions: Record<number, { x: number; y: number }> = {}
              Object.entries(savedData.cardPositions).forEach(([key, value]) => {
                const numKey = parseInt(key, 10)
                if (!isNaN(numKey) && value && typeof value === 'object') {
                  positions[numKey] = value as { x: number; y: number }
                }
              })
              setCardPositions(positions)
            }
            setError(null) // Clear any previous errors
          } else {
            console.warn('Serpentine data exists but monthsData is missing or invalid:', savedData)
            setError('Serpentine data structure is invalid')
          }
        } else {
          console.error('Serpentine data not found at path:', {
            projectId,
            folderId,
            snapshotId,
            blockId,
            fullPath: `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks/${blockId}/serpentine-data/config`
          })
          setError('Serpentine data not found in snapshot. The snapshot may not have been fully archived.')
        }
      } catch (err) {
        console.error('Error loading data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [blockId, projectId, folderId, snapshotId])

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

  // Generate serpentine nodes from monthsData
  useEffect(() => {
    if (monthsData.length === 0) return

    const nodes: SerpentineNode[] = []

    for (let i = 0; i < monthsData.length; i++) {
      const monthData = monthsData[i]

      if (monthData.rows.length === 0) {
        nodes.push({
          monthDataIndex: i,
          rowIndex: 0,
          isExtraNode: false,
          row: null,
          month: monthData.month,
          hasData: false
        })
      } else if (monthData.rows.length === 1) {
        nodes.push({
          monthDataIndex: i,
          rowIndex: 0,
          isExtraNode: false,
          row: monthData.rows[0],
          month: monthData.month,
          hasData: true
        })
      } else {
        nodes.push({
          monthDataIndex: i,
          rowIndex: 0,
          isExtraNode: false,
          row: monthData.rows[0],
          month: monthData.month,
          hasData: true
        })
        const maxRows = Math.min(monthData.rows.length, 2)
        for (let r = 1; r < maxRows; r++) {
          nodes.push({
            monthDataIndex: i,
            rowIndex: r,
            isExtraNode: true,
            row: monthData.rows[r],
            month: '',
            hasData: true
          })
        }
      }
    }

    setSerpentineNodes(nodes)
  }, [monthsData])

  // Calculate card centers after cards are rendered
  useEffect(() => {
    if (serpentineNodes.length === 0) return

    const measureCards = () => {
      const container = svgContainerRef.current
      if (!container) return
      
      const newCenters = new Map<number, { x: number; y: number }>()
      
      cardRefs.current.forEach((cardElement, index) => {
        if (cardElement) {
          const cardRect = cardElement.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          
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
  }, [serpentineNodes.length, containerWidth, Object.keys(cardPositions).length])

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

  // Check if user can attest (has wisdomCouncil or attester role)
  useEffect(() => {
    if (!projectId || !account) {
      setCanAttest(false)
      return
    }

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
          setCanAttest(roles.includes('owner') || 
                       roles.includes('wisdomCouncil') || 
                       roles.includes('attester'))
        } else {
          setCanAttest(false)
        }
      } catch (error) {
        console.error('[AttestationKarmaSerpentineBlock] Authorization check failed:', error)
        setCanAttest(false)
      }
    }

    checkAuthorization()
  }, [projectId, account])

  // Load button configuration from Firestore
  useEffect(() => {
    if (!projectId || !folderId) {
      setButtonConfig([])
      return
    }

    const loadButtonConfig = async () => {
      setLoadingButtonConfig(true)
      try {
        const configPath = `newsroom/${projectId}/folders/${folderId}/attestation-config/milestone-buttons`
        const configRef = doc(db, configPath)
        const configSnap = await getDoc(configRef)

        if (configSnap.exists()) {
          const data = configSnap.data()
          if (data.buttons && Array.isArray(data.buttons)) {
            setButtonConfig(data.buttons as MilestoneButton[])
          } else {
            // No config found, set empty array (will show no buttons per Option A)
            setButtonConfig([])
          }
        } else {
          // No config document exists, set empty array (will show no buttons per Option A)
          setButtonConfig([])
        }
      } catch (error) {
        console.error('Error loading button config:', error)
        // On error, default to empty (no buttons shown)
        setButtonConfig([])
      } finally {
        setLoadingButtonConfig(false)
      }
    }

    loadButtonConfig()
  }, [projectId, folderId])

  // Handle attestation button click
  const handleAttestClick = (type: 'outcomes' | 'reporting' | 'tbd') => {
    if (type === 'outcomes' || type === 'reporting') {
      // Open attestation form modal for outcomes or reporting
      setAttestationFormOpen(true)
      setAttestationType(type)
    } else {
      // TBD is not implemented yet
      console.log(`${type} attestation not yet implemented`)
    }
  }

  // Get card position (saved or default)
  const getCardPosition = (index: number, point: { x: number; y: number }): { x: number; y: number } => {
    if (cardPositions[index]) {
      return cardPositions[index]
    }
    
    const node = serpentineNodes[index]
    if (!node) {
      return { x: point.x, y: point.y - 130 }
    }
    
    const serpentineRowIndex = Math.floor(index / 6)
    const isAbove = serpentineRowIndex % 2 === 0
    const baseY = isAbove ? point.y - 130 : point.y + 100
    
    let xOffset = 0
    if (node.isExtraNode) {
      xOffset = 90
    } else if (node.hasData) {
      const nextNode = serpentineNodes[index + 1]
      if (nextNode && nextNode.isExtraNode && nextNode.monthDataIndex === node.monthDataIndex) {
        xOffset = -90
      }
    }
    
    return {
      x: point.x + xOffset,
      y: baseY
    }
  }

  // Convert image URL from original path to archive path
  const convertImageUrlToArchive = (imageUrl: string | undefined): string | undefined => {
    if (!imageUrl) return undefined
    
    // Handle different URL formats:
    // 1. Full Firebase Storage URL: https://firebasestorage.googleapis.com/.../newsroom/assets/...
    // 2. Relative path: newsroom/assets/...
    // 3. Already in archive path
    
    const originalPattern = `newsroom/assets/${projectId}/${folderId}/karma-general-table/`
    const archivePattern = `newsroom/assets/${projectId}/${folderId}/archive/${snapshotId}/karma-general-table/`
    
    // Check if URL contains the original path pattern
    if (imageUrl.includes(originalPattern)) {
      // Replace with archive path
      return imageUrl.replace(originalPattern, archivePattern)
    }
    
    // If already in archive path or different format, return as-is
    return imageUrl
  }

  // Load milestone data from snapshot and open MilestoneViewer
  const handleMilestoneClick = async (node: SerpentineNode) => {
    if (!node.hasData || !node.row) return

    // Store node.row in a const so TypeScript knows it's not null
    const row = node.row

    setLoadingMilestone(true)
    setMilestoneViewerOpen(true)

    try {
      // Load full row data from snapshot Firestore
      // Need to find the source block ID first to get the correct table data path
      const blockPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks/${blockId}`
      const blockRef = doc(db, blockPath)
      const blockSnap = await getDoc(blockRef)

      if (!blockSnap.exists()) {
        console.error('Block not found in snapshot')
        setLoadingMilestone(false)
        return
      }

      const blockData = blockSnap.data()
      const sourceBlockId = blockData['source-block-id'] || blockId // Fallback to blockId if no source

      // Load general table data from snapshot
      // The general table block ID might be different from the serpentine block ID
      // Try to find the karma-general-table block in the snapshot
      let generalTableBlockId = sourceBlockId
      
      // Try to find karma-general-table block if sourceBlockId is different
      if (sourceBlockId !== blockId) {
        // Check if there's a karma-general-table block in the snapshot
        const blocksPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks`
        const blocksRef = collection(db, blocksPath)
        const blocksSnap = await getDocs(blocksRef)
        
        blocksSnap.forEach((docSnap) => {
          const blockData = docSnap.data()
          if (blockData['block-type'] === 'karma-report' && blockData['karma-subtype'] === 'karma-general-table') {
            generalTableBlockId = docSnap.id
          }
        })
      }

      const tableDataPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks/${generalTableBlockId}/table-data/karma-general-table`
      const tableDataRef = doc(db, tableDataPath)
      const tableDataSnap = await getDoc(tableDataRef)

      if (!tableDataSnap.exists()) {
        console.error('Table data not found in snapshot at path:', tableDataPath)
        setLoadingMilestone(false)
        return
      }

      const tableData = tableDataSnap.data()
      const rows = tableData.rows || []

      // Find the matching row by matching summary text (like canvas does)
      // Use the summary preview from the card to find the full row
      const summaryPreview = getFirstNCharacters(row.summary, charactersInCard)
      
      let matchingRow: any = null
      
      // Try to find row by matching the truncated summary (most reliable)
      matchingRow = rows.find((rowItem: any) => {
        if (!rowItem.summary) return false
        const rowSummaryPreview = getFirstNCharacters(rowItem.summary, charactersInCard)
        return rowSummaryPreview === summaryPreview
      })

      // If no match, try matching by officialDate and full summary
      if (!matchingRow && row.officialDate && row.summary) {
        matchingRow = rows.find((rowItem: any) => {
          return rowItem.officialDate === row.officialDate && rowItem.summary === row.summary
        })
      }

      // If still no match, try just by officialDate
      if (!matchingRow && row.officialDate) {
        matchingRow = rows.find((rowItem: any) => {
          return rowItem.officialDate === row.officialDate
        })
      }

      if (!matchingRow) {
        console.warn('Matching row not found in general table. Summary preview:', summaryPreview)
        console.warn('Available rows count:', rows.length)
        setLoadingMilestone(false)
        return
      }

      // Build MilestoneData from the matching row with converted image URLs
      // Ensure proofs is an array and filter out invalid entries
      const validProofs = Array.isArray(matchingRow.proofs) 
        ? matchingRow.proofs.filter((p: any) => p && p.title && p.url && p.title.trim() !== '' && p.url.trim() !== '')
        : []

      const milestoneData: MilestoneData = {
        officialDate: matchingRow.officialDate || '',
        summary: matchingRow.summary || '',
        notes: matchingRow.notes || '',
        proofs: validProofs.length > 0 ? validProofs : undefined,
        images: matchingRow.images ? {
          main: convertImageUrlToArchive(matchingRow.images.main),
          image2: convertImageUrlToArchive(matchingRow.images.image2),
          image3: convertImageUrlToArchive(matchingRow.images.image3),
        } : undefined,
      }

      setMilestoneViewerData(milestoneData)
    } catch (error) {
      console.error('Error loading milestone data:', error)
    } finally {
      setLoadingMilestone(false)
    }
  }

  const handleCardClick = (node: SerpentineNode) => {
    handleMilestoneClick(node)
  }

  const handleCircleClick = (node: SerpentineNode) => {
    handleMilestoneClick(node)
  }

  // Generate path and points only when we have data and valid container width
  let path = ''
  let monthPoints: { x: number; y: number }[] = []
  
  if (monthsData.length > 0 && containerWidth > 0 && !isNaN(containerWidth) && containerWidth > 100) {
    try {
      const pathData = generateSerpentinePath(containerWidth, SVG_HEIGHT, monthsData.length, TOP_PADDING, BOTTOM_PADDING, SIDE_PADDING)
      path = pathData.path || ''
      monthPoints = pathData.points || []
    } catch (error) {
      console.error('Error generating serpentine path:', error)
      path = ''
      monthPoints = []
    }
  }
  
  // Validate path is a valid SVG path string
  const isValidPath = path && typeof path === 'string' && path.trim().length > 0 && path.trim().startsWith('M')
  
  // Calculate positions for all nodes (including extra nodes between months)
  const calculateNodePositions = (): { x: number; y: number }[] => {
    const nodePositions: { x: number; y: number }[] = []
    
    for (let i = 0; i < serpentineNodes.length; i++) {
      const node = serpentineNodes[i]
      
      if (node.isExtraNode) {
        const monthIndex = node.monthDataIndex
        const nextMonthIndex = monthIndex + 1
        
        if (monthIndex < monthPoints.length && nextMonthIndex < monthPoints.length) {
          const currentPoint = monthPoints[monthIndex]
          const nextPoint = monthPoints[nextMonthIndex]
          
          const x = (currentPoint.x + nextPoint.x) / 2
          const y = (currentPoint.y + nextPoint.y) / 2
          nodePositions.push({ x, y })
        } else if (monthIndex < monthPoints.length) {
          const currentPoint = monthPoints[monthIndex]
          nodePositions.push({ 
            x: currentPoint.x + 20, 
            y: currentPoint.y + 10 
          })
        } else {
          nodePositions.push(monthPoints[monthIndex] || { x: 0, y: 0 })
        }
      } else {
        nodePositions.push(monthPoints[node.monthDataIndex] || { x: 0, y: 0 })
      }
    }
    
    return nodePositions
  }
  
  const nodePositions = calculateNodePositions()

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center py-8 text-gray-500">Loading serpentine...</div>
      </div>
    )
  }

  if (error && monthsData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center py-8 text-red-600">{error}</div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="bg-white border border-gray-300 rounded"
      style={{
        width: '100%',
        maxWidth: '1100px',
        height: '1300px',
        overflowY: 'hidden',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h2 className="text-gray-500 text-lg font-medium px-4 pt-4 pb-2 border-b border-gray-200">
        Karma Serpentine Timeline
      </h2>

      {/* Serpentine SVG Container */}
      <div 
        ref={svgContainerRef}
        className="relative flex-1"
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
          {/* Main serpentine path - only render if path is valid */}
          {isValidPath && (
            <path
              d={path}
              fill="none"
              stroke={serpentineColor}
              strokeWidth={serpentineStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          
          {/* Connecting lines from circles to summary cards */}
          {nodePositions.map((point, index) => {
            const node = serpentineNodes[index]
            if (!node || !node.hasData) return null
            
            const cardCenter = cardCenters.get(index)
            if (!cardCenter) return null
            
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
            
            const hasMainImage = showMilestoneImage && node.hasData && node.row?.images?.main
            const imageUrl = hasMainImage ? convertImageUrlToArchive(node.row?.images?.main) : null
            
            return (
              <g 
                key={index}
                style={{ cursor: node.hasData ? 'pointer' : 'default' }}
                onClick={() => node.hasData && handleCircleClick(node)}
                onPointerDown={(e) => {
                  if (node.hasData) {
                    e.stopPropagation()
                    handleCircleClick(node)
                  }
                }}
              >
                {/* Background circle - clickable area */}
                <circle
                  ref={(el) => {
                    if (el && node.hasData) {
                      circleRefs.current.set(index, el)
                    } else {
                      circleRefs.current.delete(index)
                    }
                  }}
                  cx={point.x}
                  cy={point.y}
                  r={node.hasData ? milestoneMonthSize : inactiveMonthSize}
                  fill={node.hasData ? milestoneMonthColor : inactiveMonthColor}
                  style={{ 
                    cursor: node.hasData ? 'pointer' : 'default',
                    pointerEvents: 'all'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (node.hasData) {
                      handleCircleClick(node)
                    }
                  }}
                />
                
                {/* Image inside circle */}
                {imageUrl && (
                  <image
                    href={imageUrl}
                    x={point.x - milestoneMonthSize}
                    y={point.y - milestoneMonthSize}
                    width={milestoneMonthSize * 2}
                    height={milestoneMonthSize * 2}
                    clipPath={`url(#milestone-clip-${index})`}
                    preserveAspectRatio="xMidYMid slice"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                
                {/* Border stroke - also clickable */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={node.hasData ? milestoneMonthSize : inactiveMonthSize}
                  fill="none"
                  stroke={node.hasData ? darkenColor(milestoneMonthColor) : darkenColor(inactiveMonthColor)}
                  strokeWidth="4"
                  style={{ 
                    cursor: node.hasData ? 'pointer' : 'default',
                    pointerEvents: 'all'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (node.hasData) {
                      handleCircleClick(node)
                    }
                  }}
                />
                
                {/* Month label - not clickable */}
                {node.month && (
                  <text
                    x={point.x}
                    y={point.y + (node.hasData ? 68 : 44)}
                    textAnchor="middle"
                    className="text-xs font-medium"
                    fill="#475569"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.month}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* Floating cards for nodes with data */}
        {nodePositions.map((point, index) => {
          const node = serpentineNodes[index]
          if (!node || !node.hasData || !node.row) return null
          
          const summaryPreview = getFirstNCharacters(node.row.summary, charactersInCard)
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
              onClick={() => handleCardClick(node)}
              className="absolute bg-white border border-blue-200 rounded-lg shadow-sm px-3 py-2 max-w-[160px] cursor-pointer hover:shadow-md transition-shadow"
              style={{
                left: cardPos.x,
                top: cardPos.y,
                transform: 'translateX(-50%)',
                zIndex: 10,
              }}
            >
              <p className="text-gray-700 leading-snug" style={{ fontSize: `${cardFontSize}px` }}>
                {summaryPreview}
              </p>
            </div>
          )
        })}
      </div>

      {/* MilestoneViewer Modal */}
      {loadingMilestone ? (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60]">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4"></div>
            <p>Loading milestone...</p>
          </div>
        </div>
      ) : (
        <MilestoneViewer
          isOpen={milestoneViewerOpen}
          onClose={() => {
            setMilestoneViewerOpen(false)
            setMilestoneViewerData(null)
          }}
          milestone={milestoneViewerData}
          showAttestationButtons={canAttest}
          onAttestClick={handleAttestClick}
          buttonConfig={buttonConfig}
        />
      )}

      {/* Attestation Form Modal */}
      <AttestationFormModal
        open={attestationFormOpen}
        onClose={() => setAttestationFormOpen(false)}
        milestone={milestoneViewerData}
        projectId={projectId}
        folderId={folderId}
        snapshotId={snapshotId}
        blockId={blockId}
        attestationType={attestationType}
      />
    </div>
  )
}
