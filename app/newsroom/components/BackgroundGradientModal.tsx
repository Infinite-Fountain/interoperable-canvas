'use client'

import React, { useMemo } from 'react'

interface BackgroundGradientModalProps {
  open: boolean
  mode: 'none' | 'linear' | 'radial' | 'solid' | 'zigzag'
  from: string
  to: string
  onClose: () => void
  onSave: (background: { mode: 'none' | 'linear' | 'radial' | 'solid' | 'zigzag'; from: string; to: string }) => void
}

export function BackgroundGradientModal({ open, mode, from, to, onClose, onSave }: BackgroundGradientModalProps) {
  const [localMode, setLocalMode] = React.useState<'none' | 'solid' | 'linear' | 'radial' | 'zigzag'>(mode ?? 'solid')
  const [localFrom, setLocalFrom] = React.useState(from)
  const [localTo, setLocalTo] = React.useState(to)

  // Keep modal in sync when opening with current Firestore values
  React.useEffect(() => {
    if (!open) return
    setLocalMode((mode ?? 'solid') as any)
    setLocalFrom(from)
    setLocalTo(to)
  }, [open, mode, from, to])

  const preview = useMemo(() => {
    if (localMode === 'solid') return localFrom
    if (localMode === 'linear') return `linear-gradient(135deg, ${localFrom}, ${localTo})`
    if (localMode === 'radial') return `radial-gradient(circle, ${localFrom}, ${localTo})`
    if (localMode === 'zigzag') return `linear-gradient(135deg, ${localFrom}, ${localTo})` // Preview with first gradient direction
    return 'transparent'
  }, [localMode, localFrom, localTo])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white text-gray-900 p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">Background</h3>
        <div className="space-y-4">
          <div className="h-24 rounded" style={{ background: preview }} />
          <div>
            <label className="block text-sm font-medium mb-2">Type</label>
            <select className="w-full px-3 py-2 border rounded" value={localMode} onChange={(e) => setLocalMode(e.target.value as any)}>
              <option value="none">No background</option>
              <option value="solid">Solid</option>
              <option value="linear">Linear gradient</option>
              <option value="radial">Radial gradient</option>
              <option value="zigzag">Zigzag gradient</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">From Color</label>
            <input 
              type="color" 
              value={localFrom}
              onChange={(e) => setLocalFrom(e.target.value)}
              className="w-full h-10 border rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">To Color</label>
            <input 
              type="color" 
              value={localTo}
              onChange={(e) => setLocalTo(e.target.value)}
              className="w-full h-10 border rounded"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button 
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button 
            onClick={() => {
              if (localMode === 'none') onSave({ mode: 'none', from: 'transparent', to: 'transparent' })
              else if (localMode === 'solid') onSave({ mode: 'solid', from: localFrom, to: localFrom })
              else if (localMode === 'linear') onSave({ mode: 'linear', from: localFrom, to: localTo })
              else if (localMode === 'radial') onSave({ mode: 'radial', from: localFrom, to: localTo })
              else if (localMode === 'zigzag') onSave({ mode: 'zigzag', from: localFrom, to: localTo })
            }}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

