import type { ServerConfig } from '../config.ts'
import { DeepgramProvider } from './deepgram.ts'
import { MockSttProvider } from './mock.ts'
import { SonioxProvider } from './soniox.ts'
import type { SttProvider } from './types.ts'

export function createSttProvider(config: ServerConfig): SttProvider {
  switch (config.sttProvider) {
    case 'soniox':
      return new SonioxProvider(config.sonioxApiKey!, config.sonioxModel, { maxEndpointDelayMs: config.sonioxMaxEndpointDelayMs })
    case 'deepgram':
      return new DeepgramProvider(config.deepgramApiKey!, config.deepgramModel)
    case 'mock':
      return new MockSttProvider()
  }
}
