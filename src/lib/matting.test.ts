import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { getMattingRequestParams } from './matting'

describe('matting request params', () => {
  it('forces PNG transparent output for every matting request', () => {
    const params = {
      ...DEFAULT_PARAMS,
      output_format: 'jpeg' as const,
      output_compression: 70,
      transparent_output: false,
      n: 3,
    }

    const next = getMattingRequestParams(params)

    expect(next).toMatchObject({
      output_format: 'png',
      output_compression: null,
      transparent_output: true,
      n: 1,
    })
    expect(params.output_format).toBe('jpeg')
    expect(params.output_compression).toBe(70)
    expect(params.transparent_output).toBe(false)
    expect(params.n).toBe(3)
  })
})
