'use client'

import React, { useEffect, useRef, useState } from 'react'
import CanvasHybrid from './CanvasHybrid'
import { Toolbar } from './Toolbar'
import { RatioSelector } from './RatioSelector'
import { Canvas } from './Canvas'
import { useCanvasStore } from '@/app/interoperable-canvas/components/store'
import { BackgroundGradientModal } from './BackgroundGradientModal'
import LayersModal from '@/app/interoperable-canvas/components/LayersModal'
import BoxContentModal from '@/app/interoperable-canvas/components/BoxContentModal'
import GardensReportModal from '@/app/interoperable-canvas/components/GardensReportModal'
import GardensReportOverlayModal from '@/app/interoperable-canvas/components/GardensReportOverlayModal'
import MilestoneViewerModal from '@/app/interoperable-canvas/components/MilestoneViewerModal'
import ConnectWalletButton from './ConnectWalletButton'
import { useRouter, usePathname } from 'next/navigation'

import { initializeApp, getApps } from 'firebase/app'
import { getFirestore, doc, onSnapshot, setDoc, collection, getDocs, getDoc } from 'firebase/firestore'
import { getStorage, ref as storageRef, uploadBytes } from 'firebase/storage'

type CanvasScope = { type: 'root' } | { type: 'child'; childId: string }
type Props = { projectId?: string; scope?: CanvasScope; canvasId?: string }

// Basic client-side Firebase init using env vars already used elsewhere in app
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

export function CanvasApp({ projectId, scope: initialScope = { type: 'root' }, canvasId = 'root' }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [scope, setScope] = useState<CanvasScope>(initialScope)
  const [childIds, setChildIds] = useState<string[]>([])
  const [isPresentation, setIsPresentation] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const isPresentationRef = useRef(false)
  const isInitialMountRef = useRef(true)
  
  // Check if presentation mode and fullscreen mode are enabled via URL parameter (client-side only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const presentationMode = urlParams.get('presentation') === 'true'
      setIsPresentation(presentationMode)
      isPresentationRef.current = presentationMode
      setIsFullscreen(urlParams.get('fullscreen') === 'true')
    }
  }, [])

  // Sync scope changes to URL (but not on initial mount to avoid conflicts with page.tsx)
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      return
    }

    if (!projectId || typeof window === 'undefined') return

    const urlParams = new URLSearchParams(window.location.search)
    
    // Update childId param based on scope
    if (scope.type === 'child') {
      urlParams.set('childId', scope.childId)
    } else {
      urlParams.delete('childId')
    }

    // Preserve other params (projectId, presentation, fullscreen, etc.)
    if (!urlParams.has('projectId')) {
      urlParams.set('projectId', projectId)
    }

    // Update URL without causing page reload
    const newUrl = `${pathname}?${urlParams.toString()}`
    router.replace(newUrl, { scroll: false })
  }, [scope, projectId, pathname, router])

  const aspect = useCanvasStore((s: any) => s.aspect)
  const setAspect = useCanvasStore((s: any) => s.setAspect)
  const background = useCanvasStore((s: any) => s.background)
  const setBackground = useCanvasStore((s: any) => s.setBackground)
  const layers = useCanvasStore((s: any) => s.layers)
  const setLayers = useCanvasStore((s: any) => s.setLayers)
  const ui = useCanvasStore((s: any) => s.ui)
  const openLayers = useCanvasStore((s: any) => s.openLayersModal)
  const closeLayers = useCanvasStore((s: any) => s.closeLayersModal)
  const closeBackground = useCanvasStore((s: any) => s.closeBackgroundModal)

  // Removed window events; use Zustand UI slice instead

  const bgStyle = background.mode === 'linear'
    ? `linear-gradient(135deg, ${background.from}, ${background.to})`
    : background.mode === 'radial'
    ? `radial-gradient(circle, ${background.from}, ${background.to})`
    : background.mode === 'solid'
    ? background.from
    : background.mode === 'zigzag'
    ? 'zigzag' // Special marker for zigzag mode
    : ''

  const buildPath = (...tail: string[]) => {
    if (!projectId) return tail
    const base: string[] = ['interoperable-canvas', projectId]
    if (scope.type === 'child') base.push('child-canvases', scope.childId)
    base.push('canvases', canvasId)
    return [...base, ...tail]
  }

  // Load list of child canvases for selector
  useEffect(() => {
    if (!projectId) { setChildIds([]); return }
    const load = async () => {
      try {
        const col = collection(db, ['interoperable-canvas', projectId, 'child-canvases'].join('/'))
        const snap = await getDocs(col)
        const ids: string[] = []
        snap.forEach((d) => ids.push(d.id))
        setChildIds(ids.sort())
      } catch {
        setChildIds([])
      }
    }
    load()
  }, [projectId])

  // Track if we're syncing from Firestore to prevent persistence loops
  const isSyncingFromFirestoreRef = useRef(false)

  // Sync background, aspect ratio, and layers with Firestore (scoped canvas)
  useEffect(() => {
    if (!projectId) return
    const path = buildPath().join('/')
    console.log('[CanvasApp] Loading canvas from path:', path)
    const rootCanvasRef = doc(db, path)

    const rebuildLayersFromOverlay = async () => {
      try {
        // First, check if there's an existing layers array or zIndexMap in Firestore to preserve order
        const currentDoc = await getDoc(rootCanvasRef)
        const currentData = currentDoc.data() as any
        const existingZIndexMap = currentData?.zIndexMap as Record<string, number> | undefined
        const existingLayers = Array.isArray(currentData?.layers) ? (currentData.layers as string[]) : []
        
        const overlayColPath = buildPath('overlay').join('/')
        const colRef = collection(db, overlayColPath)
        const snap = await getDocs(colRef)
        const items: Array<{ id: string; name?: string; nameKey?: string }> = []
        snap.forEach((d) => items.push({ id: d.id, ...(d.data() as any) }))
        
        // SAFEGUARD: If we have existing layers but no overlay items found, don't overwrite
        // This prevents accidentally clearing the layers array due to query failures or timing issues
        if (existingLayers.length > 1 && items.length === 0) {
          console.warn('[CanvasApp] rebuildLayersFromOverlay: Found existing layers but no overlay items. Preserving existing layers to prevent data loss.')
          setLayers(existingLayers.map((id, idx) => ({ id, name: id === 'background' ? 'Background' : id, z: idx })))
          setTimeout(() => { isSyncingFromFirestoreRef.current = false }, 100)
          return
        }
        
        // If we have an existing layers array with valid order, use it to preserve order
        // Otherwise, if we have zIndexMap, use that
        // Otherwise, fall back to alphabetical sorting for new canvases
        let sorted: Array<{ id: string; name?: string; nameKey?: string }>
        
        // Create set of valid item IDs from overlay collection
        const validItemIds = new Set(items.map(it => it.id))
        
        if (existingLayers.length > 1) {
          // Use existing layers array order (most reliable)
          // Filter out any IDs that no longer exist in overlay
          const existingIds = existingLayers.filter(id => id !== 'background' && validItemIds.has(id))
          const existingItems = existingIds
            .map(id => items.find(it => it.id === id))
            .filter((it): it is { id: string; name?: string; nameKey?: string } => !!it)
          const newItems = items.filter(it => !existingIds.includes(it.id) && it.id !== 'background')
          sorted = [...existingItems, ...newItems.sort((a, b) => {
            const aKey = (a.nameKey ?? a.id ?? '').toString()
            const bKey = (b.nameKey ?? b.id ?? '').toString()
            return aKey.localeCompare(bKey)
          })]
        } else if (existingZIndexMap && Object.keys(existingZIndexMap).length > 0) {
          // Fall back to zIndexMap if layers array doesn't exist
          // Filter out any IDs that no longer exist in overlay
          const existingIds = Object.keys(existingZIndexMap)
            .filter(id => id !== 'background' && validItemIds.has(id))
            .sort((a, b) => (existingZIndexMap[a] ?? 999) - (existingZIndexMap[b] ?? 999))
          const existingItems = existingIds
            .map(id => items.find(it => it.id === id))
            .filter((it): it is { id: string; name?: string; nameKey?: string } => !!it)
          const newItems = items.filter(it => !existingZIndexMap[it.id] && it.id !== 'background')
          sorted = [...existingItems, ...newItems.sort((a, b) => {
            const aKey = (a.nameKey ?? a.id ?? '').toString()
            const bKey = (b.nameKey ?? b.id ?? '').toString()
            return aKey.localeCompare(bKey)
          })]
        } else {
          // No existing order, sort alphabetically
          sorted = items
            .filter((it) => typeof it.id === 'string' && it.id.trim())
            .sort((a, b) => {
              const aKey = (a.nameKey ?? a.id ?? '').toString()
              const bKey = (b.nameKey ?? b.id ?? '').toString()
              return aKey.localeCompare(bKey)
            })
        }
        
        const overlayIds = sorted.map((it) => it.id)
        const ensured = ['background', ...overlayIds]
        const zIndexMap: Record<string, number> = {}
        ensured.forEach((id, idx) => { zIndexMap[id] = idx })
        await setDoc(rootCanvasRef, { layers: ensured, zIndexMap }, { merge: true })
        const rebuilt = ensured.map((id, idx) => ({
          id,
          name: id === 'background' ? 'Background' : (sorted.find((it) => it.id === id)?.name ?? id),
          z: idx,
        }))
        setLayers(rebuilt)
      } catch (err) {
        console.error('[CanvasApp] Failed to rebuild layers from overlay:', err)
        setLayers([{ id: 'background', name: 'Background', z: 0 }])
      } finally {
        setTimeout(() => { isSyncingFromFirestoreRef.current = false }, 100)
      }
    }

    const unsub = onSnapshot(rootCanvasRef, async (snap) => {
      isSyncingFromFirestoreRef.current = true // Prevent persistence loop
      const data = snap.data() as any
      console.log('[CanvasApp] Received data:', { hasBackground: !!data?.background, background: data?.background })
      if (data?.background && typeof data.background === 'object') {
        setBackground({
          mode: (data.background.mode ?? 'none'),
          from: data.background.from ?? '#000000',
          to: data.background.to ?? '#000000',
        })
      } else {
        // Only set UI defaults, don't overwrite Firestore
        setBackground({
          mode: 'linear',
          from: 'rgb(50, 250, 150)',
          to: 'rgb(150, 200, 250)',
        })
        // NOTE: Don't write defaults to Firestore here - let user save their own colors
      }
      if (data?.aspect) {
        setAspect(data.aspect)
      }
      // In presentation mode, ONLY use the layers array from Firestore - never rebuild
      // Layer order can only be changed via LayersModal up/down arrows (which only works in edit mode)
      if (Array.isArray(data?.layers) && data.layers.length > 0) {
        const ids = (data.layers as string[])
        // In presentation mode, preserve EXACT order from Firestore - no manipulation
        // In edit mode, ensure background is first (for UI consistency)
        const orderedIds = isPresentationRef.current 
          ? ids  // Presentation: exact order from Firestore
          : (ids[0] === 'background' ? ids : ['background', ...ids.filter((i) => i !== 'background')])  // Edit: ensure background first
        const rebuilt = orderedIds.map((id: string, idx: number) => ({ id, name: id === 'background' ? 'Background' : id, z: idx }))
        setLayers(rebuilt)
        // Reset flag after a tick to allow manual changes to persist
        setTimeout(() => {
          isSyncingFromFirestoreRef.current = false
        }, 100)
      } else {
        // Only rebuild layers in edit mode - never in presentation mode
        if (!isPresentationRef.current) {
          await rebuildLayersFromOverlay()
        } else {
          // In presentation mode, if no layers array exists, just use background
          // Don't rebuild - let the user fix it in edit mode
          setLayers([{ id: 'background', name: 'Background', z: 0 }])
          setTimeout(() => {
            isSyncingFromFirestoreRef.current = false
          }, 100)
        }
      }
    })
    return () => unsub()
  }, [projectId, scope, canvasId, setBackground, setAspect, setLayers])

  const persistBackground = async (next: { mode: 'none' | 'solid' | 'linear' | 'radial' | 'zigzag'; from: string; to: string }) => {
    if (isPresentation) return // Don't persist in presentation mode
    setBackground(next)
    if (!projectId) return
    const rootCanvasRef = doc(db, buildPath().join('/'))
    await setDoc(rootCanvasRef, { background: next }, { merge: true })
  }

  const persistAspect = async (next: '1:1' | '16:9' | '4:3' | '9:16' | '4:6' | 'mini-app' | 'landing-page' | 'mobile-landing-page') => {
    if (isPresentation) return // Don't persist in presentation mode
    setAspect(next)
    if (!projectId) return
    const rootCanvasRef = doc(db, buildPath().join('/'))
    await setDoc(rootCanvasRef, { aspect: next }, { merge: true })
  }

  // Debounced layers persistence (150–250ms)
  const layersDebounceRef = useRef<any>(null)
  const persistLayersDebounced = (nextLayers: any[]) => {
    if (!projectId || isPresentation) return // Don't persist in presentation mode
    if (layersDebounceRef.current) clearTimeout(layersDebounceRef.current)
    layersDebounceRef.current = setTimeout(async () => {
      // Filter out any undefined or invalid layer IDs
      const validLayers = nextLayers.filter((l: any) => l && l.id && typeof l.id === 'string' && l.id.trim() !== '')
      const ids = validLayers.map((l: any) => l.id).filter((id: string, idx: number, arr: string[]) => arr.indexOf(id) === idx)
      const ensured = ids[0] === 'background' ? ids : ['background', ...ids.filter((i) => i !== 'background')]
      const zIndexMap: Record<string, number> = {}
      ensured.forEach((id: string, idx: number) => { zIndexMap[id] = idx })
      const rootCanvasRef = doc(db, buildPath().join('/'))
      // Only write if we have valid data
      if (ensured.length > 0 && Object.keys(zIndexMap).length > 0) {
        await setDoc(rootCanvasRef, { layers: ensured, zIndexMap }, { merge: true })
      }
    }, 200)
  }

  // Persist whenever local layers change (but NOT when syncing from Firestore)
  // Layer order should only change when:
  // 1. New box is created (added to end)
  // 2. Manually moved via LayersModal up/down arrows
  // NEVER persist in presentation mode - layers are read-only
  useEffect(() => {
    if (!projectId) return
    // Skip persistence if we're currently syncing from Firestore
    if (isSyncingFromFirestoreRef.current) {
      return
    }
    // Never persist layers in presentation mode - they should be read-only
    if (isPresentationRef.current) {
      return
    }
    persistLayersDebounced(layers)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, layers])

  // Determine if user can edit (not in presentation mode)
  // In open-source version, all authenticated users can edit (no authorization check)
  const canEdit = !isPresentation

  return (
    <div className={`min-h-screen flex ${isPresentation ? 'bg-gray-800' : 'bg-gray-800'}`}>
      {/* Sidebar - hidden only in presentation mode, always shown in edit mode */}
      {!isPresentation && (
        <div className="fixed left-0 top-0 h-screen w-48 p-4 bg-gray-900 flex flex-col gap-3 overflow-y-auto">
          <ConnectWalletButton />
          <div className={canEdit ? '' : 'opacity-50 pointer-events-none'}>
            <Toolbar />
            {/* Scope selector for root vs child group */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Canvas Scope</label>
              <select
                value={scope.type === 'root' ? 'root' : `child:${scope.childId}`}
                onChange={async (e) => {
                  const v = e.target.value
                  if (v === 'root') {
                    setScope({ type: 'root' })
                  } else if (v === 'create-child') {
                    // Handle create child action
                    if (!projectId || !canEdit) return
                    const childId = prompt('New child canvas id (e.g., mini-app-test-2)')?.trim()
                    if (!childId) {
                      // Reset select to current scope if cancelled
                      e.target.value = scope.type === 'root' ? 'root' : `child:${scope.childId}`
                      return
                    }
                    // Create child metadata doc and root canvas doc
                    const childMetaPath = ['interoperable-canvas', projectId, 'child-canvases', childId].join('/')
                    await setDoc(doc(db, childMetaPath), { createdAt: Date.now() }, { merge: true })
                    const path = ['interoperable-canvas', projectId, 'child-canvases', childId, 'canvases', 'root'].join('/')
                    // Always use 'landing-page' (Desktop Landing) as default aspect ratio for new child canvases
                    await setDoc(doc(db, path), { aspect: 'landing-page', createdAt: Date.now() }, { merge: true })
                    // Create storage folders by uploading a placeholder file under images/
                    try {
                      const keepPath = `interoperable-canvas/assets/${projectId}/child-canvases/${childId}/images/.keep`
                      const bytes = new Blob(['placeholder'], { type: 'text/plain' })
                      await uploadBytes(storageRef(storage, keepPath), bytes, { cacheControl: 'no-store' })
                    } catch {}
                    const newScope = { type: 'child' as const, childId }
                    setScope(newScope)
                    // refresh list
                    try {
                      const col = collection(db, ['interoperable-canvas', projectId, 'child-canvases'].join('/'))
                      const snap = await getDocs(col)
                      const ids: string[] = []
                      snap.forEach((d) => ids.push(d.id))
                      setChildIds(ids.sort())
                    } catch {}
                  } else if (v.startsWith('child:')) {
                    setScope({ type: 'child', childId: v.split(':')[1] || 'mini-app-test' })
                  }
                }}
                className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600"
                disabled={!canEdit}
              >
                <option value="root">Root</option>
                <option value="create-child" style={{ fontWeight: 'bold', color: '#6b21a8' }}>++ Add Child ++</option>
                {childIds.map((id) => (
                  <option key={id} value={`child:${id}`}>Child: {id}</option>
                ))}
              </select>
            </div>
            <RatioSelector onAspectChange={persistAspect} />
            <button
              className="w-full px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (!projectId) return
                // Build URL using slug system: /{projectId}/?childId={childId}&presentation=true&fullscreen=true
                const baseUrl = 'https://infinite-fountain.web.app'
                const url = new URL(`/${projectId}`, baseUrl)
                // Get childId from scope or URL params and set it first
                const currentChildId = scope.type === 'child' ? scope.childId : (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('childId') : null)
                if (currentChildId) {
                  url.searchParams.set('childId', currentChildId)
                }
                url.searchParams.set('presentation', 'true')
                url.searchParams.set('fullscreen', 'true')
                window.open(url.toString(), '_blank')
              }}
              disabled={!projectId}
            >
              View Site
            </button>
          </div>
        </div>
      )}
      {/* Canvas area - centered in presentation mode */}
      <div className={`${isPresentation ? 'w-full h-screen flex justify-center overflow-y-auto' : 'flex-1 ml-48 overflow-hidden'}`}>
        <Canvas 
          aspect={aspect} 
          backgroundColor={bgStyle} 
          backgroundMode={background.mode}
          backgroundFrom={background.from}
          backgroundTo={background.to}
          presentation={isPresentation} 
          fullscreen={isFullscreen}
        >
          <div className="w-full h-full">
            <CanvasHybrid 
              projectId={projectId ?? 'demo'} 
              scope={scope} 
              canvasId={canvasId} 
              presentation={isPresentation}
              isAuthorized={isPresentation ? true : canEdit}
            />
          </div>
        </Canvas>
      </div>
      <BackgroundGradientModal
        open={ui.showBackgroundModal}
        mode={background.mode}
        from={background.from}
        to={background.to}
        onClose={() => closeBackground()}
        onSave={(b) => { persistBackground(b); closeBackground() }}
      />
      {/* scope-aware modals */}
      {/* @ts-ignore add scope prop */}
      <LayersModal open={ui.showLayersModal} onClose={() => closeLayers()} projectId={projectId ?? 'demo'} canvasId={canvasId} scope={scope} />
      {/* @ts-ignore add scope prop */}
      <BoxContentModal projectId={projectId ?? 'demo'} canvasId={canvasId} scope={scope} />
      {/* @ts-ignore add scope prop */}
      <GardensReportModal projectId={projectId ?? 'demo'} canvasId={canvasId} scope={scope} />
      <GardensReportOverlayModal />
      <MilestoneViewerModal />
    </div>
  )
}
