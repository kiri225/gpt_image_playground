import type { TaskParams } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getTransparentRequestParams } from './transparentImage'

/** 批量抠图默认留空，由用户自行填写提示词 */
export const DEFAULT_MATTING_PROMPT = ''

/** 输入框占位示例，不会自动追加到请求中 */
export const SUGGESTED_MATTING_PROMPT = [
  '保持画面主体完整不变，去除背景，仅保留主体。',
  '主体边缘清晰自然，不添加描边、光晕、投影或反射。',
  '输出适合透明背景后处理的 PNG 素材。',
].join('\n')

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

export function getMattingRequestParams(params: TaskParams): TaskParams {
  return getTransparentRequestParams({
    ...params,
    output_format: 'png',
    output_compression: null,
    transparent_output: true,
    n: 1,
  })
}
