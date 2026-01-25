import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type GridItem = {
  id: string
  x: number
  y: number
  w: number
  h: number
  type: 'chart' | 'image' | 'text' | 'snapshot'
}

export type OverlayContentType = 'none' | 'text' | 'image' | 'chart' | 'animation' | 'dune' | 'kanban' | 'snapshot' | 'milestone' | 'attestations'

// Milestone data for MilestoneViewer modal
export type MilestoneViewerData = {
  newsroomProjectId: string
  newsroomFolderId: string
  sourceBlockId: string
  summaryText: string // Summary text used for reverse lookup (first N characters as displayed in card)
  charactersInCard?: number // Character count used for truncation (for precise matching)
} | null

// Milestone data for MilestoneViewerWithAttestations modal
export type MilestoneViewerWithAttestationsData = {
  newsroomProjectId: string
  newsroomFolderId: string
  newsroomSnapshotId: string
  officialDate: string
  summary: string
  imageUrl?: string | null
} | null

export type OverlayItem = {
  id: string
  x: number // px
  y: number // px
  w: number // px
  h: number // px
  contentType: OverlayContentType
  text?: string
  imageSrc?: string
  lottieSrc?: string // URL to Lottie JSON file
  loop?: boolean | number // true for infinite, number for specific count
  autoplay?: boolean
  fontSize?: number
  color?: string
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  clickable?: boolean // If true, box is clickable
  url?: string // URL to navigate to when clicked (required if clickable=true)
  openIn?: 'new-tab' | 'same-tab' // How to open the link (default: 'new-tab')
}

export type Layer = {
  id: string
  name: string
  z: number
}

export type CanvasState = {
  aspect: '1:1' | '16:9' | '4:3' | '9:16' | '4:6' | 'mini-app' | 'landing-page' | 'mobile-landing-page'
  setAspect: (a: '1:1' | '16:9' | '4:3' | '9:16' | '4:6' | 'mini-app' | 'landing-page' | 'mobile-landing-page') => void
  background: { mode: 'none' | 'solid' | 'linear' | 'radial' | 'zigzag'; from: string; to: string }
  setBackground: (b: { mode: 'none' | 'solid' | 'linear' | 'radial' | 'zigzag'; from: string; to: string }) => void
  items: GridItem[]
  overlay: OverlayItem[]
  setOverlay: (items: OverlayItem[]) => void
  layers: Layer[]
  ui: { showBackgroundModal: boolean; showLayersModal: boolean; showBoxModal: boolean; showGardensReportModal: boolean; showGardensReportOverlayModal: boolean; showMilestoneViewerModal: boolean; showMilestoneViewerWithAttestationsModal: boolean; currentTool: 'none' | 'add-box' }
  milestoneViewerData: MilestoneViewerData
  milestoneViewerWithAttestationsData: MilestoneViewerWithAttestationsData
  selectedId: string | null
  addItem: (item: GridItem) => void
  updateItem: (id: string, partial: Partial<GridItem>) => void
  setItems: (items: GridItem[]) => void
  addOverlay: (item: OverlayItem) => void
  updateOverlay: (id: string, partial: Partial<OverlayItem>) => void
  addLayer: (layer: Layer) => void
  setLayers: (layers: Layer[]) => void
  moveLayerUp: (id: string) => void
  moveLayerDown: (id: string) => void
  openBackgroundModal: () => void
  closeBackgroundModal: () => void
  openLayersModal: () => void
  closeLayersModal: () => void
  setTool: (t: 'none' | 'add-box') => void
  setSelectedId: (id: string | null) => void
  openBoxModal: (id: string) => void
  closeBoxModal: () => void
  openGardensReportModal: (id: string) => void
  closeGardensReportModal: () => void
  openGardensReportOverlayModal: (id: string) => void
  closeGardensReportOverlayModal: () => void
  openMilestoneViewerModal: (data: MilestoneViewerData) => void
  closeMilestoneViewerModal: () => void
  openMilestoneViewerWithAttestationsModal: (data: MilestoneViewerWithAttestationsData) => void
  closeMilestoneViewerWithAttestationsModal: () => void
  createBox: (rect: { x: number; y: number; w: number; h: number; contentType?: OverlayContentType; id?: string; name?: string }) => string
}

export const useCanvasStore = create<CanvasState>()(
  immer((set) => ({
    aspect: '1:1',
    setAspect: (a) => set((s) => { s.aspect = a }),
    background: { mode: 'solid', from: '#000000', to: '#000000' },
    setBackground: (b) => set((s) => { s.background = b }),
    items: [],
    overlay: [],
    setOverlay: (items) => set((s) => { s.overlay = items }),
    layers: [{ id: 'background', name: 'Background', z: 0 }],
    ui: { showBackgroundModal: false, showLayersModal: false, showBoxModal: false, showGardensReportModal: false, showGardensReportOverlayModal: false, showMilestoneViewerModal: false, showMilestoneViewerWithAttestationsModal: false, currentTool: 'none' },
    milestoneViewerData: null,
    milestoneViewerWithAttestationsData: null,
    selectedId: null,
    addItem: (item) => set((s) => { s.items.push(item) }),
    updateItem: (id, partial) => set((s) => {
      const i = s.items.findIndex((it) => it.id === id)
      if (i >= 0) Object.assign(s.items[i], partial)
    }),
    setItems: (items) => set((s) => { s.items = items }),
    addOverlay: (item) => set((s) => { s.overlay.push(item) }),
    updateOverlay: (id, partial) => set((s) => {
      const i = s.overlay.findIndex((it) => it.id === id)
      if (i >= 0) Object.assign(s.overlay[i], partial)
    }),
    addLayer: (layer) => set((s) => { s.layers.push(layer) }),
    setLayers: (layers) => set((s) => { s.layers = layers }),
    moveLayerUp: (id) => set((s) => {
      if (id === 'background') return
      const idx = s.layers.findIndex((l) => l.id === id)
      if (idx >= 0 && idx < s.layers.length - 1) {
        const tmp = s.layers[idx]
        s.layers[idx] = s.layers[idx + 1]
        s.layers[idx + 1] = tmp
        // recompute z values
        s.layers.forEach((l, i) => { l.z = i })
      }
    }),
    moveLayerDown: (id) => set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id)
      if (idx > 0) {
        // Do not allow swapping below background
        if (s.layers[idx - 1]?.id === 'background') return
        const tmp = s.layers[idx]
        s.layers[idx] = s.layers[idx - 1]
        s.layers[idx - 1] = tmp
        s.layers.forEach((l, i) => { l.z = i })
      }
    }),
    openBackgroundModal: () => set((s) => { s.ui.showBackgroundModal = true }),
    closeBackgroundModal: () => set((s) => { s.ui.showBackgroundModal = false }),
    openLayersModal: () => set((s) => { s.ui.showLayersModal = true }),
    closeLayersModal: () => set((s) => { s.ui.showLayersModal = false }),
    setTool: (t) => set((s) => { s.ui.currentTool = t }),
    setSelectedId: (id) => set((s) => { s.selectedId = id }),
    openBoxModal: (id) => set((s) => { s.selectedId = id; s.ui.showBoxModal = true }),
    closeBoxModal: () => set((s) => { s.ui.showBoxModal = false }),
    openGardensReportModal: (id) => set((s) => { s.selectedId = id; s.ui.showGardensReportModal = true }),
    closeGardensReportModal: () => set((s) => { s.ui.showGardensReportModal = false }),
    openGardensReportOverlayModal: (id) => set((s) => { s.selectedId = id; s.ui.showGardensReportOverlayModal = true }),
    closeGardensReportOverlayModal: () => set((s) => { s.ui.showGardensReportOverlayModal = false }),
    openMilestoneViewerModal: (data) => set((s) => { s.milestoneViewerData = data; s.ui.showMilestoneViewerModal = true }),
    closeMilestoneViewerModal: () => set((s) => { s.milestoneViewerData = null; s.ui.showMilestoneViewerModal = false }),
    openMilestoneViewerWithAttestationsModal: (data) => set((s) => { s.milestoneViewerWithAttestationsData = data; s.ui.showMilestoneViewerWithAttestationsModal = true }),
    closeMilestoneViewerWithAttestationsModal: () => set((s) => { s.milestoneViewerWithAttestationsData = null; s.ui.showMilestoneViewerWithAttestationsModal = false }),
    createBox: (rect) => {
      let newId = rect.id
      if (!newId) {
        const rand = Math.random().toString(36).slice(2, 7)
        newId = `box_${Date.now()}_${rand}`
      }
      const minW = Math.max(16, Math.round(rect.w))
      const minH = Math.max(16, Math.round(rect.h))
      set((s) => {
        const nextZ = s.layers.length // background at 0, so next index is top-most
        s.overlay.push({ id: newId!, x: Math.round(rect.x), y: Math.round(rect.y), w: minW, h: minH, contentType: rect.contentType ?? 'none' })
        s.layers.push({ id: newId!, name: rect.name ?? newId!, z: nextZ })
        s.ui.currentTool = 'none'
        s.selectedId = newId!
      })
      return newId
    },
  }))
)
