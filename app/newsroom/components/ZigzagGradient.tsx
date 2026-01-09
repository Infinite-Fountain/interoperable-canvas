'use client'

import React, { useEffect, useRef, useState } from 'react'

interface ZigzagGradientProps {
  from: string
  to: string
  className?: string
  style?: React.CSSProperties
}

/**
 * ZigzagGradient component that creates alternating linear gradients
 * Each gradient covers 2 viewport heights (200vh)
 * Within each segment:
 * - Starts with first color (from)
 * - At 1x viewportHeight: fully second color (to)
 * - At 2x viewportHeight: returns to first color (from)
 * - Gradient 1: Diagonal (Upper left → Lower right)
 * - Gradient 2: Diagonal inverted horizontally (Upper right → Lower left)
 * - Gradient 3: Diagonal (Upper left → Lower right)
 * Pattern repeats as content height increases
 */
export function ZigzagGradient({ from, to, className = '', style = {} }: ZigzagGradientProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [segments, setSegments] = useState(1) // Start with at least 1 segment
  const [viewportHeight, setViewportHeight] = useState(() => 
    typeof window !== 'undefined' ? window.innerHeight : 800
  )

  // Update viewport height on resize
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => {
      setViewportHeight(window.innerHeight)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Calculate how many segments we need based on container height
  useEffect(() => {
    if (!containerRef.current) return
    
    const updateSegments = () => {
      const container = containerRef.current
      if (!container) return
      
      // Get the actual height of the container's parent (the canvas container)
      // This ensures we cover the full canvas height, including dynamic heights
      const parent = container.parentElement
      const containerHeight = parent 
        ? Math.max(parent.scrollHeight, parent.clientHeight, container.scrollHeight, container.clientHeight)
        : Math.max(container.scrollHeight, container.clientHeight, viewportHeight)
      
      // Each segment is 2 viewport heights (200vh)
      const segmentHeight = viewportHeight * 2
      
      // Calculate how many segments we need (always at least 1, add extra for safety)
      const neededSegments = Math.ceil(containerHeight / segmentHeight) + 1
      
      setSegments(Math.max(1, neededSegments))
    }

    // Initial calculation with a small delay to ensure DOM is ready
    const timeoutId = setTimeout(updateSegments, 0)

    // Use ResizeObserver to watch for height changes on both container and parent
    const resizeObserver = new ResizeObserver(updateSegments)
    resizeObserver.observe(containerRef.current)
    
    if (containerRef.current.parentElement) {
      resizeObserver.observe(containerRef.current.parentElement)
    }

    return () => {
      clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [viewportHeight])

  return (
    <div 
      ref={containerRef}
      className={`absolute inset-0 w-full ${className}`}
      style={{ ...style, zIndex: 0, pointerEvents: 'none' }}
    >
      {Array.from({ length: segments }).map((_, index) => {
        const isEven = index % 2 === 0
        const top = index * viewportHeight * 2
        const height = viewportHeight * 2
        
        // Gradient transitions: from → to (at 50% = 1vh) → from (at 100% = 2vh)
        const gradientStops = `${from} 0%, ${to} 50%, ${from} 100%`
        
        return (
          <div
            key={index}
            className="absolute left-0 right-0"
            style={{
              top: `${top}px`,
              height: `${height}px`,
              width: '100%',
              background: isEven
                ? `linear-gradient(135deg, ${gradientStops})` // Diagonal: Upper left → Lower right
                : `linear-gradient(225deg, ${gradientStops})`, // Diagonal inverted: Upper right → Lower left
              zIndex: 0,
              pointerEvents: 'none',
            }}
          />
        )
      })}
    </div>
  )
}

