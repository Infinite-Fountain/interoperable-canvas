'use client'

import React, { useState, useEffect, useRef } from 'react'
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit, serverTimestamp, where } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { initializeApp, getApps } from 'firebase/app'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

interface GeneralTableBlockProps {
  blockId: string
  projectId: string
  folderId: string
  onEditClick?: () => void
}

interface GardensProposal {
  id: string
  proposalNumber: number
  title?: string
  description?: string
  requestedAmount: string
  tokenSymbol?: string
  tokenAddress?: string
  executionStatus: string
  createdAt: string
  metadataHash?: string
  status?: 'success' | 'ipfs_failed' | 'subgraph_failed'
  error?: string
  summary?: string
  github?: string | null
  karmaProfile?: string | null
  proposalUrl?: string
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig as any)
const db = getFirestore(app)
const functions = getFunctions(app)

// Minimal network info map for CoinGecko lookups
const getNetworkInfo = (chainId: number) => {
  const networkMap: Record<number, { coingeckoChainId?: string }> = {
    10: { coingeckoChainId: 'optimistic-ethereum' },
    // Extend if more networks are needed
  }
  return networkMap[chainId] || {}
}

const fetchTokenSymbolFromCoinGecko = async (tokenAddress: string, chainId?: number): Promise<string | null> => {
  if (!chainId) return null
  const networkInfo = getNetworkInfo(chainId)
  if (!networkInfo.coingeckoChainId) return null

  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/coins/${networkInfo.coingeckoChainId}/contract/${tokenAddress.toLowerCase()}`
    )
    if (!resp.ok) return null
    const data = await resp.json()
    return data.symbol?.toUpperCase() || null
  } catch (err) {
    console.warn('CoinGecko token symbol lookup failed', err)
    return null
  }
}

const fetchTokenSymbolFromSubgraph = async (tokenAddress: string, apiKey: string): Promise<string | null> => {
  try {
    const subgraphId = 'FmcVWeR9xdJyjM53DPuCvEdH24fSXARdq4K5K8EZRZVp'
    const subgraphUrl = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`
    const tokenQuery = `{ tokens(where: { id: "${tokenAddress}" }, first: 1) { id symbol name decimals } }`
    const resp = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: tokenQuery })
    })
    if (!resp.ok) return null
    const tokenResult = await resp.json()
    const symbol = tokenResult?.data?.tokens?.[0]?.symbol
    return symbol || null
  } catch (err) {
    console.warn('Subgraph token symbol lookup failed', err)
    return null
  }
}

export function GeneralTableBlock({ blockId, projectId, folderId, onEditClick }: GeneralTableBlockProps) {
  const [proposals, setProposals] = useState<GardensProposal[]>([])
  const proposalsRef = useRef<GardensProposal[]>([]) // Always has latest proposals for sync access
  const [proposalDescriptions, setProposalDescriptions] = useState<Record<string, string>>({})
  const [isFetchingDescriptions, setIsFetchingDescriptions] = useState(false)
  const [processingProposalId, setProcessingProposalId] = useState<string | null>(null)
  const [isFillingAll, setIsFillingAll] = useState(false)
  const [fillAllProgress, setFillAllProgress] = useState(0)
  const [showFillAllConfirm, setShowFillAllConfirm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasExistingData, setHasExistingData] = useState(false)
  
  const [sourceBlockId, setSourceBlockId] = useState<string>('')
  const [useAiConfig, setUseAiConfig] = useState<boolean>(false)
  const [includeSummary, setIncludeSummary] = useState<boolean>(false)
  const [includeGithub, setIncludeGithub] = useState<boolean>(false)
  const [includeKarma, setIncludeKarma] = useState<boolean>(false)
  const [aiConfig, setAiConfig] = useState<any>(null)
  const [confirmModal, setConfirmModal] = useState<{ show: boolean; proposal: GardensProposal | null }>({ show: false, proposal: null })

  // Keep proposalsRef in sync with proposals state
  useEffect(() => {
    proposalsRef.current = proposals
  }, [proposals])

  // Load block configuration and table data
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
        setUseAiConfig(blockData['use-ai-config'] || false)
        setIncludeSummary(blockData['include-summary'] || false)
        setIncludeGithub(blockData['include-github'] || false)
        setIncludeKarma(blockData['include-karma'] || false)

        // Load AI config if enabled - find fill-with-ai-config block in same folder
        if (blockData['use-ai-config']) {
          try {
            // Find the fill-with-ai-config block in the same folder
            const blocksRef = collection(db, 'newsroom', projectId, 'folders', folderId, 'blocks')
            const blocksQuery = query(
              blocksRef,
              where('block-type', '==', 'gardens-report'),
              where('gardens-subtype', '==', 'fill-with-ai-config')
            )
            const blocksSnap = await getDocs(blocksQuery)
            
            let aiConfigBlockId: string | null = null
            if (!blocksSnap.empty) {
              // Use the first matching block
              aiConfigBlockId = blocksSnap.docs[0].id
            }
            
            if (aiConfigBlockId) {
              const aiConfigRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', aiConfigBlockId, 'agent-config', 'config')
              const aiConfigSnap = await getDoc(aiConfigRef)
              if (aiConfigSnap.exists()) {
                const rawConfig = aiConfigSnap.data()
                // Some configs are nested under config.config
                const resolvedConfig = rawConfig?.config?.config ?? rawConfig?.config ?? rawConfig
                setAiConfig(resolvedConfig)
              } else {
                console.warn('AI config doc not found at expected path:', aiConfigRef.path)
              }
            } else {
              console.warn('No fill-with-ai-config block found in folder')
            }
          } catch (err) {
            console.error('Error loading AI config:', err)
          }
        }

        // Try to load existing table-data first
        const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'general-table')
        const tableDataSnap = await getDoc(tableDataRef)
        
        if (tableDataSnap.exists()) {
          const tableData = tableDataSnap.data()
            if (tableData.proposals && Array.isArray(tableData.proposals) && tableData.proposals.length > 0) {
              // Load existing proposals (preserves AI-filled data)
              // Remove description fields if they exist (descriptions should only live in query-subgraph)
              const cleanedProposals = tableData.proposals.map((p: any) => {
                const cleaned = { ...p }
                delete cleaned.description
                return cleaned
              })
              setProposals(cleanedProposals as GardensProposal[])
              setHasExistingData(true)
              // Load cached descriptions if available (but they should come from query-subgraph)
              if (tableData.proposalDescriptions) {
                setProposalDescriptions(tableData.proposalDescriptions)
              }
              setLoading(false)
              return
            }
        }
        setHasExistingData(false)

        // No existing data - generate from source block
        if (blockData['source-block-id']) {
          await generateTableFromSource(blockData['source-block-id'])
        } else {
          // No source block configured yet
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

  // Refresh table data by merging with existing data (preserves AI-filled fields)
  const refreshTableData = async () => {
    if (!sourceBlockId) {
      setError('No source block configured')
      return
    }

    setIsRefreshing(true)
    setError(null)

    try {
      await generateTableFromSource(sourceBlockId, true) // true = merge mode
    } catch (err) {
      console.error('Error refreshing table:', err)
      setError(err instanceof Error ? err.message : 'Failed to refresh table')
    } finally {
      setIsRefreshing(false)
    }
  }

  // Generate table from source block query results
  const generateTableFromSource = async (sourceBlockIdParam: string, mergeMode: boolean = false) => {
    if (!sourceBlockIdParam) {
      setError('No source block ID provided')
      setLoading(false)
      return
    }

    // Load parsed-url from source block for building proposal URLs
    let parsedUrl: { chainId?: number; address1?: string; address2?: string; poolId?: number } | null = null
    try {
      const sourceBlockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', sourceBlockIdParam)
      const sourceBlockSnap = await getDoc(sourceBlockRef)
      parsedUrl = sourceBlockSnap.data()?.['parsed-url'] || null
    } catch (err) {
      console.warn('Could not load source block for parsed-url', err)
    }

    // Helper function to build proposal URL from parsed-url and proposal ID
    const buildProposalUrl = (proposalId: string): string | null => {
      if (!proposalId || !parsedUrl) return null
      const { chainId, address1, address2, poolId } = parsedUrl
      if (!chainId || !address1 || !address2 || !poolId) return null
      return `https://app.gardens.fund/gardens/${chainId}/${address1}/${address2}/${poolId}/${proposalId}`
    }

    // Resolve token info (address + symbol) from source block + subgraph, once per generation
    const resolveTokenInfo = async (proposalsData: any[]): Promise<{ tokenAddress: string | null; tokenSymbol: string | null }> => {
      const tokenAddress =
        proposalsData[0]?.strategy?.token?.address ||
        proposalsData[0]?.strategy?.token ||
        null

      // Reuse any existing symbol already in state (e.g., from cached table-data)
      let tokenSymbol: string | null = proposals[0]?.tokenSymbol || null

      if (tokenSymbol || !tokenAddress) {
        return { tokenAddress, tokenSymbol }
      }

      // Fetch parsed-url for chainId
      let chainId: number | undefined = undefined
      try {
        const sourceBlockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', sourceBlockIdParam)
        const sourceBlockSnap = await getDoc(sourceBlockRef)
        const parsedUrl = sourceBlockSnap.data()?.['parsed-url']
        chainId = parsedUrl?.chainId
      } catch (err) {
        console.warn('Could not load source block for chainId', err)
      }

      // Try CoinGecko, then subgraph
      tokenSymbol = await fetchTokenSymbolFromCoinGecko(tokenAddress, chainId)
      if (!tokenSymbol) {
        const apiKey = process.env.NEXT_PUBLIC_SUBGRAPH_KEY || ''
        if (apiKey) {
          tokenSymbol = await fetchTokenSymbolFromSubgraph(tokenAddress, apiKey)
        }
      }

      return { tokenAddress, tokenSymbol }
    }

    try {
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
        
        const latestResult = allDocs[0]
        const resultData = latestResult.data
        
        if (!resultData.success) {
          setError('Query was not successful')
          console.error('Query failed:', resultData.error)
          setLoading(false)
          return
        }

        // Navigate through the nested data structure
        const proposalsData = resultData.data?.data?.cvproposals || resultData.data?.cvproposals
        
        if (!proposalsData || !Array.isArray(proposalsData)) {
          setError('Invalid query results structure in source block')
          console.error('Invalid result data:', resultData)
          setLoading(false)
          return
        }

        // Transform proposals from query result - only include fields needed for the table
        const { tokenAddress, tokenSymbol } = await resolveTokenInfo(proposalsData)

        // If merge mode, create a map of existing proposals by ID to preserve AI fields
        const existingProposalsMap = new Map<string, GardensProposal>()
        if (mergeMode && proposals.length > 0) {
          proposals.forEach(p => {
            if (p.id) {
              existingProposalsMap.set(p.id, p)
            }
          })
        }

        const transformedProposals: GardensProposal[] = proposalsData.map((p: any) => {
          // Handle proposalStatus as number or string
          const proposalStatus = typeof p.proposalStatus === 'string' 
            ? parseInt(p.proposalStatus) 
            : p.proposalStatus
          
          let executionStatus = 'failed'
          if (proposalStatus === 4) {
            executionStatus = 'executed'
          } else if (proposalStatus === 0) {
            executionStatus = 'pending'
          }

          const proposalId = p.id || ''
          const existingProposal = mergeMode ? existingProposalsMap.get(proposalId) : null

          const proposal: any = {
            id: proposalId,
            proposalNumber: p.proposalNumber || 0,
            title: p.metadata?.title || null,
            // Don't include description - it should only live in query-subgraph
            requestedAmount: p.requestedAmount || '0',
            tokenSymbol: tokenSymbol || null,
            tokenAddress: tokenAddress || null,
            executionStatus: executionStatus,
            createdAt: p.createdAt ? new Date(parseInt(p.createdAt) * 1000).toISOString() : '',
            metadataHash: p.metadataHash || null,
            proposalUrl: buildProposalUrl(proposalId),
            // In merge mode, preserve AI fields from existing proposal; otherwise initialize as null
            summary: mergeMode && existingProposal?.summary ? existingProposal.summary : null,
            github: mergeMode && existingProposal?.github ? existingProposal.github : null,
            karmaProfile: mergeMode && existingProposal?.karmaProfile ? existingProposal.karmaProfile : null,
          }
          
          // Remove undefined values (Firestore doesn't allow undefined)
          Object.keys(proposal).forEach(key => {
            if (proposal[key] === undefined) {
              delete proposal[key]
            }
          })
          
          // Ensure AI fields are always present (even if null) for consistency
          if (!('summary' in proposal)) proposal.summary = null
          if (!('github' in proposal)) proposal.github = null
          if (!('karmaProfile' in proposal)) proposal.karmaProfile = null
          
          return proposal as GardensProposal
        })

        // In merge mode, add any existing proposals that weren't in the new data
        let finalProposals = transformedProposals
        if (mergeMode && existingProposalsMap.size > 0) {
          const newProposalIds = new Set(transformedProposals.map(p => p.id))
          const missingProposals = Array.from(existingProposalsMap.values()).filter(
            p => p.id && !newProposalIds.has(p.id)
          )
          finalProposals = [...transformedProposals, ...missingProposals]
        }

        setProposals(finalProposals)
        if (finalProposals.length > 0) {
          setHasExistingData(true)
        }

        // Save to table-data subcollection (always create/update)
        const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'general-table')
        
        // Clean proposals array to remove any undefined values
        const cleanedProposals = finalProposals.map(p => {
          const cleaned: any = { ...p }
          // Remove description field - it should only live in query-subgraph
          delete cleaned.description
          Object.keys(cleaned).forEach(key => {
            if (cleaned[key] === undefined) {
              delete cleaned[key]
            }
          })
          // Ensure AI fields are always present (even if null) for consistency
          if (!('summary' in cleaned)) cleaned.summary = null
          if (!('github' in cleaned)) cleaned.github = null
          if (!('karmaProfile' in cleaned)) cleaned.karmaProfile = null
          return cleaned
        })
        
        const tableDataToSave: any = {
          proposals: cleanedProposals,
          // Don't save proposalDescriptions - descriptions should only live in query-subgraph
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
        return
      }
      
      if (queryResultsSnap.empty) {
        setError(`No query results found in source block: ${sourceBlockIdParam}`)
        console.error('Source block path:', `newsroom/${projectId}/folders/${folderId}/blocks/${sourceBlockIdParam}/query-results`)
        setLoading(false)
        return
      }

      // Get the latest query result (most recent by queriedAt)
      const latestResult = queryResultsSnap.docs[0]
      const resultData = latestResult.data()
      
      // Check data structure - Firestore has: data -> data -> cvproposals
      if (!resultData.success) {
        setError('Query was not successful')
        console.error('Query failed:', resultData.error)
        setLoading(false)
        return
      }

      // Navigate through the nested data structure
      const proposalsData = resultData.data?.data?.cvproposals || resultData.data?.cvproposals
      
      if (!proposalsData || !Array.isArray(proposalsData)) {
        setError('Invalid query results structure in source block')
        console.error('Invalid result data structure:', {
          success: resultData.success,
          hasData: !!resultData.data,
          hasDataData: !!resultData.data?.data,
          hasCvproposals: !!resultData.data?.data?.cvproposals,
          hasDirectCvproposals: !!resultData.data?.cvproposals,
          resultDataKeys: Object.keys(resultData),
          dataKeys: resultData.data ? Object.keys(resultData.data) : [],
        })
        setLoading(false)
        return
      }

      // If merge mode, create a map of existing proposals by ID to preserve AI fields
      const existingProposalsMap = new Map<string, GardensProposal>()
      if (mergeMode && proposals.length > 0) {
        proposals.forEach(p => {
          if (p.id) {
            existingProposalsMap.set(p.id, p)
          }
        })
      }

      // Transform proposals from query result - only include fields needed for the table
      const { tokenAddress, tokenSymbol } = await resolveTokenInfo(proposalsData)

      const transformedProposals: GardensProposal[] = proposalsData.map((p: any) => {
        // Handle proposalStatus as number or string
        const proposalStatus = typeof p.proposalStatus === 'string' 
          ? parseInt(p.proposalStatus) 
          : p.proposalStatus
        
        let executionStatus = 'failed'
        if (proposalStatus === 4) {
          executionStatus = 'executed'
        } else if (proposalStatus === 0) {
          executionStatus = 'pending'
        }

        const proposalId = p.id || ''
        const existingProposal = mergeMode ? existingProposalsMap.get(proposalId) : null

        const proposal: any = {
          id: proposalId,
          proposalNumber: p.proposalNumber || 0,
          title: p.metadata?.title || null,
          // Don't include description - it should only live in query-subgraph
          requestedAmount: p.requestedAmount || '0',
          tokenSymbol: tokenSymbol || null,
          tokenAddress: tokenAddress || null,
          executionStatus: executionStatus,
          createdAt: p.createdAt ? new Date(parseInt(p.createdAt) * 1000).toISOString() : '',
          metadataHash: p.metadataHash || null,
          proposalUrl: buildProposalUrl(proposalId),
          // In merge mode, preserve AI fields from existing proposal; otherwise initialize as null
          summary: mergeMode && existingProposal?.summary ? existingProposal.summary : null,
          github: mergeMode && existingProposal?.github ? existingProposal.github : null,
          karmaProfile: mergeMode && existingProposal?.karmaProfile ? existingProposal.karmaProfile : null,
        }
        
        // Remove undefined values (Firestore doesn't allow undefined)
        Object.keys(proposal).forEach(key => {
          if (proposal[key] === undefined) {
            delete proposal[key]
          }
        })
        
        // Ensure AI fields are always present (even if null) for consistency
        if (!('summary' in proposal)) proposal.summary = null
        if (!('github' in proposal)) proposal.github = null
        if (!('karmaProfile' in proposal)) proposal.karmaProfile = null
        
        return proposal as GardensProposal
      })

      // In merge mode, add any existing proposals that weren't in the new data
      let finalProposals = transformedProposals
      if (mergeMode && existingProposalsMap.size > 0) {
        const newProposalIds = new Set(transformedProposals.map(p => p.id))
        const missingProposals = Array.from(existingProposalsMap.values()).filter(
          p => p.id && !newProposalIds.has(p.id)
        )
        finalProposals = [...transformedProposals, ...missingProposals]
      }

      setProposals(finalProposals)
      if (finalProposals.length > 0) {
        setHasExistingData(true)
      }

      // Save to table-data subcollection (always create/update)
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'general-table')
      
      // Clean proposals array to remove any undefined values
      const cleanedProposals = finalProposals.map(p => {
        const cleaned: any = { ...p }
        // Remove description field - it should only live in query-subgraph
        delete cleaned.description
        Object.keys(cleaned).forEach(key => {
          if (cleaned[key] === undefined) {
            delete cleaned[key]
          }
        })
        // Ensure AI fields are always present (even if null) for consistency
        if (!('summary' in cleaned)) cleaned.summary = null
        if (!('github' in cleaned)) cleaned.github = null
        if (!('karmaProfile' in cleaned)) cleaned.karmaProfile = null
        return cleaned
      })
      
      const tableDataToSave: any = {
        proposals: cleanedProposals,
        // Don't save proposalDescriptions - descriptions should only live in query-subgraph
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
      
      // Set loading to false after successful generation
      setLoading(false)
    } catch (err) {
      console.error('Error generating table:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate table')
      setLoading(false)
    }
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

  // Format date helper
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString)
      const month = date.toLocaleDateString('en-US', { month: 'short' })
      const year = date.getFullYear()
      return `${month}-${year}`
    } catch {
      return dateString
    }
  }

  // Fetch all proposal descriptions from subgraph
  const fetchAllProposalDescriptions = async (): Promise<Record<string, string>> => {
    if (!sourceBlockId) {
      throw new Error('No source block selected')
    }

    // Get source block's parsed URL
    const sourceBlockRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', sourceBlockId)
    const sourceBlockSnap = await getDoc(sourceBlockRef)
    
    if (!sourceBlockSnap.exists()) {
      throw new Error('Source block not found')
    }

    const sourceData = sourceBlockSnap.data()
    const parsedUrl = sourceData['parsed-url']
    
    if (!parsedUrl || !parsedUrl.poolId) {
      throw new Error('Source block missing pool ID')
    }

    const subgraphId = 'FmcVWeR9xdJyjM53DPuCvEdH24fSXARdq4K5K8EZRZVp'
    const apiKey = process.env.NEXT_PUBLIC_SUBGRAPH_KEY || ''
    
    if (!apiKey) {
      throw new Error('API key not found')
    }

    const subgraphUrl = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`
    const query = `{ cvproposals(where: { strategy_: { poolId: "${parsedUrl.poolId}" }, proposalStatus: 4 }) { id metadata { description } } }`
    
    const response = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    })

    const result = await response.json()
    
    if (!result.data?.cvproposals) {
      throw new Error('Failed to fetch descriptions from subgraph')
    }

    const descriptionsMap: Record<string, string> = {}
    result.data.cvproposals.forEach((p: any) => {
      if (p.metadata?.description) {
        descriptionsMap[p.id] = p.metadata.description
      }
    })

    return descriptionsMap
  }

  // Check if proposal has AI-generated data
  const hasAiData = (proposal: GardensProposal): boolean => {
    return !!(proposal.summary || proposal.github || proposal.karmaProfile)
  }

  // Handle AI Fill button click - mirrored from Gardens report builder
  const handleAiFill = async (proposal: GardensProposal, skipConfirmation: boolean = false) => {
    // Check if proposal already has AI data and show confirmation modal
    if (!skipConfirmation && hasAiData(proposal)) {
      setConfirmModal({ show: true, proposal })
      return
    }

    if (!useAiConfig || !aiConfig) {
      setError('AI config not available')
      return
    }

    setProcessingProposalId(proposal.id)
    setError(null)

    try {
      // STEP 1: Get description from query-subgraph block (not from general-table)
      let description = proposalDescriptions[proposal.id]

      if (!description) {
        if (isFetchingDescriptions) {
          setError('Descriptions are being fetched. Please wait...')
          setProcessingProposalId(null)
          return
        }

        setIsFetchingDescriptions(true)
        setError('Fetching descriptions from query-subgraph block...')
        
        try {
          const descriptionsMap = await fetchAllProposalDescriptions()

          // Cache descriptions locally (but don't add to proposals - descriptions only live in query-subgraph)
          setProposalDescriptions(prev => ({ ...prev, ...descriptionsMap }))

          description = descriptionsMap[proposal.id]
          
          if (!description) {
            setError('Description not found for this proposal in query-subgraph block.')
            setIsFetchingDescriptions(false)
            setProcessingProposalId(null)
            return
          }

          setError(null)
          setIsFetchingDescriptions(false)
        } catch (fetchError) {
          setError(`Failed to fetch descriptions from query-subgraph: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`)
          setIsFetchingDescriptions(false)
          setProcessingProposalId(null)
          return
        }
      } else {
        console.log(`Using cached description for proposal ${proposal.id}`)
      }

      // STEP 2: Build AI payload from config
      const focusArray = Array.isArray(aiConfig.instructions?.summary?.focus)
        ? aiConfig.instructions.summary.focus
        : (aiConfig.instructions?.summary?.focus || '')
            .split(',')
            .map((item: string) => item.trim())
            .filter((item: string) => item.length > 0)

      const payload = {
        model: aiConfig.model,
        temperature: aiConfig.temperature,
        reasoning: aiConfig.reasoning,
        task: aiConfig.task,
        instructions: {
          summary: {
            required: includeSummary && aiConfig.instructions?.summary?.required,
            description: aiConfig.instructions?.summary?.description,
            prefix: aiConfig.instructions?.summary?.prefix,
            wordCount: aiConfig.instructions?.summary?.wordCount,
            focus: focusArray
          },
          github: {
            required: includeGithub && aiConfig.instructions?.github?.required,
            description: aiConfig.instructions?.github?.description
          },
          karmaProfile: {
            required: includeKarma && aiConfig.instructions?.karmaProfile?.required,
            description: aiConfig.instructions?.karmaProfile?.description
          }
        },
        outputFormat: aiConfig.outputFormat,
        outputDestination: aiConfig.outputDestination,
        input: {
          description: description
        }
      }

      // STEP 3: Call AI function
      const genericAiAgentCallable = httpsCallable<any, any>(functions, 'genericAiAgent')
      const result = await genericAiAgentCallable(payload)

      const responseData = result.data as {
        success?: boolean
        message?: string
        result?: {
          summary?: string
          github?: string | null
          karmaProfile?: string | null
        }
      }

      const aiFields = {
        summary: responseData?.result?.summary || responseData?.message || 'No response received',
        github: responseData?.result?.github || null,
        karmaProfile: responseData?.result?.karmaProfile || null
      }

      // STEP 4: Build updated proposals array synchronously from ref (always has latest)
      const updatedProposals = proposalsRef.current.map(p => {
        if (p.id === proposal.id) {
          return {
            ...p,
            summary: includeSummary ? aiFields.summary : p.summary,
            github: includeGithub ? aiFields.github : p.github,
            karmaProfile: includeKarma ? aiFields.karmaProfile : p.karmaProfile
          }
        }
        return p
      })

      // Update ref immediately (so next Fill ALL iteration sees it)
      proposalsRef.current = updatedProposals
      
      // Update React state
      setProposals(updatedProposals)

      // STEP 5: Save to Firestore immediately with the updated proposals
      const tableDataRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'table-data', 'general-table')
      
      // Clean proposals array to remove any undefined values, but preserve null values
      const cleanedProposals = updatedProposals.map(p => {
        const cleaned: any = { ...p }
        // Remove description field - it should only live in query-subgraph
        delete cleaned.description
        Object.keys(cleaned).forEach(key => {
          if (cleaned[key] === undefined) {
            delete cleaned[key]
          }
        })
        // Ensure AI fields are always present (even if null) for consistency
        if (!('summary' in cleaned)) cleaned.summary = null
        if (!('github' in cleaned)) cleaned.github = null
        if (!('karmaProfile' in cleaned)) cleaned.karmaProfile = null
        return cleaned
      })
      
      const tableDataToSave: any = {
        proposals: cleanedProposals,
        proposalDescriptions: proposalDescriptions || {},
        sourceBlockId: sourceBlockId || '',
        updatedAt: serverTimestamp(),
      }
      
      // Remove undefined values from the entire object
      Object.keys(tableDataToSave).forEach(key => {
        if (tableDataToSave[key] === undefined) {
          delete tableDataToSave[key]
        }
      })
      
      await setDoc(tableDataRef, tableDataToSave, { merge: true })
    } catch (err) {
      console.error('Error processing AI fill:', err)
      setError(err instanceof Error ? err.message : 'Failed to process AI fill')
    } finally {
      setProcessingProposalId(null)
    }
  }

  // Handle confirmation modal proceed
  const handleConfirmProceed = () => {
    if (confirmModal.proposal) {
      setConfirmModal({ show: false, proposal: null })
      handleAiFill(confirmModal.proposal, true) // Skip confirmation on retry
    }
  }

  // Handle confirmation modal cancel
  const handleConfirmCancel = () => {
    setConfirmModal({ show: false, proposal: null })
  }

  // Handle Fill ALL confirm modal actions
  const handleFillAllConfirm = () => {
    setShowFillAllConfirm(true)
  }

  const handleFillAllCancel = () => {
    setShowFillAllConfirm(false)
  }

  // Fill all rows sequentially, reusing handleAiFill (one row at a time)
  const handleFillAllProceed = async () => {
    setShowFillAllConfirm(false)
    if (proposals.length === 0 || isFillingAll) return
    setIsFillingAll(true)
    setFillAllProgress(0)
    setError(null)

    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i]
      try {
        await handleAiFill(proposal, true) // skip per-row confirmation
      } catch (err) {
        // Continue with remaining rows, but surface the error
        setError(err instanceof Error ? err.message : 'Failed to fill some rows')
      }
      setFillAllProgress(i + 1)
    }

    setIsFillingAll(false)
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading table...
      </div>
    )
  }

  if (error && proposals.length === 0) {
    return (
      <div className="p-4 text-center text-red-500">
        {error}
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

      {/* Refresh and Fill All controls */}
      <div className="mb-4 flex items-center gap-3">
        {hasExistingData && (
          <button
            onClick={refreshTableData}
            disabled={isRefreshing || loading || !sourceBlockId}
            className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
        {useAiConfig && (includeSummary || includeGithub || includeKarma) && (
          <button
            onClick={handleFillAllConfirm}
            disabled={isFillingAll || processingProposalId !== null || proposals.length === 0}
            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFillingAll
              ? `Filling... ${fillAllProgress}/${proposals.length}`
              : 'Fill ALL'}
          </button>
        )}
      </div>

      {proposals.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No proposals found. Check source block configuration.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-auto flex-1">
          <div className="overflow-x-auto">
            <table className="divide-y divide-gray-200" style={{ minWidth: '1200px', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead className="bg-gray-50">
                <tr>
                  {useAiConfig && (includeSummary || includeGithub || includeKarma) && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24 border-r border-gray-300">
                      Action
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300">
                    Proposal Number
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300">
                    Proposal Title
                  </th>
                  {includeSummary && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300" style={{ width: '450px', minWidth: '450px', maxWidth: '450px' }}>
                      Proposal Summary
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300">
                    Requested Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300">
                    Token
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300">
                    Creation Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300" style={{ width: '150px', minWidth: '150px', maxWidth: '150px' }}>
                    Proposal URL
                  </th>
                  {includeGithub && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-300" style={{ width: '150px', minWidth: '150px', maxWidth: '150px' }}>
                      GitHub
                    </th>
                  )}
                  {includeKarma && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '150px', minWidth: '150px', maxWidth: '150px' }}>
                      Karma Profile
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {proposals.map((proposal) => (
                  <tr key={proposal.id}>
                    {useAiConfig && (includeSummary || includeGithub || includeKarma) && (
                      <td className="px-4 py-4 whitespace-nowrap border-r border-gray-300">
                        <button
                          onClick={() => handleAiFill(proposal)}
                          disabled={processingProposalId !== null}
                          className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {processingProposalId === proposal.id ? 'Processing...' : 'AI Fill'}
                        </button>
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border-r border-gray-300">
                      {proposal.proposalNumber}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 border-r border-gray-300">
                      {proposal.title || '-'}
                    </td>
                    {includeSummary && (
                      <td className="px-6 py-4 text-sm text-gray-900 border-r border-gray-300" style={{ width: '450px', minWidth: '450px', maxWidth: '450px' }}>
                        <div className="h-[150px] overflow-y-auto">
                          {proposal.summary || '-'}
                        </div>
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 border-r border-gray-300">
                      {formatAmount(proposal.requestedAmount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border-r border-gray-300">
                      {proposal.tokenSymbol || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm border-r border-gray-300">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        proposal.executionStatus === 'executed' 
                          ? 'bg-green-100 text-green-800' 
                          : proposal.executionStatus === 'pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {proposal.executionStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 border-r border-gray-300">
                      {proposal.createdAt ? formatDate(proposal.createdAt) : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 border-r border-gray-300" style={{ width: '150px', minWidth: '150px', maxWidth: '150px' }}>
                      <div className="h-[150px] overflow-y-auto">
                        {proposal.proposalUrl ? (
                          <a href={proposal.proposalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-words">
                            {proposal.proposalUrl}
                          </a>
                        ) : '-'}
                      </div>
                    </td>
                    {includeGithub && (
                      <td className="px-6 py-4 text-sm text-gray-500 border-r border-gray-300" style={{ width: '150px', minWidth: '150px', maxWidth: '150px' }}>
                        <div className="h-[150px] overflow-y-auto">
                          {proposal.github ? (
                            <a href={proposal.github} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-words">
                              {proposal.github}
                            </a>
                          ) : '-'}
                        </div>
                      </td>
                    )}
                    {includeKarma && (
                      <td className="px-6 py-4 text-sm text-gray-500" style={{ width: '150px', minWidth: '150px', maxWidth: '150px' }}>
                        <div className="h-[150px] overflow-y-auto">
                          {proposal.karmaProfile ? (
                            <a href={proposal.karmaProfile} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-words">
                              {proposal.karmaProfile}
                            </a>
                          ) : '-'}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.show && confirmModal.proposal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Confirm AI Fill Replacement
            </h3>
            <p className="text-sm text-gray-700 mb-6">
              This action will replace the current row's AI summary, GitHub link, and Karma profile. Are you sure you want to proceed?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleConfirmCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmProceed}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fill All Confirmation Modal */}
      {showFillAllConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Fill ALL Rows
            </h3>
            <p className="text-sm text-gray-700 mb-6">
              This will replace rows previously filled with AI. Are you sure you want to proceed?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleFillAllCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={handleFillAllProceed}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

