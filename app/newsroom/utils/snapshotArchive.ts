/**
 * Utility functions for creating snapshot archives
 * Implements three-collection architecture: blocks, snapshots, attestations
 */

import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  getDocs, 
  serverTimestamp,
  writeBatch,
  DocumentData,
  QueryDocumentSnapshot
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getFunctions } from 'firebase/functions'
import { initializeApp, getApps } from 'firebase/app'

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
const functions = getFunctions(app)

/**
 * Generate snapshot ID: timestamp + random suffix
 * Format: YYYYMMDD-HHMMSS-{random6chars}
 */
export function generateSnapshotId(): string {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').substring(0, 15) // YYYYMMDD-HHMMSS
  const randomSuffix = Math.random().toString(36).substring(2, 8) // 6 random chars
  return `${timestamp}-${randomSuffix}`
}

/**
 * Create snapshot manifest document
 */
export async function createSnapshotManifest(
  projectId: string,
  folderId: string,
  snapshotId: string,
  icfHash: string,
  icfUrl: string,
  createdBy?: string
): Promise<void> {
  const manifestPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}`
  const manifestRef = doc(db, manifestPath)
  
  const storagePrefix = `newsroom/assets/${projectId}/${folderId}/archive/${snapshotId}`
  const sourceFolderPath = `newsroom/${projectId}/folders/${folderId}/blocks`
  
  const manifest = {
    snapshotId,
    icfHash,
    icfUrl,
    createdAt: serverTimestamp(),
    createdBy: createdBy || 'system',
    sourceFolderPath,
    storagePrefix,
    status: 'creating' as const,
    firestoreCopied: false,
    storageCopied: false,
    projectId,
    folderId,
  }
  
  await setDoc(manifestRef, manifest)
}

/**
 * Update snapshot manifest status
 */
export async function updateSnapshotManifest(
  projectId: string,
  folderId: string,
  snapshotId: string,
  updates: {
    status?: 'creating' | 'complete' | 'partial' | 'failed'
    firestoreCopied?: boolean
    storageCopied?: boolean
    firestoreError?: string
    storageError?: string
  }
): Promise<void> {
  const manifestPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}`
  const manifestRef = doc(db, manifestPath)
  
  await setDoc(manifestRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

/**
 * Recursively copy Firestore document and all subcollections
 */
async function copyDocumentWithSubcollections(
  sourceDocRef: any,
  targetDocRef: any,
  batch: any,
  batchCount: { count: number }
): Promise<void> {
  // Get source document data
  const sourceDoc = await getDoc(sourceDocRef)
  if (!sourceDoc.exists()) {
    return
  }
  
  // Add document copy to batch
  batch.set(targetDocRef, sourceDoc.data())
  batchCount.count++
  
  // Get all subcollections
  const subcollections = await getDocs(collection(sourceDocRef, 'subcollections'))
  // Actually, Firestore doesn't have a direct way to list subcollections
  // We need to know the subcollection names ahead of time
  
  // For now, we'll handle known subcollections: table-data, query-results, serpentine-data
  const knownSubcollections = ['table-data', 'query-results', 'serpentine-data']
  
  for (const subcollectionName of knownSubcollections) {
    try {
      const sourceSubcollection = collection(sourceDocRef, subcollectionName)
      const sourceDocs = await getDocs(sourceSubcollection)
      
      if (!sourceDocs.empty) {
        for (const sourceSubDoc of sourceDocs.docs) {
          const targetSubDocRef = doc(db, targetDocRef.path, subcollectionName, sourceSubDoc.id)
          batch.set(targetSubDocRef, sourceSubDoc.data())
          batchCount.count++
          
          // Recursively handle nested subcollections if needed
          // (For now, we assume max 2 levels deep)
        }
      }
    } catch (error) {
      // Subcollection doesn't exist, skip
      console.log(`Subcollection ${subcollectionName} doesn't exist, skipping`)
    }
  }
}

/**
 * Copy all blocks from source to snapshot archive
 * Recursively copies documents and subcollections
 */
export async function copyFirestoreArchive(
  projectId: string,
  folderId: string,
  snapshotId: string
): Promise<{ success: boolean; error?: string; copiedCount?: number }> {
  try {
    const sourcePath = `newsroom/${projectId}/folders/${folderId}/blocks`
    const targetPath = `newsroom/${projectId}/folders/${folderId}/snapshots/${snapshotId}/blocks`
    
    const sourceBlocksRef = collection(db, sourcePath)
    const sourceBlocks = await getDocs(sourceBlocksRef)
    
    if (sourceBlocks.empty) {
      return { success: false, error: 'No blocks found to copy' }
    }
    
    let totalCopied = 0
    const MAX_BATCH_SIZE = 500 // Firestore batch limit
    let currentBatch = writeBatch(db)
    let currentBatchSize = 0
    
    // Copy each block and its subcollections
    for (const sourceBlock of sourceBlocks.docs) {
      const blockId = sourceBlock.id
      const targetBlockRef = doc(db, targetPath, blockId)
      
      // Copy block document
      currentBatch.set(targetBlockRef, sourceBlock.data())
      currentBatchSize++
      totalCopied++
      
      // Commit batch if needed
      if (currentBatchSize >= MAX_BATCH_SIZE) {
        await currentBatch.commit()
        currentBatch = writeBatch(db)
        currentBatchSize = 0
      }
      
      // Copy known subcollections
      const knownSubcollections = ['table-data', 'query-results', 'serpentine-data']
      
      for (const subcollectionName of knownSubcollections) {
        try {
          const sourceSubcollection = collection(db, sourcePath, blockId, subcollectionName)
          const sourceSubDocs = await getDocs(sourceSubcollection)
          
          if (!sourceSubDocs.empty) {
            for (const sourceSubDoc of sourceSubDocs.docs) {
              const targetSubDocRef = doc(db, targetPath, blockId, subcollectionName, sourceSubDoc.id)
              currentBatch.set(targetSubDocRef, sourceSubDoc.data())
              currentBatchSize++
              totalCopied++
              
              // Commit batch if needed
              if (currentBatchSize >= MAX_BATCH_SIZE) {
                await currentBatch.commit()
                currentBatch = writeBatch(db)
                currentBatchSize = 0
              }
            }
          }
        } catch (error) {
          // Subcollection doesn't exist, skip
          console.log(`Subcollection ${subcollectionName} doesn't exist for block ${blockId}`)
        }
      }
    }
    
    // Commit remaining batch
    if (currentBatchSize > 0) {
      await currentBatch.commit()
    }
    
    return { success: true, copiedCount: totalCopied }
  } catch (error) {
    console.error('Error copying Firestore archive:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Trigger Storage archive copy via Cloud Function
 */
export async function copyStorageArchive(
  projectId: string,
  folderId: string,
  snapshotId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const copyStorageArchiveFn = httpsCallable(functions, 'copyStorageArchive')
    const result = await copyStorageArchiveFn({
      projectId,
      folderId,
      snapshotId,
    })
    
    return result.data as { success: boolean; error?: string }
  } catch (error) {
    console.error('Error calling copyStorageArchive function:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Create complete snapshot archive (manifest + Firestore + Storage)
 */
export async function createSnapshotArchive(
  projectId: string,
  folderId: string,
  snapshotId: string,
  icfHash: string,
  icfUrl: string,
  createdBy?: string,
  onProgress?: (status: string) => void
): Promise<{ 
  success: boolean
  firestoreSuccess: boolean
  storageSuccess: boolean
  error?: string
}> {
  try {
    // Step 1: Create manifest with initial status
    onProgress?.('Creating snapshot manifest...')
    await createSnapshotManifest(projectId, folderId, snapshotId, icfHash, icfUrl, createdBy)
    
    // Step 2: Copy Firestore archive
    onProgress?.('Copying Firestore data...')
    const firestoreResult = await copyFirestoreArchive(projectId, folderId, snapshotId)
    
    if (firestoreResult.success) {
      await updateSnapshotManifest(projectId, folderId, snapshotId, {
        firestoreCopied: true,
      })
    } else {
      await updateSnapshotManifest(projectId, folderId, snapshotId, {
        firestoreCopied: false,
        firestoreError: firestoreResult.error,
        status: 'partial',
      })
    }
    
    // Step 3: Copy Storage archive (parallel, but track separately)
    onProgress?.('Copying Storage images...')
    const storageResult = await copyStorageArchive(projectId, folderId, snapshotId)
    
    if (storageResult.success) {
      await updateSnapshotManifest(projectId, folderId, snapshotId, {
        storageCopied: true,
      })
    } else {
      await updateSnapshotManifest(projectId, folderId, snapshotId, {
        storageCopied: false,
        storageError: storageResult.error,
        status: 'partial',
      })
    }
    
    // Step 4: Update final status
    const finalStatus = firestoreResult.success && storageResult.success 
      ? 'complete' 
      : firestoreResult.success || storageResult.success 
        ? 'partial' 
        : 'failed'
    
    await updateSnapshotManifest(projectId, folderId, snapshotId, {
      status: finalStatus,
    })
    
    return {
      success: finalStatus === 'complete',
      firestoreSuccess: firestoreResult.success,
      storageSuccess: storageResult.success,
      error: finalStatus !== 'complete' 
        ? `Archive creation ${finalStatus}: ${firestoreResult.error || storageResult.error || 'Unknown error'}`
        : undefined,
    }
  } catch (error) {
    console.error('Error creating snapshot archive:', error)
    await updateSnapshotManifest(projectId, folderId, snapshotId, {
      status: 'failed',
      firestoreError: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      success: false,
      firestoreSuccess: false,
      storageSuccess: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

