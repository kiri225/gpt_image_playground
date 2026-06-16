import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createInputImageFromFile,
  deleteImageIfUnreferenced,
  ensureImageCached,
  runMattingBatch,
  submitMattingTask,
  useStore,
} from '../store'
import { DEFAULT_MATTING_PROMPT, SUGGESTED_MATTING_PROMPT } from '../lib/matting'
import { downloadImageIds, downloadImageEntriesAsZip, formatExportFileTime } from '../lib/downloadImages'
import { validateApiProfile, getActiveApiProfile } from '../lib/apiProfiles'

interface MattingQueueItem {
  id: string
  fileName: string
  imageId: string
  dataUrl: string
  taskId?: string
}

type MattingItemStatus = 'pending' | 'running' | 'done' | 'error'

function getItemStatus(item: MattingQueueItem, taskStatus?: string): MattingItemStatus {
  if (!item.taskId) return 'pending'
  if (taskStatus === 'running') return 'running'
  if (taskStatus === 'done') return 'done'
  if (taskStatus === 'error') return 'error'
  return 'pending'
}

function statusLabel(status: MattingItemStatus) {
  switch (status) {
    case 'pending': return '待处理'
    case 'running': return '处理中'
    case 'done': return '已完成'
    case 'error': return '失败'
  }
}

function statusClass(status: MattingItemStatus) {
  switch (status) {
    case 'pending': return 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
    case 'running': return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
    case 'done': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    case 'error': return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  }
}

export default function BatchMattingWorkspace() {
  const tasks = useStore((s) => s.tasks)
  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)

  const [queue, setQueue] = useState<MattingQueueItem[]>([])
  const [prompt, setPrompt] = useState(DEFAULT_MATTING_PROMPT)
  const [isRunning, setIsRunning] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const apiReady = !validateApiProfile(activeProfile)

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])

  const enrichedQueue = useMemo(() => queue.map((item) => {
    const task = item.taskId ? taskById.get(item.taskId) : undefined
    const status = getItemStatus(item, task?.status)
    return {
      ...item,
      task,
      status,
      outputImageId: task?.outputImages[0],
      error: task?.error,
    }
  }), [queue, taskById])

  const stats = useMemo(() => ({
    total: enrichedQueue.length,
    pending: enrichedQueue.filter((item) => item.status === 'pending').length,
    running: enrichedQueue.filter((item) => item.status === 'running').length,
    done: enrichedQueue.filter((item) => item.status === 'done').length,
    error: enrichedQueue.filter((item) => item.status === 'error').length,
  }), [enrichedQueue])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (list.length === 0) {
      showToast('请选择图片文件', 'error')
      return
    }

    const nextItems: MattingQueueItem[] = []
    for (const file of list) {
      const image = await createInputImageFromFile(file)
      if (!image) continue
      nextItems.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        imageId: image.id,
        dataUrl: image.dataUrl,
      })
    }

    if (nextItems.length === 0) return
    setQueue((current) => [...current, ...nextItems])
    showToast(`已添加 ${nextItems.length} 张图片`, 'success')
  }, [showToast])

  const removeItem = useCallback(async (item: MattingQueueItem) => {
    setQueue((current) => current.filter((entry) => entry.id !== item.id))
    await deleteImageIfUnreferenced(item.imageId)
  }, [])

  const clearQueue = useCallback(async () => {
    if (isRunning) return
    for (const item of queue) {
      if (!item.taskId) await deleteImageIfUnreferenced(item.imageId)
    }
    setQueue([])
  }, [isRunning, queue])

  const handleStartBatch = useCallback(async () => {
    if (!apiReady) {
      showToast('请先完善 API 配置', 'error')
      setShowSettings(true)
      return
    }

    const pendingItems = queue.filter((item) => !item.taskId)
    if (pendingItems.length === 0) {
      showToast('没有待处理的图片', 'error')
      return
    }

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      showToast('请输入抠图提示词', 'error')
      return
    }

    setIsRunning(true)
    const submittedTaskIds = new Map<string, string>()

    await runMattingBatch(
      pendingItems.map((item) => ({
        imageId: item.imageId,
        dataUrl: item.dataUrl,
        fileName: item.fileName,
      })),
      {
        prompt: trimmedPrompt,
        onTaskSubmitted: (index, taskId) => {
          const item = pendingItems[index]
          if (!item) return
          submittedTaskIds.set(item.id, taskId)
          setQueue((current) => current.map((entry) => (
            entry.id === item.id ? { ...entry, taskId } : entry
          )))
        },
      },
    )

    setIsRunning(false)
    showToast('批量抠图任务已全部提交', 'success')
  }, [apiReady, prompt, queue, setShowSettings, showToast])

  const retryItem = useCallback(async (item: MattingQueueItem) => {
    if (!apiReady) {
      showToast('请先完善 API 配置', 'error')
      setShowSettings(true)
      return
    }

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      showToast('请输入抠图提示词', 'error')
      return
    }

    const taskId = await submitMattingTask({
      imageId: item.imageId,
      dataUrl: item.dataUrl,
      fileName: item.fileName,
      prompt: trimmedPrompt,
    })

    if (!taskId) return
    setQueue((current) => current.map((entry) => (
      entry.id === item.id ? { ...entry, taskId } : entry
    )))
    showToast(`已重新提交「${item.fileName}」`, 'success')
  }, [apiReady, prompt, setShowSettings, showToast])

  const downloadAll = useCallback(async () => {
    const entries = enrichedQueue
      .filter((item) => item.outputImageId)
      .map((item, index) => ({
        imageId: item.outputImageId!,
        fileNameBase: item.fileName.replace(/\.[^.]+$/, '') || `matting-${String(index + 1).padStart(2, '0')}`,
      }))

    if (entries.length === 0) {
      showToast('暂无可下载的结果', 'error')
      return
    }

    if (entries.length === 1) {
      await downloadImageIds([entries[0].imageId], entries[0].fileNameBase)
      return
    }

    await downloadImageEntriesAsZip(entries, `matting-batch-${formatExportFileTime(new Date())}`)
    showToast(`已打包下载 ${entries.length} 张图片`, 'success')
  }, [enrichedQueue, showToast])

  useEffect(() => {
    const prevent = (event: DragEvent) => {
      event.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  return (
    <main className="pb-16">
      <div className="safe-area-x max-w-5xl mx-auto px-4 pt-24 sm:pt-28">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">批量抠图</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            上传多张图片，自动复用画廊透明背景后处理，批量生成 PNG 透明底素材。
          </p>
        </div>

        {!apiReady && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            请先在设置中配置 API Key 与接口地址，再开始批量抠图。
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="ml-2 font-medium underline underline-offset-2"
            >
              去设置
            </button>
          </div>
        )}

        <div
          className={`mb-6 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-blue-400 bg-blue-50/80 dark:border-blue-400/60 dark:bg-blue-500/10'
              : 'border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]'
          }`}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsDragging(false)
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files)
          }}
        >
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-300">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">拖拽图片到此处，或点击选择文件</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">支持多选，建议使用主体清晰、背景简单的图片</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
          >
            选择图片
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) void addFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>

        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">抠图提示词</label>
            <button
              type="button"
              onClick={() => setPrompt(SUGGESTED_MATTING_PROMPT)}
              className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              填入示例
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={8}
            className="w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
            placeholder={SUGGESTED_MATTING_PROMPT}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            提交时会强制生成 PNG，并使用与画廊一致的透明背景后处理；此处只需填写主体和抠图要求。
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isRunning || stats.pending === 0}
            onClick={() => void handleStartBatch()}
            className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? '提交中...' : `开始批量抠图${stats.pending > 0 ? ` (${stats.pending})` : ''}`}
          </button>
          <button
            type="button"
            disabled={stats.done === 0}
            onClick={() => void downloadAll()}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
          >
            下载全部结果
          </button>
          <button
            type="button"
            disabled={isRunning || queue.length === 0}
            onClick={() => void clearQueue()}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
          >
            清空列表
          </button>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            共 {stats.total} 张 · 完成 {stats.done} · 处理中 {stats.running} · 失败 {stats.error}
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center text-sm text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
            上传图片后将显示在这里
          </div>
        ) : (
          <div className="space-y-3">
            {enrichedQueue.map((item) => (
              <MattingQueueRow
                key={item.id}
                item={item}
                onRemove={() => void removeItem(item)}
                onRetry={() => void retryItem(item)}
                onDownload={async () => {
                  if (!item.outputImageId) return
                  await downloadImageIds([item.outputImageId], item.fileName.replace(/\.[^.]+$/, '') || 'matting')
                }}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function MattingQueueRow({
  item,
  onRemove,
  onRetry,
  onDownload,
}: {
  item: {
    id: string
    fileName: string
    dataUrl: string
    status: MattingItemStatus
    outputImageId?: string
    error?: string | null
  }
  onRemove: () => void
  onRetry: () => void
  onDownload: () => void
}) {
  const [outputPreview, setOutputPreview] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!item.outputImageId) {
      setOutputPreview(null)
      return
    }
    void ensureImageCached(item.outputImageId).then((dataUrl) => {
      if (!cancelled) setOutputPreview(dataUrl ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [item.outputImageId])

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <img
            src={item.dataUrl}
            alt={item.fileName}
            className="h-16 w-16 shrink-0 rounded-xl border border-gray-200 object-cover dark:border-white/[0.08]"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{item.fileName}</div>
            <div className="mt-1 flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(item.status)}`}>
                {statusLabel(item.status)}
              </span>
              {item.error && (
                <span className="truncate text-xs text-red-500" title={item.error}>{item.error}</span>
              )}
            </div>
          </div>
        </div>

        {outputPreview && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">结果</span>
            <div
              className="h-16 w-16 rounded-xl border border-gray-200 bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%,#e5e7eb),linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%,#e5e7eb)] bg-[length:12px_12px] bg-[position:0_0,6px_6px] dark:border-white/[0.08]"
            >
              <img src={outputPreview} alt="抠图结果" className="h-full w-full rounded-xl object-cover" />
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-wrap gap-2">
          {item.status === 'done' && item.outputImageId && (
            <button
              type="button"
              onClick={onDownload}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
            >
              下载
            </button>
          )}
          {item.status === 'error' && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
            >
              重试
            </button>
          )}
          {item.status === 'pending' && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
            >
              移除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
