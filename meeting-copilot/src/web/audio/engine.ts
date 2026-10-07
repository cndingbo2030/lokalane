import { AUDIO_FRAME_MS, AUDIO_SAMPLE_RATE, type AudioSource } from '../../shared/protocol.ts'
import { floatTo16BitPcm, PcmFramer, rms16, StreamingResampler } from '../../shared/pcm.ts'
import { VoiceGate } from '../../shared/vad.ts'

/**
 * - tab: a browser tab running the meeting's web client (Meet / Teams / Zoom / Tencent Meeting web)
 * - system: all system audio via the desktop app (any meeting app, including native clients)
 * - mic-only: in-person meeting, the microphone hears everyone
 */
export type CaptureMode = 'tab' | 'system' | 'mic-only'

export interface EngineCallbacks {
  /** `captureMs`: when the frame's first sample was captured, ms since capture start. */
  onFrame: (source: AudioSource, pcm: Int16Array, captureMs: number) => void
  onLevel: (source: AudioSource, level: number) => void
  /** The user stopped sharing from the browser's own UI. */
  onEnded: () => void
}

export interface EngineOptions {
  record: boolean
  /** Skip streaming silence to STT (client-side VAD). */
  vad: boolean
}

export class CaptureError extends Error {}

/**
 * Captures meeting audio (a shared browser tab running Meet / Teams / Zoom /
 * Tencent Meeting web) and the microphone as two separate sources, converts
 * each to 16 kHz mono PCM, and records a mixed WebM/Opus file locally.
 */
export class AudioEngine {
  private context: AudioContext | null = null
  private streams: MediaStream[] = []
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  async start(mode: CaptureMode, callbacks: EngineCallbacks, options: EngineOptions): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new CaptureError('当前浏览器不支持音频采集，请使用最新版 Chrome 或 Edge。')

    let remote: MediaStream | null = null
    if (mode === 'tab' || mode === 'system') {
      remote = mode === 'tab' ? await this.captureTab() : await this.captureSystem()
      remote.getVideoTracks()[0]?.addEventListener('ended', callbacks.onEnded)
      remote.getAudioTracks()[0]?.addEventListener('ended', callbacks.onEnded)
    }

    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      remote?.getTracks().forEach((t) => t.stop())
      throw new CaptureError('无法访问麦克风，请在浏览器地址栏允许麦克风权限。')
    }
    this.streams = [mic, ...(remote ? [remote] : [])]

    const context = new AudioContext({ latencyHint: 'interactive' })
    this.context = context
    await context.audioWorklet.addModule('/pcm-worklet.js')

    // Worklets only run when pulled by the graph, so route them into a muted sink.
    const sink = context.createGain()
    sink.gain.value = 0
    sink.connect(context.destination)
    const recording = context.createMediaStreamDestination()

    // In mic-only mode (in-person meeting) the microphone hears everyone, so it is
    // treated as "remote" audio: diarized, and eligible for copilot triggers.
    const captureStart = performance.now()
    this.attach(context, mic, remote ? 'me' : 'remote', sink, recording, callbacks, options.vad, captureStart)
    if (remote) this.attach(context, remote, 'remote', sink, recording, callbacks, options.vad, captureStart)

    if (options.record && typeof MediaRecorder !== 'undefined') {
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
      this.recorder = new MediaRecorder(recording.stream, mimeType ? { mimeType } : undefined)
      this.chunks = []
      this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data)
      this.recorder.start(5_000)
    }
  }

  /** Stops capture and resolves with the local recording (if any). */
  async stop(): Promise<Blob | null> {
    let blob: Blob | null = null
    const recorder = this.recorder
    if (recorder && recorder.state !== 'inactive') {
      blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }))
        recorder.stop()
      })
    }
    this.recorder = null
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    this.streams = []
    await this.context?.close().catch(() => {})
    this.context = null
    return blob
  }

  private async captureTab(): Promise<MediaStream> {
    // Chrome-specific hints are not in lib.dom yet; they are ignored elsewhere.
    const options: DisplayMediaStreamOptions & Record<string, unknown> = {
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include',
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(options)
    } catch {
      throw new CaptureError('已取消共享。请选择会议所在的浏览器标签页，并勾选「同时分享标签页音频」。')
    }
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop())
      throw new CaptureError('没有捕获到会议声音：请选择会议所在的「标签页」（而不是窗口），并勾选「同时分享标签页音频」。')
    }
    return stream
  }

  /**
   * Desktop app only: the Electron shell answers getDisplayMedia with system
   * audio loopback (see src/desktop/main.ts), so no tab has to be picked.
   */
  private async captureSystem(): Promise<MediaStream> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    } catch {
      throw new CaptureError('无法采集系统声音：请在系统设置中允许本应用"屏幕录制/系统录音"权限后重试。')
    }
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop())
      throw new CaptureError(
        '当前系统不支持直接采集系统声音（Windows 支持；macOS 取决于系统版本）。请改用「线上会议（共享会议标签页）」，或安装 BlackHole 等虚拟声卡后选择「线下会议（仅麦克风）」。',
      )
    }
    // The video track is kept (unused): stopping it can end the paired loopback audio on some platforms.
    return stream
  }

  private attach(
    context: AudioContext,
    stream: MediaStream,
    source: AudioSource,
    sink: AudioNode,
    recording: MediaStreamAudioDestinationNode,
    callbacks: EngineCallbacks,
    vad: boolean,
    captureStart: number,
  ): void {
    const input = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
    const worklet = new AudioWorkletNode(context, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    })
    input.connect(worklet)
    worklet.connect(sink)
    input.connect(recording)

    const resampler = new StreamingResampler(context.sampleRate, AUDIO_SAMPLE_RATE)
    const framer = new PcmFramer((AUDIO_SAMPLE_RATE * AUDIO_FRAME_MS) / 1000)
    const gate = vad ? new VoiceGate() : null
    // Timestamps come from the sample count, so they stay exact under main-thread jank.
    let sourceStartMs: number | null = null
    let framesSeen = 0
    const frameTimes = new Map<Int16Array, number>()
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      sourceStartMs ??= performance.now() - captureStart
      const pcm = floatTo16BitPcm(resampler.process(event.data))
      for (const frame of framer.push(pcm)) {
        frameTimes.set(frame, sourceStartMs + framesSeen++ * AUDIO_FRAME_MS)
        callbacks.onLevel(source, rms16(frame))
        for (const out of gate ? gate.push(frame) : [frame]) {
          callbacks.onFrame(source, out, frameTimes.get(out) ?? 0)
          frameTimes.delete(out)
        }
        // Frames the gate dropped (or still holds as pre-roll) are forgotten after a while.
        if (frameTimes.size > 8) frameTimes.delete(frameTimes.keys().next().value!)
      }
    }
  }
}
