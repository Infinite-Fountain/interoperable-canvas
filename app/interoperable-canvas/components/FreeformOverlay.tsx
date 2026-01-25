'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Lottie from 'lottie-react'
import { Rnd } from 'react-rnd'
import { useCanvasStore } from './store'
import { initializeApp, getApps } from 'firebase/app'
import { getFirestore, collection, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { getStorage, ref as storageRef, getBytes } from 'firebase/storage'
import { SnapshotVoteBox } from './SnapshotVoteBox'

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
const storage = getStorage(app)

export function FreeformOverlay({ projectId = 'demo', canvasId = 'root', scope = { type: 'root' } as { type: 'root' } | { type: 'child'; childId: string }, presentation = false, isAuthorized = false }: { projectId?: string; canvasId?: string; scope?: { type: 'root' } | { type: 'child'; childId: string }; presentation?: boolean; isAuthorized?: boolean }) {
  const overlay = useCanvasStore((s) => s.overlay)
  const setOverlay = useCanvasStore((s) => s.setOverlay)
  const updateOverlay = useCanvasStore((s) => s.updateOverlay)
  const layers = useCanvasStore((s) => s.layers)
  const setLayers = useCanvasStore((s) => s.setLayers)
  const createBox = useCanvasStore((s) => s.createBox)
  const currentTool = useCanvasStore((s) => s.ui.currentTool)
  const setTool = useCanvasStore((s) => s.setTool)
  const openBoxModal = useCanvasStore((s) => s.openBoxModal)
  const openGardensReportModal = useCanvasStore((s) => s.openGardensReportModal)
  const openGardensReportOverlayModal = useCanvasStore((s) => s.openGardensReportOverlayModal)
  const openMilestoneViewerModal = useCanvasStore((s) => s.openMilestoneViewerModal)
  const openMilestoneViewerWithAttestationsModal = useCanvasStore((s) => s.openMilestoneViewerWithAttestationsModal)

  // Helper function to check if a box is a gardens-report box
  const isGardensReportBox = (boxId: string, item: any): boolean => {
    // Check by ID prefix
    if (boxId.startsWith('gardens-report_') || boxId.startsWith('gardens-report-')) {
      return true
    }
    // Also check by image source path (for existing boxes that might not have the prefix)
    if (item?.contentType === 'image' && item?.imageSrc && typeof item.imageSrc === 'string') {
      return item.imageSrc.includes('/gardens-reports/')
    }
    // Fallback: check by name
    if (item?.name && typeof item.name === 'string' && item.name.toLowerCase().includes('gardens report')) {
      return true
    }
    return false
  }

  // Helper function to check if a box is a gardens-report overlay box
  const isGardensReportOverlayBox = (boxId: string, item: any): boolean => {
    // Overlay boxes have _overlay_ in their ID and belong to a gardens-report
    if (!boxId.includes('_overlay_')) {
      return false
    }
    // Extract the parent box ID (everything before _overlay_)
    const parentBoxId = boxId.split('_overlay_')[0]
    // Check if parent ID starts with gardens-report prefix
    return parentBoxId.startsWith('gardens-report_') || parentBoxId.startsWith('gardens-report-')
  }

  // Helper function to check if a box is a karma-serpentine main box
  const isKarmaSerpentineBox = (boxId: string, item: any): boolean => {
    if (!boxId || typeof boxId !== 'string') {
      return false
    }
    // Check by ID prefix
    if (boxId.startsWith('karma-serpentine')) {
      return !boxId.includes('_overlay_')
    }
    // Check by image source path
    if (item?.contentType === 'image' && item?.imageSrc && typeof item.imageSrc === 'string') {
      return item.imageSrc.includes('/karma-serpentine/')
    }
    // Check by karmaSerpentineBlockId field
    if (item?.karmaSerpentineBlockId) {
      return true
    }
    return false
  }

  // Helper function to check if a box is a karma-serpentine milestone overlay box
  const isKarmaSerpentineMilestoneOverlay = (boxId: string, item: any): boolean => {
    if (!boxId || typeof boxId !== 'string') {
      return false
    }
    // Milestone overlays have contentType 'milestone' and belong to karma-serpentine
    if (item?.contentType === 'milestone') {
      return true
    }
    // Also check by overlay ID pattern
    if (boxId.includes('_overlay_') && boxId.startsWith('karma-serpentine')) {
      return true
    }
    return false
  }

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const selectedId = useCanvasStore((s) => s.selectedId)
  const setSelectedId = useCanvasStore((s) => s.setSelectedId)

  const idToZ = useMemo(() => {
    const map: Record<string, number> = {}
    layers.forEach((l) => { map[l.id] = l.z })
    return map
  }, [layers])

  const onPointerDown = (e: React.PointerEvent) => {
    if (presentation || !isAuthorized || currentTool !== 'add-box') return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDragStart({ x, y })
    setDraftRect({ x, y, w: 0, h: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (presentation || !isAuthorized || currentTool !== 'add-box' || !dragStart) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const x = Math.min(dragStart.x, cx)
    const y = Math.min(dragStart.y, cy)
    const w = Math.abs(cx - dragStart.x)
    const h = Math.abs(cy - dragStart.y)
    setDraftRect({ x, y, w, h })
  }

  const onPointerUp = () => {
    if (presentation || !isAuthorized || currentTool !== 'add-box' || !dragStart || !draftRect) return
    const minSize = 40
    const w = Math.max(minSize, draftRect.w)
    const h = Math.max(minSize, draftRect.h)
    const id = createBox({ x: draftRect.x, y: draftRect.y, w, h })
    const itemRef = doc(db, pathForCanvasDoc().concat(['overlay', id]).join('/'))
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
    const defaultIndex = (Array.isArray(overlay) ? overlay.length : 0) + 1
    const defaultName = `Box ${defaultIndex}`
    const defaultKey = `${defaultName}_${toTimestampSuffix()}`
    setDoc(itemRef, { id, x: Math.round(draftRect.x), y: Math.round(draftRect.y), w, h, contentType: 'none', name: defaultName, nameKey: defaultKey }, { merge: true })
    setSelectedId(id)
    setDragStart(null)
    setDraftRect(null)
    setTool('none')
  }

  const pathForCanvasDoc = () => {
    const base: string[] = ['interoperable-canvas', projectId!]
    if ((scope as any)?.type === 'child') base.push('child-canvases', (scope as any).childId)
    base.push('canvases', canvasId!)
    return base
  }

  // Firestore live sync for overlay items
  // NOTE: Only updates overlay items, NOT layer order. Layer order is controlled by Firestore layers array.
  useEffect(() => {
    if (!projectId) return
    const col = collection(db, pathForCanvasDoc().concat(['overlay']).join('/'))
    const unsub = onSnapshot(col, (snap) => {
      const items: any[] = []
      snap.forEach((d) => items.push(d.data()))
      setOverlay(items as any)
      // Do NOT rebuild layers here - layer order is controlled by Firestore layers array
      // Layer order should only change when manually moved via LayersModal up/down arrows
    })
    return () => unsub()
  }, [projectId, canvasId, (scope as any)?.type === 'child' ? (scope as any).childId : 'root', setOverlay])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full"
      style={{
        zIndex: 1,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Only render boxes if authorized or in presentation mode */}
      {(isAuthorized || presentation) && overlay.map((it) => {
        const isGardensReport = isGardensReportBox(it.id, it)
        const isOverlay = isGardensReportOverlayBox(it.id, it)
        const isKarmaSerpentine = isKarmaSerpentineBox(it.id, it)
        const isMilestoneOverlay = isKarmaSerpentineMilestoneOverlay(it.id, it)
        // Disable resize/drag for gardens-report boxes and karma-serpentine boxes
        const disableDrag = presentation || !isAuthorized || isGardensReport || isKarmaSerpentine || isMilestoneOverlay
        const disableResize = presentation || !isAuthorized || isGardensReport || isKarmaSerpentine || isMilestoneOverlay
        
        return (
        <Rnd
          key={it.id}
          size={{ width: it.w, height: it.h }}
          position={{ x: it.x, y: it.y }}
          disableDragging={disableDrag}
          disableResizing={disableResize}
          onDragStop={disableDrag ? undefined : (_, d) => {
            const nx = Math.round(d.x)
            const ny = Math.round(d.y)
            updateOverlay(it.id, { x: nx, y: ny })
            const itemRef = doc(db, pathForCanvasDoc().concat(['overlay', it.id]).join('/'))
            setDoc(itemRef, { x: nx, y: ny }, { merge: true })
          }}
          onResizeStop={disableResize ? undefined : (_, __, ref, ___, position) => {
            const nw = Math.round(ref.offsetWidth)
            const nh = Math.round(ref.offsetHeight)
            const nx = Math.round(position.x)
            const ny = Math.round(position.y)
            updateOverlay(it.id, { w: nw, h: nh, x: nx, y: ny })
            const itemRef = doc(db, pathForCanvasDoc().concat(['overlay', it.id]).join('/'))
            setDoc(itemRef, { w: nw, h: nh, x: nx, y: ny }, { merge: true })
          }}
          bounds="parent"
          style={{
            border: presentation ? 'none' : (it.id === selectedId ? '2px solid #ffcf33' : 'none'),
            background: (() => {
              const bg = (it as any).background
              if (!bg || bg.mode === 'none') return 'transparent'
              if (bg.mode === 'solid') return bg.from ?? '#000000'
              if (bg.mode === 'linear') return `linear-gradient(135deg, ${bg.from ?? '#000000'}, ${bg.to ?? '#000000'})`
              if (bg.mode === 'radial') return `radial-gradient(circle, ${bg.from ?? '#000000'}, ${bg.to ?? '#000000'})`
              return 'transparent'
            })(),
            borderRadius: 8,
            overflow: 'hidden',
            zIndex: idToZ[it.id] ?? 1,
            cursor: (presentation && (it as any)?.clickable) ? 'pointer' : undefined,
          }}
          onClick={(e: React.MouseEvent) => {
            // Skip handling clicks for snapshot boxes - they have their own overlay
            if (it.contentType === 'snapshot' && presentation && (it as any)?.clickable) {
              return
            }
            
            // In presentation mode, handle karma-serpentine milestone overlays
            if (presentation && isKarmaSerpentineMilestoneOverlay(it.id, it) && (it as any)?.clickable) {
              e.stopPropagation()
              // Open MilestoneViewer modal with the milestone data
              const milestoneData = {
                newsroomProjectId: (it as any).newsroomProjectId,
                newsroomFolderId: (it as any).newsroomFolderId,
                sourceBlockId: (it as any).sourceBlockId,
                summaryText: (it as any).summaryText, // Use summaryText for reverse lookup
                charactersInCard: (it as any).charactersInCard, // Character count for precise matching
              }
              openMilestoneViewerModal(milestoneData)
              return
            }
            
            // In presentation mode, handle attestations milestone badge with viewer
            if (presentation && it.contentType === 'attestations' && (it as any).attestationType === 'milestone outcomes badge' && (it as any).showViewer !== false && (it as any).selectedMilestone) {
              e.stopPropagation()
              openMilestoneViewerWithAttestationsModal({
                newsroomProjectId: (it as any).newsroomProjectId,
                newsroomFolderId: (it as any).newsroomFolderId,
                newsroomSnapshotId: (it as any).newsroomSnapshotId,
                officialDate: (it as any).selectedMilestone.officialDate,
                summary: (it as any).selectedMilestone.summary,
                imageUrl: (it as any).milestoneImage,
              })
              return
            }
            
            // In presentation mode, handle clickable boxes
            if (presentation && (it as any)?.clickable && (it as any)?.url) {
              e.stopPropagation()
              const url = (it as any).url
              const openIn = (it as any)?.openIn ?? 'new-tab'
              
              // Detect if external link (basic detection)
              const isExternal = (() => {
                try {
                  const parsed = new URL(url)
                  if (typeof window !== 'undefined') {
                    return parsed.origin !== window.location.origin
                  }
                  // If we can't determine, assume external for safety
                  return true
                } catch {
                  // Invalid URL, don't navigate
                  return false
                }
              })()
              
              if (openIn === 'new-tab') {
                // Open in new tab with security attributes for external links
                const link = document.createElement('a')
                link.href = url
                link.target = '_blank'
                if (isExternal) {
                  link.rel = 'noopener noreferrer'
                }
                link.click()
              } else {
                // Open in same tab
                window.location.href = url
              }
              return
            }
            
            // In edit mode, select box (existing behavior)
            if (!presentation && isAuthorized) {
              setSelectedId(it.id)
            }
          }}
          onDoubleClick={presentation || !isAuthorized ? undefined : () => {
            // Open appropriate modal based on box type
            if (isOverlay) {
              openGardensReportOverlayModal(it.id)
            } else if (isGardensReport) {
              openGardensReportModal(it.id)
            } else {
              openBoxModal(it.id)
            }
          }}
        >
          <div className="w-full h-full">
            {it.contentType === 'text' && (
              <AutoFitText
                text={(it as any).text?.content ?? ''}
                color={(it as any).text?.color ?? '#ffffff'}
                bold={!!(it as any).text?.bold}
                align={(it as any).text?.align ?? 'left'}
                fitToWidth={!!(it as any).text?.fitToWidth}
                baseFontSize={(it as any).text?.fontSize ?? 18}
                opacity={(it as any).text?.opacity !== undefined ? (it as any).text.opacity : 100}
              />
            )}
            {it.contentType === 'image' && (it as any).imageSrc && (
              <img
                src={(it as any).imageSrc}
                srcSet={(it as any).imageSrcset || undefined}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: ((it as any).imageBehavior ?? 'contain') as 'contain' | 'cover',
                  objectPosition: 'center',
                  opacity: ((it as any).imageOpacity !== undefined ? (it as any).imageOpacity : 100) / 100,
                }}
              />
            )}
            {it.contentType === 'animation' && (
              (it as any).animationType === 'url' || (it as any).animationUrl
                ? <EmbeddedAnimationRenderer animationUrl={(it as any).animationUrl} />
                : (it as any).lottieSrc
                  ? (
                    <LottieAnimationRenderer
                      lottieSrc={(it as any).lottieSrc}
                      loop={(it as any).loop ?? true}
                      autoplay={(it as any).autoplay ?? true}
                    />
                  )
                  : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-100 text-xs text-gray-500">
                      Add a Lottie file or URL in the box settings.
                    </div>
                  )
            )}
            {it.contentType === 'dune' && (
              <DuneBoxPlaceholder dune={(it as any).dune} />
            )}
            {it.contentType === 'kanban' && (
              <KanbanBoxPlaceholder kanban={(it as any).kanban} />
            )}
            {it.contentType === 'snapshot' && (it as any).snapshotProposalId && (
              <SnapshotVoteBox
                proposalId={(it as any).snapshotProposalId}
                backgroundColor={(it as any).backgroundColor ?? '#ffffff'}
                border={(it as any).border !== undefined ? (it as any).border : true}
                borderColor={(it as any).borderColor ?? '#000000'}
                borderWidth={(it as any).borderWidth ?? 1}
                projectId={projectId}
                canvasId={canvasId}
                scope={scope}
                clickable={(it as any)?.clickable ?? false}
                url={(it as any)?.url}
                openIn={(it as any)?.openIn ?? 'new-tab'}
                presentation={presentation}
              />
            )}
          </div>
        </Rnd>
        )
      })}

      {/* Only show draft rect if authorized */}
      {isAuthorized && currentTool === 'add-box' && draftRect && (
        <div
          className="absolute border-2 border-blue-400/70 bg-blue-400/10"
          style={{ left: draftRect.x, top: draftRect.y, width: draftRect.w, height: draftRect.h, pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}

function AutoFitText({
  text,
  color,
  bold,
  align,
  fitToWidth,
  baseFontSize,
  opacity = 100,
}: {
  text: string
  color: string
  bold: boolean
  align: 'left' | 'center' | 'right'
  fitToWidth: boolean
  baseFontSize: number
  opacity?: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [fontSize, setFontSize] = useState<number>(baseFontSize)
  const [lineHeight, setLineHeight] = useState<number>(1.2)

  useEffect(() => {
    if (!fitToWidth) {
      setFontSize(baseFontSize)
      setLineHeight(1.2)
      return
    }
    
    const node = ref.current
    if (!node) return
    const parent = node.parentElement
    if (!parent) return
    
    const measure = () => {
      const containerWidth = parent.clientWidth - 16 /* padding */
      const containerHeight = parent.clientHeight - 16 /* padding */
      
      if (containerWidth <= 0 || containerHeight <= 0) return
      
      // Canvas-style fit: calculate optimal font size considering box dimensions and text length
      const charCount = text.length
      const avgCharWidth = 0.6 // Approximate character width ratio
      const lineHeightRatio = 1.2
      
      // Calculate theoretical max font size based on width
      const maxWidthFontSize = containerWidth / (charCount * avgCharWidth)
      
      // Calculate theoretical max font size based on height (assuming single line)
      const maxHeightFontSize = containerHeight / lineHeightRatio
      
      // Calculate theoretical max font size for multi-line (estimate lines needed)
      const estimatedLines = Math.ceil((charCount * avgCharWidth * baseFontSize) / containerWidth)
      const maxMultiLineFontSize = containerHeight / (estimatedLines * lineHeightRatio)
      
      // Use the most conservative (smallest) font size to ensure text fits
      const optimalFontSize = Math.min(maxWidthFontSize, maxHeightFontSize, maxMultiLineFontSize)
      
      // Clamp between reasonable bounds
      const clampedFontSize = Math.max(8, Math.min(200, Math.floor(optimalFontSize)))
      
      setFontSize(clampedFontSize)
      setLineHeight(lineHeightRatio)
    }
    
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => { ro.disconnect() }
  }, [fitToWidth, baseFontSize, text])

  return (
    <div
      ref={ref}
      style={{
        color,
        fontSize,
        fontWeight: bold ? 700 : 400,
        lineHeight,
        display: 'flex',
        alignItems: 'center', // default vertical center
        justifyContent: align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end',
        width: '100%',
        height: '100%',
        padding: 8,
        textAlign: align,
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        whiteSpace: 'normal', // Allow wrapping
        opacity: opacity / 100, // Convert 0-100 to 0-1 for CSS
      }}
    >
      {text}
    </div>
  )
}

function LottieAnimationRenderer({ lottieSrc, loop, autoplay }: { lottieSrc: string; loop: boolean | number; autoplay: boolean }) {
  const [animationData, setAnimationData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadAnimation = async () => {
      try {
        setLoading(true)
        // Extract storage path from Firebase Storage URL
        // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token=...
        const urlParts = lottieSrc.split('/o/')
        if (urlParts.length !== 2) {
          throw new Error('Invalid Lottie URL format')
        }
        const encodedPath = urlParts[1].split('?')[0] // Remove query params
        const storageRefPath = decodeURIComponent(encodedPath) // Decode URL encoding (%2F -> /)
        
        const ref = storageRef(storage, storageRefPath)
        const bytes = await getBytes(ref)
        const text = new TextDecoder().decode(bytes)
        const data = JSON.parse(text)
        setAnimationData(data)
      } catch (err) {
        console.error('Failed to load Lottie animation:', err)
      } finally {
        setLoading(false)
      }
    }

    if (lottieSrc) {
      loadAnimation()
    }
  }, [lottieSrc])

  if (loading || !animationData) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <div className="text-xs text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <Lottie
      animationData={animationData}
      loop={typeof loop === 'boolean' ? loop : loop > 0}
      autoplay={autoplay}
      style={{ width: '100%', height: '100%' }}
      {...({
        renderer: 'canvas' as const,
        rendererSettings: {
          progressiveLoad: true,
          clearCanvas: true,
          preserveAspectRatio: 'none',
          dpr: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
        },
      } as any)}
    />
  )
}

function DuneBoxPlaceholder({ dune }: { dune?: any }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLCanvasElement | null>(null)
  const chartInstanceRef = useRef<any>(null)

  useEffect(() => {
    if (!dune?.queryId) {
      setLoading(false)
      setError('No query ID configured')
      return
    }
    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/dune/latest?queryId=${encodeURIComponent(dune.queryId)}`)
        const json = await res.json()
        if (!json.ok) {
          throw new Error(json.error || 'API error')
        }
        setData(json.data)
      } catch (e: any) {
        setError(e.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [dune?.queryId])

  useEffect(() => {
    const rows = data?.result?.rows ?? []
    if (!chartRef.current || rows.length === 0) return

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy()
      chartInstanceRef.current = null
    }

    const headers = Object.keys(rows[0] ?? [])
    const datesColumn = dune?.datesColumn ?? ''
    const labelColumn = datesColumn && headers.includes(datesColumn) ? datesColumn : headers.find((h) => typeof rows[0]?.[h] === 'string') || headers[0]
    const specifiedValueColumns = dune?.valueColumns?.filter((col: string) => col.trim() !== '' && headers.includes(col)) ?? []
    const valueColumns = specifiedValueColumns.length > 0 ? specifiedValueColumns : headers.filter((h) => h !== labelColumn && typeof rows[0]?.[h] === 'number')
    if (valueColumns.length === 0) return

    const parseDateSafe = (value: any): Date | null => {
      if (value == null) return null
      if (typeof value === 'number') {
        const d = new Date(value)
        return Number.isNaN(d.getTime()) ? null : d
      }
      if (typeof value === 'string') {
        const s = value.trim()
        const isoTry = new Date(s)
        if (!Number.isNaN(isoTry.getTime())) return isoTry
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
        if (m) {
          const year = Number(m[1])
          const month = Number(m[2]) - 1
          const day = Number(m[3])
          const hh = Number(m[4] ?? '0')
          const mm = Number(m[5] ?? '0')
          const ss = Number(m[6] ?? '0')
          const t = Date.UTC(year, month, day, hh, mm, ss)
          const d = new Date(t)
          return Number.isNaN(d.getTime()) ? null : d
        }
      }
      return null
    }

    let sortedRows = rows.slice()
    const rowsWithTimestamps = rows
      .map((r: any) => ({ r, d: parseDateSafe(r[labelColumn]), ts: parseDateSafe(r[labelColumn])?.getTime() ?? 0 }))
      .filter((x: { r: any; d: Date | null; ts: number }) => !!x.d && x.ts > 0)

    if (rowsWithTimestamps.length > 0) {
      sortedRows = rowsWithTimestamps
        .sort((a: { r: any; d: Date | null; ts: number }, b: { r: any; d: Date | null; ts: number }) => a.ts - b.ts)
        .map((x: { r: any; d: Date | null; ts: number }) => x.r)
    }

    const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const formatDate = (v: any) => {
      if (typeof v === 'string' && v.includes('-') && v.length > 10) {
        const d = new Date(v)
        if (!Number.isNaN(d.getTime())) {
          return `${monthShort[d.getUTCMonth()]}-${d.getUTCFullYear()}`
        }
      }
      const d = parseDateSafe(v)
      if (!d) return String(v ?? '')
      return `${monthShort[d.getUTCMonth()]}-${d.getUTCFullYear()}`
    }

    const labels = sortedRows.map((r: any) => formatDate(r[labelColumn]))

    import('chart.js/auto').then((chartjs) => {
      const Chart = chartjs.default
      const ctx = chartRef.current?.getContext('2d')
      if (!ctx) return

      const numDatesToShow = Math.max(2, dune?.datesToShow ?? 4)
      const totalPoints = labels.length
      const labelIndices: number[] = []
      for (let i = 0; i < numDatesToShow; i++) {
        const ratio = numDatesToShow === 1 ? 0.5 : i / (numDatesToShow - 1)
        const idx = Math.round(ratio * (totalPoints - 1))
        labelIndices.push(idx)
      }

      const colors = [
        { border: 'hsl(28, 90%, 50%)', fill: 'hsla(28, 90%, 50%, 0.20)' },
        { border: 'hsl(210, 70%, 50%)', fill: 'hsla(210, 70%, 50%, 0.20)' },
        { border: 'hsl(120, 70%, 50%)', fill: 'hsla(120, 70%, 50%, 0.20)' },
        { border: 'hsl(0, 70%, 50%)', fill: 'hsla(0, 70%, 50%, 0.20)' },
      ]

      const datasets = valueColumns.map((col: string, idx: number) => ({
        label: col,
        data: sortedRows.map((r: any) => r[col]),
        borderColor: colors[idx % colors.length].border,
        backgroundColor: colors[idx % colors.length].fill,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
      }))

      chartInstanceRef.current = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: {
              type: 'category',
              display: true,
              grid: { display: false },
              afterBuildTicks: (axis: any) => {
                axis.ticks = labelIndices.map((idx) => ({ value: idx, label: labels[idx] }))
              },
              ticks: { callback: function(this: any, value: any) { return this.getLabelForValue(value) } },
            },
            y: { display: false, grid: { display: false }, beginAtZero: true },
          },
          elements: { line: { borderJoinStyle: 'round' } },
        }
      })
    }).catch(() => {})

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy()
        chartInstanceRef.current = null
      }
    }
  }, [data, dune])

  if (!dune?.queryId) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900/40 text-gray-200 text-xs px-2">
        Add a Dune URL or query_id in the box settings.
      </div>
    )
  }
  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900/40 text-gray-200 text-xs">
        <div>Loading Dune data...</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900/40 text-red-300 text-xs px-2">
        <div className="text-center">
          <div className="font-semibold">Error</div>
          <div>{error}</div>
        </div>
      </div>
    )
  }
  const rows = data?.result?.rows ?? []
  if (rows.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900/40 text-gray-200 text-xs">
        <div>No data returned from query</div>
      </div>
    )
  }
  return (
    <div className="w-full h-full relative" style={{ background: 'white' }}>
      <canvas ref={chartRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}

function EmbeddedAnimationRenderer({ animationUrl }: { animationUrl?: string }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const safeUrl = useMemo(() => {
    if (!animationUrl) return ''
    try {
      const parsed = new URL(animationUrl)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString()
      }
      return ''
    } catch {
      return ''
    }
  }, [animationUrl])

  useEffect(() => {
    setIsLoaded(false)
  }, [safeUrl])

  if (!animationUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 text-xs text-gray-500">
        No animation URL provided.
      </div>
    )
  }

  if (!safeUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 text-xs text-gray-500 px-2 text-center">
        Invalid animation URL. Update the box settings to use http(s) links.
      </div>
    )
  }

  return (
    <div className="w-full h-full relative flex items-center justify-center bg-black/30 overflow-hidden">
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-200">
          Loading animation…
        </div>
      )}
      <iframe
        title="Embedded animation"
        src={safeUrl}
        style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none', display: 'block' }}
        allow="autoplay; fullscreen; clipboard-read; clipboard-write"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        scrolling="no"
        onLoad={() => setIsLoaded(true)}
      />
    </div>
  )
}

function KanbanBoxPlaceholder({ kanban }: { kanban?: any }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string>('')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const triedFallbackRef = useRef(false)
  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  useEffect(() => {
    if (!kanban?.embedUrl && !kanban?.sourceUrl) {
      setLoading(false)
      setError('No kanban board URL configured')
      return
    }

    // Reset state when URL changes
    setLoading(true)
    setError(null)
    triedFallbackRef.current = false

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // On localhost, try sourceUrl first (original format) as embed URLs are often blocked
    // On production, try embedUrl first for cleaner embedding
    const urlToUse = isLocalhost 
      ? (kanban?.sourceUrl || kanban?.embedUrl)
      : (kanban?.embedUrl || kanban?.sourceUrl)
    setCurrentUrl(urlToUse)

    // Set a shorter timeout for localhost since we know it will likely fail
    const timeoutDuration = isLocalhost ? 5000 : 15000
    timeoutRef.current = setTimeout(() => {
      setLoading((prevLoading) => {
        if (prevLoading && !triedFallbackRef.current) {
          // Try fallback URL if we haven't already
          if (isLocalhost && kanban?.embedUrl && urlToUse === kanban?.sourceUrl) {
            // On localhost, if sourceUrl didn't work, try embedUrl (though it likely won't work either)
            triedFallbackRef.current = true
            setCurrentUrl(kanban.embedUrl)
            if (iframeRef.current) {
              iframeRef.current.src = kanban.embedUrl
            }
            return true
          } else if (!isLocalhost && kanban?.sourceUrl && urlToUse === kanban?.embedUrl) {
            // On production, if embedUrl didn't work, try sourceUrl
            triedFallbackRef.current = true
            setCurrentUrl(kanban.sourceUrl)
            if (iframeRef.current) {
              iframeRef.current.src = kanban.sourceUrl
            }
            return true
          } else {
            // No fallback available or already tried
            if (isLocalhost) {
              setError('Notion embeds are blocked on localhost due to security restrictions. This will work when deployed to production (Vercel, Netlify, etc.).')
            } else {
              setError('Board is taking too long to load. The board may not be published to the web, or there may be a connection issue.')
            }
            return false
          }
        } else if (prevLoading) {
          if (isLocalhost) {
            setError('Notion embeds are blocked on localhost due to security restrictions. This will work when deployed to production (Vercel, Netlify, etc.).')
          } else {
            setError('Board is taking too long to load. The board may not be published to the web, or there may be a connection issue.')
          }
          return false
        }
        return prevLoading
      })
    }, timeoutDuration)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [kanban?.embedUrl, kanban?.sourceUrl, isLocalhost])

  const handleIframeLoad = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setLoading(false)
    setError(null)
  }

  const handleIframeError = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setLoading(false)
    setError('Failed to load kanban board. Make sure your Notion board is published to the web.')
  }

  const handleRetry = () => {
    setLoading(true)
    setError(null)
    if (iframeRef.current) {
      // Force reload by appending timestamp
      const url = new URL(iframeRef.current.src)
      url.searchParams.set('_reload', Date.now().toString())
      iframeRef.current.src = url.toString()
    }
  }

  if (!currentUrl && !kanban?.embedUrl && !kanban?.sourceUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900/40 text-gray-200 text-xs px-2">
        <div className="text-center">
          <div className="font-semibold mb-1">No kanban board configured</div>
          <div>Add a Notion kanban board URL in the box settings.</div>
        </div>
      </div>
    )
  }

  const urlToDisplay = currentUrl || kanban?.embedUrl || kanban?.sourceUrl

  return (
    <div className="w-full h-full relative bg-white">
      {/* Show iframe immediately - let it load naturally */}
      <iframe
        ref={iframeRef}
        src={urlToDisplay}
        title="Notion Kanban Board"
        className="w-full h-full border-0"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        allow="clipboard-read; clipboard-write; fullscreen"
        // Removed sandbox restrictions for Notion embeds - they need full access to work properly
      />
      {/* Loading overlay - fades away when loaded or after timeout */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 transition-opacity duration-300">
          <div className="text-center">
            <div className="text-sm text-gray-600 mb-2">Loading Notion board...</div>
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          </div>
        </div>
      )}
      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-20">
          <div className="text-center px-4 max-w-md">
            <div className="text-sm font-semibold text-red-600 mb-2">Error loading board</div>
            <div className="text-xs text-gray-600 mb-3">{error}</div>
            {isLocalhost && (
              <div className="text-xs text-blue-600 mb-3 p-2 bg-blue-50 rounded">
                💡 Tip: Notion embeds work on deployed sites. Try deploying to Vercel or Netlify to test the kanban board.
              </div>
            )}
            <button
              onClick={handleRetry}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
