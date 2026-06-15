import type { TaskParams } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getTransparentRequestParams } from './transparentImage'

/** 批量抠图默认留空，由用户自行填写提示词 */
export const DEFAULT_MATTING_PROMPT = ''

/** 输入框占位示例，不会自动追加到请求中 */
export const SUGGESTED_MATTING_PROMPT = [
  '保持画面主体完整不变，去除背景，仅保留主体，边缘清晰锐利。',
  '',
  '[背景指令]',
  '背景色选择规则：如果主体包含绿色系（绿、青绿、黄绿、草绿等）颜色，使用纯洋红色(#FF00FF)背景；否则一律使用纯绿色(#00FF00)背景。',
  '背景要求：整张画布仅由所选纯色填充，无任何渐变、纹理、阴影、光照变化、地面或环境元素。',
  '主体要求：单主体、完整呈现、轮廓清晰锐利。主体与背景之间保持干净的边缘分离，不要有颜色溢出或混合。',
  '禁止：主体本身、描边、光晕、投影或反射中不能出现所选背景色。',
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
