"""Usage: kokoro_speak.py <voice> <out.wav> <models dir>   (text on stdin)"""
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

voice, out, models = sys.argv[1:4]
text = sys.stdin.read()
kokoro = Kokoro(f"{models}/kokoro-v1.0.onnx", f"{models}/voices-v1.0.bin")
lang = "en-gb" if voice.startswith("b") else "en-us"
samples, rate = kokoro.create(text, voice=voice, speed=1.0, lang=lang)
sf.write(out, samples, rate, subtype="PCM_16")
