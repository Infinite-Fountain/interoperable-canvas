'use client'

import React, { useState, useEffect } from 'react'
import { getFirestore, doc, setDoc, getDoc, collection, serverTimestamp } from 'firebase/firestore'

interface FillWithAiConfigBlockProps {
  blockId: string
  projectId: string
  folderId: string
}

export function FillWithAiConfigBlock({ blockId, projectId, folderId }: FillWithAiConfigBlockProps) {
  const db = getFirestore()

  // AI Form State (defaults from current builder)
  const [aiAgent, setAiAgent] = useState<string>('openai')
  const [aiModel, setAiModel] = useState<string>('gpt-5.1')
  const [aiTemperature, setAiTemperature] = useState<number>(0.7)
  const [aiReasoningEffort, setAiReasoningEffort] = useState<string>('medium')
  const [aiTask, setAiTask] = useState<string>('Extract summary and links from proposal description')
  const [aiSummaryDescription, setAiSummaryDescription] = useState<string>('Extract a concise summary focusing only on the main problem being solved and the solution')
  const [aiSummaryRequired, setAiSummaryRequired] = useState<boolean>(true)
  const [aiSummaryPrefix, setAiSummaryPrefix] = useState<string>('AI Summary: ')
  const [aiSummaryFocus, setAiSummaryFocus] = useState<string>('problem, solution')
  const [aiWordCountMin, setAiWordCountMin] = useState<number>(40)
  const [aiWordCountMax, setAiWordCountMax] = useState<number>(50)
  const [aiGithubRequired, setAiGithubRequired] = useState<boolean>(true)
  const [aiGithubDescription, setAiGithubDescription] = useState<string>('Extract GitHub repository link if available in the description')
  const [aiKarmaRequired, setAiKarmaRequired] = useState<boolean>(true)
  const [aiKarmaDescription, setAiKarmaDescription] = useState<string>('Extract Karma GAP profile link if available in the description')
  const [aiOutputFormat, setAiOutputFormat] = useState<string>('json')
  const [aiOutputDestination, setAiOutputDestination] = useState<string>('return')
  
  const [jsonPreview, setJsonPreview] = useState<string>('')
  const [savedIndicator, setSavedIndicator] = useState<boolean>(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [hasChanges, setHasChanges] = useState<boolean>(false)

  // Validate JSON before saving
  const validateJson = (jsonString: string): boolean => {
    try {
      const parsed = JSON.parse(jsonString)
      // Basic validation - check required fields
      return !!(
        parsed.model &&
        parsed.task &&
        parsed.instructions &&
        parsed.outputFormat
      )
    } catch {
      return false
    }
  }

  // Save config to subcollection
  const saveConfig = async (isInitial = false) => {
    if (!jsonPreview || !validateJson(jsonPreview)) {
      if (!isInitial) {
        console.error('Invalid JSON configuration')
      }
      return
    }

    try {
      // Use fixed document ID 'config' to always update the same document
      const configRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'agent-config', 'config')
      const configData = {
        config: JSON.parse(jsonPreview),
        lastSavedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }

      await setDoc(configRef, configData, { merge: true })
      
      if (!isInitial) {
        setSavedIndicator(true)
        setLastSavedAt(new Date())
        setHasChanges(false)
        
        // Hide saved indicator after 2 seconds
        setTimeout(() => {
          setSavedIndicator(false)
        }, 2000)
      }
    } catch (error) {
      console.error('Error saving config:', error)
    }
  }

  // Load existing config from subcollection
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Use fixed document ID 'config' to always read from the same document
        const configRef = doc(db, 'newsroom', projectId, 'folders', folderId, 'blocks', blockId, 'agent-config', 'config')
        const configSnap = await getDoc(configRef)
        
        if (configSnap.exists()) {
          const data = configSnap.data()
          if (data.config) {
            const config = data.config
            setAiAgent(config.agent || 'openai')
            setAiModel(config.model || 'gpt-5.1')
            setAiTemperature(config.temperature ?? 0.7)
            setAiReasoningEffort(config.reasoning?.effort || 'medium')
            setAiTask(config.task || 'Extract summary and links from proposal description')
            setAiSummaryDescription(config.instructions?.summary?.description || 'Extract a concise summary focusing only on the main problem being solved and the solution')
            setAiSummaryRequired(config.instructions?.summary?.required ?? true)
            setAiSummaryPrefix(config.instructions?.summary?.prefix || 'AI Summary: ')
            setAiSummaryFocus(Array.isArray(config.instructions?.summary?.focus) 
              ? config.instructions.summary.focus.join(', ') 
              : config.instructions?.summary?.focus || 'problem, solution')
            setAiWordCountMin(config.instructions?.summary?.wordCount?.min ?? 40)
            setAiWordCountMax(config.instructions?.summary?.wordCount?.max ?? 50)
            setAiGithubRequired(config.instructions?.github?.required ?? true)
            setAiGithubDescription(config.instructions?.github?.description || 'Extract GitHub repository link if available in the description')
            setAiKarmaRequired(config.instructions?.karmaProfile?.required ?? true)
            setAiKarmaDescription(config.instructions?.karmaProfile?.description || 'Extract Karma GAP profile link if available in the description')
            setAiOutputFormat(config.outputFormat || 'json')
            setAiOutputDestination(config.outputDestination?.type || 'return')
            
            if (data.lastSavedAt) {
              setLastSavedAt(data.lastSavedAt.toDate ? data.lastSavedAt.toDate() : new Date(data.lastSavedAt))
            }
          }
        } else {
          // No config exists, create default one
          // Set defaults first, then save will be triggered by jsonPreview update
          const defaultJson = JSON.stringify({
            agent: 'openai',
            model: 'gpt-5.1',
            temperature: 0.7,
            reasoning: { effort: 'medium' },
            task: 'Extract summary and links from proposal description',
            instructions: {
              summary: {
                required: true,
                description: 'Extract a concise summary focusing only on the main problem being solved and the solution',
                prefix: 'AI Summary: ',
                wordCount: { min: 40, max: 50 },
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
            outputDestination: { type: 'return' }
          }, null, 2)
          setJsonPreview(defaultJson)
        }
      } catch (error) {
        console.error('Error loading config:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadConfig()
  }, [blockId, projectId, folderId, db])

  // Update JSON preview when form values change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const focusArray = aiSummaryFocus
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0)

      const previewJson = {
        agent: aiAgent,
        model: aiModel,
        temperature: aiTemperature,
        reasoning: {
          effort: aiReasoningEffort
        },
        task: aiTask,
        instructions: {
          summary: {
            required: aiSummaryRequired,
            description: aiSummaryDescription,
            prefix: aiSummaryPrefix,
            wordCount: {
              min: aiWordCountMin,
              max: aiWordCountMax
            },
            focus: focusArray
          },
          github: {
            required: aiGithubRequired,
            description: aiGithubDescription
          },
          karmaProfile: {
            required: aiKarmaRequired,
            description: aiKarmaDescription
          }
        },
        outputFormat: aiOutputFormat,
        outputDestination: {
          type: aiOutputDestination
        }
      }

      setJsonPreview(JSON.stringify(previewJson, null, 2))
      setHasChanges(true)
    }, 300)

    return () => clearTimeout(timer)
  }, [
    aiAgent, aiModel, aiTemperature, aiReasoningEffort, aiTask,
    aiSummaryDescription, aiSummaryRequired, aiSummaryPrefix, aiSummaryFocus,
    aiWordCountMin, aiWordCountMax,
    aiGithubRequired, aiGithubDescription,
    aiKarmaRequired, aiKarmaDescription,
    aiOutputFormat, aiOutputDestination
  ])

  // Auto-save with debouncing
  useEffect(() => {
    if (!hasChanges || loading || !jsonPreview) return

    const saveTimer = setTimeout(async () => {
      await saveConfig()
    }, 1500) // 1.5 second debounce

    return () => clearTimeout(saveTimer)
  }, [jsonPreview, hasChanges, loading])

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading configuration...
      </div>
    )
  }

  return (
    <div className="p-4">
      {/* Header with saved indicator */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {savedIndicator && (
            <span className="text-green-600 text-sm font-medium flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Saved
            </span>
          )}
          {lastSavedAt && !savedIndicator && (
            <span className="text-xs text-gray-500">
              Last saved: {lastSavedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-6 h-[300px]">
        {/* Left Column: Input Form */}
        <div className="bg-white rounded-lg shadow p-6 overflow-y-auto">
          <h4 className="text-md font-semibold mb-4 text-gray-900">AI Instructions Configuration</h4>
          <div className="space-y-4">
            {/* Agent */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Agent</label>
              <select
                value={aiAgent}
                onChange={(e) => setAiAgent(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              >
                <option value="openai">OpenAI</option>
              </select>
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              >
                <option value="gpt-5-nano">gpt-5-nano</option>
                <option value="gpt-5.1">gpt-5.1</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4-turbo">gpt-4-turbo</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
              </select>
            </div>

            {/* Temperature */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temperature: {aiTemperature} <span className="text-xs text-gray-500">(not supported by Responses API)</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={aiTemperature}
                onChange={(e) => setAiTemperature(parseFloat(e.target.value))}
                disabled
                className="w-full bg-gray-100 cursor-not-allowed opacity-60"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0.0</span>
                <span>1.0</span>
              </div>
            </div>

            {/* Reasoning Effort */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reasoning Effort</label>
              <select
                value={aiReasoningEffort}
                onChange={(e) => setAiReasoningEffort(e.target.value)}
                disabled={aiModel === 'gpt-5-nano'}
                className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white ${
                  aiModel === 'gpt-5-nano' ? 'bg-gray-100 cursor-not-allowed opacity-60' : ''
                }`}
              >
                <option value="none">None</option>
                <option value="minimal">Minimal</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">XHigh</option>
              </select>
              {aiModel === 'gpt-5-nano' && (
                <p className="mt-1 text-xs text-gray-500">Reasoning not supported for gpt-5-nano</p>
              )}
            </div>

            {/* Task */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Task</label>
              <textarea
                value={aiTask}
                onChange={(e) => setAiTask(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>

            {/* Summary Section */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-semibold text-gray-900">Summary Instructions</h5>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={aiSummaryRequired}
                    onChange={(e) => setAiSummaryRequired(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label className="ml-2 block text-sm text-gray-700">Required</label>
                </div>
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={aiSummaryDescription}
                    onChange={(e) => setAiSummaryDescription(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prefix</label>
                  <input
                    type="text"
                    value={aiSummaryPrefix}
                    onChange={(e) => setAiSummaryPrefix(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Focus (comma-separated)</label>
                  <textarea
                    value={aiSummaryFocus}
                    onChange={(e) => setAiSummaryFocus(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    placeholder="problem, solution"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Word Count Min</label>
                    <input
                      type="number"
                      value={aiWordCountMin}
                      onChange={(e) => setAiWordCountMin(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Word Count Max</label>
                    <input
                      type="number"
                      value={aiWordCountMax}
                      onChange={(e) => setAiWordCountMax(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* GitHub Section */}
            <div className="border-t pt-4">
              <h5 className="text-sm font-semibold text-gray-900 mb-3">GitHub Instructions</h5>
              <div className="space-y-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={aiGithubRequired}
                    onChange={(e) => setAiGithubRequired(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label className="ml-2 block text-sm text-gray-700">Required</label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={aiGithubDescription}
                    onChange={(e) => setAiGithubDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>
            </div>

            {/* Karma Profile Section */}
            <div className="border-t pt-4">
              <h5 className="text-sm font-semibold text-gray-900 mb-3">Karma Profile Instructions</h5>
              <div className="space-y-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={aiKarmaRequired}
                    onChange={(e) => setAiKarmaRequired(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label className="ml-2 block text-sm text-gray-700">Required</label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={aiKarmaDescription}
                    onChange={(e) => setAiKarmaDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>
            </div>

            {/* Output Format */}
            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Output Format</label>
              <select
                value={aiOutputFormat}
                onChange={(e) => setAiOutputFormat(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              >
                <option value="json">JSON</option>
                <option value="text">Text</option>
                <option value="markdown">Markdown</option>
              </select>
            </div>

            {/* Output Destination */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Output Destination</label>
              <select
                value={aiOutputDestination}
                onChange={(e) => setAiOutputDestination(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              >
                <option value="return">Return</option>
                <option value="firestore">Firestore</option>
                <option value="file">File</option>
                <option value="api">API</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right Column: JSON Preview */}
        <div className="bg-white rounded-lg shadow p-6 overflow-y-auto">
          <h4 className="text-md font-semibold mb-4 text-gray-900">JSON Preview</h4>
          <div className="bg-gray-50 rounded p-4">
            <pre className="text-xs text-gray-900 overflow-auto">
              {jsonPreview || 'Loading preview...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

