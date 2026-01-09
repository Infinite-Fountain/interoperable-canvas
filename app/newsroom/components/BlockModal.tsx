'use client'

import React, { useState, useEffect, useRef } from 'react'
import { getFirestore, doc, setDoc, getDoc, collection, serverTimestamp, getDocs } from 'firebase/firestore'

type Props = {
  open: boolean
  onClose: () => void
  blockId: string | null
  pageId: string
  projectId: string
  onSave: () => void
  onGeneralTableCreated?: (blockId: string) => void
  onFinalViewCreated?: (blockId: string) => void
  onKarmaGeneralTableCreated?: (blockId: string) => void
  onKarmaSerpentineCreated?: (blockId: string) => void
}

interface ParsedGardensUrl {
  chainId: number
  address1: string
  address2: string
  poolId: number
}

const db = getFirestore()

export function BlockModal({ open, onClose, blockId, pageId, projectId, onSave, onGeneralTableCreated, onFinalViewCreated, onKarmaGeneralTableCreated, onKarmaSerpentineCreated }: Props) {
  const [blockType, setBlockType] = useState<string>('')
  const [gardensSubtype, setGardensSubtype] = useState<string>('')
  const [karmaSubtype, setKarmaSubtype] = useState<string>('')
  const [gardensUrl, setGardensUrl] = useState('')
  const [karmaProjectSlugs, setKarmaProjectSlugs] = useState<string[]>(['', '', '', '', ''])
  const [slugValidationStatus, setSlugValidationStatus] = useState<Record<number, 'validating' | 'valid' | 'invalid' | null>>({})
  const [parsedUrl, setParsedUrl] = useState<ParsedGardensUrl | null>(null)
  const [detectedNetwork, setDetectedNetwork] = useState<{ chainId: number; name: string; queryUrl?: string } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queryResult, setQueryResult] = useState<{ success: boolean; data?: any; error?: string; query?: string } | null>(null)

  // Load existing block data if editing
  useEffect(() => {
    if (open && blockId) {
      const loadBlock = async () => {
        try {
          const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockId)
          const blockSnap = await getDoc(blockRef)
          if (blockSnap.exists()) {
            const data = blockSnap.data()
            setBlockType(data['block-type'] || '')
            setGardensSubtype(data['gardens-subtype'] || '')
            setKarmaSubtype(data['karma-subtype'] || '')
            setGardensUrl(data['gardens-url'] || '')
            const slugs = data['karma-project-slugs'] || []
            // Ensure we have at least 5 slots, pad with empty strings if needed
            setKarmaProjectSlugs([...slugs, ...Array(Math.max(0, 5 - slugs.length)).fill('')])
            setParsedUrl(data['parsed-url'] || null)
            setDetectedNetwork(data['detected-network'] || null)
          }
        } catch (err) {
          console.error('Error loading block:', err)
        }
      }
      loadBlock()
    } else if (open && !blockId) {
      // Reset for new block
      setBlockType('')
      setGardensSubtype('')
      setKarmaSubtype('')
      setGardensUrl('')
      setKarmaProjectSlugs(['', '', '', '', ''])
      setSlugValidationStatus({})
      setParsedUrl(null)
      setDetectedNetwork(null)
      setQueryResult(null)
      setError(null)
    }
  }, [open, blockId, pageId, projectId])

  // Generate block slug from subtype
  const generateBlockSlug = (subtype: string): string => {
    return subtype.toLowerCase().replace(/_/g, '-')
  }

  // Find unique block slug (append number if needed)
  const findUniqueBlockSlug = async (baseSlug: string): Promise<string> => {
    const blocksRef = collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks')
    const blocksSnap = await getDocs(blocksRef)
    
    const existingSlugs = new Set<string>()
    blocksSnap.forEach((doc) => {
      if (doc.id !== blockId) { // Exclude current block if editing
        existingSlugs.add(doc.id)
      }
    })

    let slug = baseSlug
    let counter = 1
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    return slug
  }

  // Auto-open GeneralTableModal when "general-table" is selected
  useEffect(() => {
    if (open && !blockId && blockType === 'gardens-report' && gardensSubtype === 'general-table' && onGeneralTableCreated) {
      const openGeneralTableModal = async () => {
        try {
          const baseSlug = generateBlockSlug(gardensSubtype)
          const blockSlug = await findUniqueBlockSlug(baseSlug)
          onGeneralTableCreated(blockSlug)
          // Close BlockModal after opening GeneralTableModal
          onClose()
        } catch (err) {
          console.error('Error opening GeneralTableModal:', err)
        }
      }
      openGeneralTableModal()
    }
  }, [open, blockId, blockType, gardensSubtype, onGeneralTableCreated, onClose, pageId, projectId])

  // Auto-open FinalViewModal when "final-view" is selected
  useEffect(() => {
    if (open && !blockId && blockType === 'gardens-report' && gardensSubtype === 'final-view' && onFinalViewCreated) {
      const openFinalViewModal = async () => {
        try {
          const baseSlug = generateBlockSlug(gardensSubtype)
          const blockSlug = await findUniqueBlockSlug(baseSlug)
          onFinalViewCreated(blockSlug)
          // Close BlockModal after opening FinalViewModal
          onClose()
        } catch (err) {
          console.error('Error opening FinalViewModal:', err)
        }
      }
      openFinalViewModal()
    }
  }, [open, blockId, blockType, gardensSubtype, onFinalViewCreated, onClose, pageId, projectId])

  // Auto-open KarmaGeneralTableModal when "karma-general-table" is selected
  useEffect(() => {
    if (open && !blockId && blockType === 'karma-report' && karmaSubtype === 'karma-general-table' && onKarmaGeneralTableCreated) {
      const openKarmaGeneralTableModal = async () => {
        try {
          const baseSlug = generateBlockSlug(karmaSubtype)
          const blockSlug = await findUniqueBlockSlug(baseSlug)
          onKarmaGeneralTableCreated(blockSlug)
          // Close BlockModal after opening KarmaGeneralTableModal
          onClose()
        } catch (err) {
          console.error('Error opening KarmaGeneralTableModal:', err)
        }
      }
      openKarmaGeneralTableModal()
    }
  }, [open, blockId, blockType, karmaSubtype, onKarmaGeneralTableCreated, onClose, pageId, projectId])

  // Auto-open KarmaSerpentineModal when "karma-serpentine" is selected
  useEffect(() => {
    if (open && !blockId && blockType === 'karma-report' && karmaSubtype === 'karma-serpentine' && onKarmaSerpentineCreated) {
      const openKarmaSerpentineModal = async () => {
        try {
          const baseSlug = generateBlockSlug(karmaSubtype)
          const blockSlug = await findUniqueBlockSlug(baseSlug)
          onKarmaSerpentineCreated(blockSlug)
          // Close BlockModal after opening KarmaSerpentineModal
          onClose()
        } catch (err) {
          console.error('Error opening KarmaSerpentineModal:', err)
        }
      }
      openKarmaSerpentineModal()
    }
  }, [open, blockId, blockType, karmaSubtype, onKarmaSerpentineCreated, onClose, pageId, projectId])

  // Parse Gardens URL
  const parseGardensUrl = (url: string): { parsed: ParsedGardensUrl | null; error: string | null } => {
    try {
      const urlObj = new URL(url)
      
      if (!urlObj.hostname.includes('gardens.fund')) {
        return { parsed: null, error: 'Invalid domain. URL must be from app.gardens.fund' }
      }

      const pathParts = urlObj.pathname.split('/').filter(Boolean)
      
      if (pathParts.length < 4 || pathParts[0] !== 'gardens') {
        return { parsed: null, error: 'Invalid URL format. Expected: /gardens/{chainId}/{address1}/{address2}/{poolId}' }
      }

      const chainId = parseInt(pathParts[1], 10)
      const address1 = pathParts[2]
      const address2 = pathParts[3]
      const poolId = parseInt(pathParts[4], 10)

      if (isNaN(chainId) || chainId <= 0) {
        return { parsed: null, error: 'Invalid chain ID. Must be a positive number.' }
      }

      const hexAddressRegex = /^0x[a-fA-F0-9]{40}$/
      if (!hexAddressRegex.test(address1)) {
        return { parsed: null, error: 'Invalid address1 format. Must be a valid hex address (0x + 40 characters).' }
      }
      if (!hexAddressRegex.test(address2)) {
        return { parsed: null, error: 'Invalid address2 format. Must be a valid hex address (0x + 40 characters).' }
      }

      if (isNaN(poolId) || poolId <= 0) {
        return { parsed: null, error: 'Invalid pool ID. Must be a positive number.' }
      }

      return {
        parsed: { chainId, address1, address2, poolId },
        error: null
      }
    } catch (err) {
      return { parsed: null, error: `Invalid URL: ${err instanceof Error ? err.message : 'Unknown error'}` }
    }
  }

  // Get network info
  const getNetworkInfo = (chainId: number): { name: string; queryUrl?: string } => {
    const networkMap: Record<number, { name: string; queryUrl?: string }> = {
      10: {
        name: 'Optimism',
        queryUrl: 'https://gateway.thegraph.com/api/{apiKey}/subgraphs/id/FmcVWeR9xdJyjM53DPuCvEdH24fSXARdq4K5K8EZRZVp',
      },
    }
    
    return networkMap[chainId] || {
      name: `Chain ${chainId}`,
      queryUrl: undefined
    }
  }

  // Handle URL input change
  const handleUrlChange = (url: string) => {
    setGardensUrl(url)
    setError(null)
    
    if (url.trim()) {
      const parsed = parseGardensUrl(url.trim())
      if (parsed.parsed) {
        setParsedUrl(parsed.parsed)
        const networkInfo = getNetworkInfo(parsed.parsed.chainId)
        const apiKey = process.env.NEXT_PUBLIC_SUBGRAPH_KEY || ''
        const queryUrl = networkInfo.queryUrl?.replace('{apiKey}', apiKey) || undefined
        setDetectedNetwork({
          chainId: parsed.parsed.chainId,
          name: networkInfo.name,
          queryUrl: queryUrl
        })
      } else {
        setParsedUrl(null)
        setDetectedNetwork(null)
        if (parsed.error) {
          setError(parsed.error)
        }
      }
    } else {
      setParsedUrl(null)
      setDetectedNetwork(null)
    }
  }

  // Test GraphQL query
  const testGraphQLQuery = async (url: string, query: string) => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query
        })
      })

      const result = await response.json()
      
      return {
        success: response.ok && !result.errors && !result.message,
        data: result,
        error: result.errors ? JSON.stringify(result.errors, null, 2) : result.message ? `Message: ${result.message}` : undefined,
        query: query
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        query: query
      }
    }
  }

  // Test Karma API query (for validation)
  const testKarmaQuery = async (slug: string) => {
    try {
      const apiUrl = `https://gapapi.karmahq.xyz/v2/projects/${slug}/updates`
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })

      const result = await response.json()
      
      return {
        success: response.ok && !result.error,
        data: result,
        error: result.error ? JSON.stringify(result.error, null, 2) : response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  // Validate slug in real-time
  const validateSlug = async (slug: string, index: number) => {
    if (!slug.trim()) {
      setSlugValidationStatus(prev => {
        const newStatus = { ...prev }
        delete newStatus[index]
        return newStatus
      })
      return
    }

    setSlugValidationStatus(prev => ({ ...prev, [index]: 'validating' }))
    
    const result = await testKarmaQuery(slug.trim())
    
    setSlugValidationStatus(prev => ({
      ...prev,
      [index]: result.success ? 'valid' : 'invalid'
    }))
  }

  // Debounced validation
  const validationTimeouts = useRef<Record<number, NodeJS.Timeout>>({})
  
  const handleSlugChange = (index: number, value: string) => {
    const newSlugs = [...karmaProjectSlugs]
    newSlugs[index] = value
    setKarmaProjectSlugs(newSlugs)
    setError(null)

    // Clear existing timeout
    if (validationTimeouts.current[index]) {
      clearTimeout(validationTimeouts.current[index])
    }

    // Set new timeout for validation
    if (value.trim()) {
      validationTimeouts.current[index] = setTimeout(() => {
        validateSlug(value, index)
      }, 500) // Wait 500ms after user stops typing
    } else {
      setSlugValidationStatus(prev => {
        const newStatus = { ...prev }
        delete newStatus[index]
        return newStatus
      })
    }
  }

  // Add more rows
  const addMoreRows = () => {
    setKarmaProjectSlugs([...karmaProjectSlugs, '', '', '']) // Add 2 more rows
  }

  // Handle submit
  const handleSubmit = async () => {
    if (!blockType) {
      setError('Please select a block type')
      return
    }

    if (blockType === 'gardens-report' && gardensSubtype === 'query-subgraph') {
      if (!parsedUrl) {
        setError('Please enter a valid Gardens URL')
        return
      }

      setIsSubmitting(true)
      setError(null)

      try {
        const apiKey = process.env.NEXT_PUBLIC_SUBGRAPH_KEY || ''
        if (!apiKey) {
          throw new Error('API key not found. Add NEXT_PUBLIC_SUBGRAPH_KEY to .env.local')
        }

        const subgraphId = 'FmcVWeR9xdJyjM53DPuCvEdH24fSXARdq4K5K8EZRZVp'
        const subgraphUrl = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`

        const test4Query = `{ cvproposals(where: { strategy_: { poolId: "${parsedUrl.poolId}" }, proposalStatus: 4 }) { id proposalNumber proposalStatus requestedAmount createdAt metadataHash metadata { title description } strategy { id poolId token } } }`
        const result = await testGraphQLQuery(subgraphUrl, test4Query)
        setQueryResult(result)

        if (!result.success) {
          setError(result.error || 'Failed to query subgraph')
          setIsSubmitting(false)
          return
        }

        // Generate block slug
        const baseSlug = generateBlockSlug(gardensSubtype)
        const blockSlug = blockId ? blockId : await findUniqueBlockSlug(baseSlug)

        // Save block with slug as document ID
        const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug)

        const blockData = {
          pageId,
          'block-type': blockType.replace(/_/g, '-'),
          'gardens-subtype': gardensSubtype.replace(/_/g, '-'),
          'gardens-url': gardensUrl,
          'parsed-url': parsedUrl,
          'detected-network': detectedNetwork,
          'query-url': detectedNetwork?.queryUrl,
          'filter-info': `Filter by PoolId (Pool ${parsedUrl.poolId}) and proposalStatus = 4`,
          query: test4Query,
          status: 'ready',
          createdAt: blockId ? undefined : serverTimestamp(),
          updatedAt: serverTimestamp(),
        }

        await setDoc(blockRef, blockData, { merge: true })

        // Save query result to subcollection
        const queryResultRef = doc(collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug, 'query-results'))
        const queryResultData: any = {
          success: result.success,
          data: result.data,
          query: result.query,
          queriedAt: serverTimestamp(),
        }
        // Only include error if it exists (Firestore doesn't allow undefined)
        if (result.error) {
          queryResultData.error = result.error
        }
        await setDoc(queryResultRef, queryResultData)

        onSave()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsSubmitting(false)
      }
    } else if (blockType === 'gardens-report' && gardensSubtype === 'fill-with-ai-config') {
      // For fill-with-ai-config, just save the block and close modal
      // The block component will handle its own UI
      setIsSubmitting(true)
      setError(null)

      try {
        // Generate block slug
        const baseSlug = generateBlockSlug(gardensSubtype)
        const blockSlug = blockId ? blockId : await findUniqueBlockSlug(baseSlug)

        // Save block with slug as document ID
        const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug)

        const blockData = {
          pageId,
          'block-type': blockType.replace(/_/g, '-'),
          'gardens-subtype': gardensSubtype.replace(/_/g, '-'),
          status: 'ready',
          createdAt: blockId ? undefined : serverTimestamp(),
          updatedAt: serverTimestamp(),
        }

        await setDoc(blockRef, blockData, { merge: true })

        // Create default config in subcollection
        const defaultConfig = {
          agent: 'openai',
          model: 'gpt-5.1',
          temperature: 0.7,
          reasoning: {
            effort: 'medium'
          },
          task: 'Extract summary and links from proposal description',
          instructions: {
            summary: {
              required: true,
              description: 'Extract a concise summary focusing only on the main problem being solved and the solution',
              prefix: 'AI Summary: ',
              wordCount: {
                min: 40,
                max: 50
              },
              focus: ['problem', 'solution']
            },
            github: {
              required: true,
              description: 'Extract GitHub repository link if available in the description'
            },
            karmaProfile: {
              required: true,
              description: 'Extract Karma GAP profile link if available in the description'
            }
          },
          outputFormat: 'json',
          outputDestination: {
            type: 'return'
          }
        }

        // Use fixed document ID 'config' to always update the same document
        const configRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug, 'agent-config', 'config')
        await setDoc(configRef, {
          config: defaultConfig,
          lastSavedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })

        onSave()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsSubmitting(false)
      }
    } else if (blockType === 'gardens-report' && gardensSubtype === 'general-table') {
      // For general-table, don't save yet - just open GeneralTableModal
      // The GeneralTableModal will handle saving after configuration
      if (!blockId && onGeneralTableCreated) {
        // Generate a temporary block slug for the modal
        const baseSlug = generateBlockSlug(gardensSubtype)
        const blockSlug = await findUniqueBlockSlug(baseSlug)
        onGeneralTableCreated(blockSlug)
      }
      // Don't close BlockModal yet - let GeneralTableModal handle it
      // But we can close it since GeneralTableModal will open
      onClose()
    } else if (blockType === 'gardens-report' && gardensSubtype === 'final-view') {
      // For final-view, don't save yet - just open FinalViewModal
      // The FinalViewModal will handle saving after configuration
      if (!blockId && onFinalViewCreated) {
        // Generate a temporary block slug for the modal
        const baseSlug = generateBlockSlug(gardensSubtype)
        const blockSlug = await findUniqueBlockSlug(baseSlug)
        onFinalViewCreated(blockSlug)
      }
      onClose()
    } else if (blockType === 'karma-report' && karmaSubtype === 'karma-query') {
      // Filter out empty slugs
      const validSlugs = karmaProjectSlugs.filter(slug => slug.trim() !== '')
      
      if (validSlugs.length === 0) {
        setError('Please enter at least one project slug')
        return
      }

      setIsSubmitting(true)
      setError(null)

      try {
        // Query all slugs and group results by slug
        const groupedData: Record<string, any> = {}
        let allSuccess = true
        const errors: string[] = []

        for (const slug of validSlugs) {
          const result = await testKarmaQuery(slug.trim())
          if (result.success) {
            groupedData[slug.trim()] = result.data
          } else {
            allSuccess = false
            errors.push(`${slug}: ${result.error || 'Failed to query'}`)
            // Still store empty array for failed slugs so we know they were attempted
            groupedData[slug.trim()] = []
          }
        }

        // Generate block slug
        const baseSlug = generateBlockSlug(karmaSubtype)
        const blockSlug = blockId ? blockId : await findUniqueBlockSlug(baseSlug)

        // Save block with slug as document ID
        const blockRef = doc(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug)

        const blockData = {
          pageId,
          'block-type': blockType.replace(/_/g, '-'),
          'karma-subtype': karmaSubtype.replace(/_/g, '-'),
          'karma-project-slugs': validSlugs.map(s => s.trim()),
          status: 'ready',
          createdAt: blockId ? undefined : serverTimestamp(),
          updatedAt: serverTimestamp(),
        }

        await setDoc(blockRef, blockData, { merge: true })

        // Save query result to subcollection with grouped data
        const queryResultRef = doc(collection(db, 'newsroom', projectId, 'folders', pageId, 'blocks', blockSlug, 'query-results'))
        const queryResultData: any = {
          success: allSuccess,
          data: groupedData,
          queriedAt: serverTimestamp(),
        }
        // Only include error if it exists (Firestore doesn't allow undefined)
        if (errors.length > 0) {
          queryResultData.error = errors.join('\n')
        }
        await setDoc(queryResultRef, queryResultData)

        onSave()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              {blockId ? 'Edit Block' : 'Create Block'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Block Type Dropdown */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Block Type
            </label>
            <select
              value={blockType}
              onChange={(e) => {
                setBlockType(e.target.value)
                setGardensSubtype('')
                setKarmaSubtype('')
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
            >
              <option value="" className="text-gray-900">Select block type...</option>
              <option value="gardens-report" className="text-gray-900">Gardens Report</option>
              <option value="karma-report" className="text-gray-900">Karma Report</option>
            </select>
          </div>

          {/* Gardens Subtype Dropdown */}
          {blockType === 'gardens-report' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gardens Report Type
              </label>
              <select
                value={gardensSubtype}
                onChange={(e) => setGardensSubtype(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              >
                <option value="" className="text-gray-900">Select type...</option>
                <option value="query-subgraph" className="text-gray-900">Query Subgraph</option>
                <option value="fill-with-ai-config" className="text-gray-900">Fill with AI Config</option>
                <option value="general-table" className="text-gray-900">General Table</option>
                <option value="final-view" className="text-gray-900">Final View</option>
              </select>
            </div>
          )}

          {/* Karma Subtype Dropdown */}
          {blockType === 'karma-report' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Karma Report Type
              </label>
              <select
                value={karmaSubtype}
                onChange={(e) => setKarmaSubtype(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              >
                <option value="" className="text-gray-900">Select type...</option>
                <option value="karma-query" className="text-gray-900">Karma Query</option>
                <option value="karma-general-table" className="text-gray-900">Karma General Table</option>
                <option value="karma-serpentine" className="text-gray-900">Karma Serpentine</option>
              </select>
            </div>
          )}

          {/* Project Slug Inputs for Karma Query */}
          {blockType === 'karma-report' && karmaSubtype === 'karma-query' && (
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-3">
                Add all the different project slugs associated
              </p>
              <div className="space-y-2">
                {karmaProjectSlugs.map((slug, index) => {
                  const validationStatus = slugValidationStatus[index]
                  return (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={slug}
                        onChange={(e) => handleSlugChange(index, e.target.value)}
                        placeholder={`Project slug ${index + 1}`}
                        className={`flex-1 px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white placeholder:text-gray-500 ${
                          validationStatus === 'valid' ? 'border-green-500' : 
                          validationStatus === 'invalid' ? 'border-red-500' : 
                          'border-gray-300'
                        }`}
                      />
                      {validationStatus === 'validating' && (
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      )}
                      {validationStatus === 'valid' && (
                        <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {validationStatus === 'invalid' && (
                        <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={addMoreRows}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                + Add more rows
              </button>
            </div>
          )}

          {/* URL Input for Query Subgraph */}
          {blockType === 'gardens-report' && gardensSubtype === 'query-subgraph' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gardens Pool URL
              </label>
              <input
                type="text"
                value={gardensUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://app.gardens.fund/gardens/10/0xda10009cbd5d07dd0cecc66161fc93d7c9000da1/0xd95bf6da95c77466674bd1210e77a23492f6eef9/179"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white placeholder:text-gray-500"
              />
              {detectedNetwork && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-gray-600">
                    <span className="font-medium">Detected network:</span> {detectedNetwork.name}
                  </p>
                  {detectedNetwork.queryUrl && (
                    <div>
                      <p className="text-xs font-medium text-gray-900 mb-1">Query URL:</p>
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded border block break-all text-gray-900">
                        {detectedNetwork.queryUrl}
                      </code>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Query Result Preview */}
          {queryResult && (
            <div className={`mb-4 p-4 border rounded-md ${queryResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="font-semibold mb-2 text-gray-900">
                Query Result {queryResult.success ? '✓' : '✗'}
              </div>
              {queryResult.data && (
                <div className="text-sm">
                  <span className="font-medium">Response:</span>
                  <pre className="mt-1 p-2 bg-white border rounded text-xs overflow-auto max-h-40">
                    {JSON.stringify(queryResult.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={
                isSubmitting || 
                !blockType || 
                (blockType === 'gardens-report' && gardensSubtype === 'query-subgraph' && !parsedUrl) ||
                (blockType === 'gardens-report' && gardensSubtype === 'general-table') ||
                (blockType === 'gardens-report' && gardensSubtype === 'final-view') ||
                (blockType === 'karma-report' && karmaSubtype === 'karma-query' && karmaProjectSlugs.filter(s => s.trim() !== '').length === 0) ||
                (blockType === 'karma-report' && karmaSubtype === 'karma-general-table') ||
                (blockType === 'karma-report' && karmaSubtype === 'karma-serpentine')
              }
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

