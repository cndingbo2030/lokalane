# STT eval fixtures

Put pairs of files here (they are git-ignored, because real meeting audio is personal data):

```
evals/stt/
  pricing-call.wav   # 16-bit PCM or 32-bit float WAV, any sample rate / channel count
  pricing-call.txt   # human-verified reference transcript (punctuation and case are ignored)
```

Convert other formats with `ffmpeg -i input.m4a -ar 16000 -ac 1 -c:a pcm_s16le pricing-call.wav`.

Run `npm run eval:stt` (uses `STT_PROVIDER` and its API key from `.env`). The score is the
mixed error rate: Chinese/Japanese/Korean per character, other languages per word.
