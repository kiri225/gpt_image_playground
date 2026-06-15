import type { TaskParams } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { createTransparentOutputMeta, getTransparentRequestParams } from './transparentImage'

export const DEFAULT_MATTING_PROMPT = '保持画面主体完整不变，去除背景，仅保留主体，边缘清晰锐利。'

export const MATTING_BATCH_CONCURRENCY = 2

export function createMattingTaskParams(): TaskParams {
  return {
    ...DEFAULT_PARAMS,
    output_format: 'png',
    output_compression: null,
    transparent_output: true,
    n: 1,
    quality: 'high',
  }
}

export function createMattingTransparentMeta(prompt = DEFAULT_MATTING_PROMPT) {
  return createTransparentOutputMeta(prompt.trim())
}

export function getMattingRequestParams(params: TaskParams): TaskParams {
  return getTransparentRequestParams({
    ...params,
    output_format: 'png',
    output_compression: null,
    transparent_output: true,
    n: 1,
  })
}
