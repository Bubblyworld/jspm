import { Generator } from '@jspm/generator'
import type { Flags } from './types'
import { JspmError, getEnv, getInputMap, getResolutions, startLoading, stopLoading, writeMap } from './utils'

export default async function link(modules: string[], flags: Flags) {
  const inputMap = await getInputMap(flags)
  const env = getEnv(flags, true, inputMap)
  startLoading(`Linking ${modules}...`)
  const generator = new Generator({
    env,
    inputMap,
    resolutions: getResolutions(flags),
  })
  if (!modules.length)
    throw new JspmError('Link requires at least one module to trace.')
  await generator.traceInstall(modules)
  stopLoading()
  await writeMap(generator.getMap(), flags)
  return generator.getMap()
}
