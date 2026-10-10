"""
Alinhamento de REFERÊNCIA independente para o lip-sync da INIA (só ferramenta de medição — nada disto
roda no produto): tempos de início/fim de cada palavra de cada captura do Gemini Live, pelo
reconhecedor Whisper (faster-whisper, modelo "small", CPU), sem usar nada do alinhador da INIA.

    python tools/avatar/whisper-word-reference.py <pasta-das-capturas> <saída.json>

Requer `pip install faster-whisper` num ambiente À PARTE (venv temporário fora do repositório) e o
modelo Systran/faster-whisper-small no cache do Hugging Face (`local_files_only`: nada é baixado).
Tempos em segundos desde a primeira amostra do WAV. O texto da captura NÃO é dado ao Whisper (seria
"cola" para o reconhecimento): ele reconhece sozinho; a comparação casa as palavras por texto.

Precisão conhecida dos tempos de palavra do Whisper: dezenas de ms (alinhamento por atenção, quadros
de 20 ms) — serve para achar erros de palavra trocada/deslocada, não para medir 10 ms.
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

WHISPER_RATE = 16000


def read_wav_16k(path: Path) -> np.ndarray:
    """WAV PCM16 mono das capturas (24 kHz) → float32 a 16 kHz (passa-baixa + interpolação linear).

    Lê o WAV aqui em vez do decodificador do faster-whisper (PyAV), que nem sempre casa com a versão
    do Python do venv."""
    with wave.open(str(path), "rb") as reader:
        rate = reader.getframerate()
        pcm = np.frombuffer(reader.readframes(reader.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if rate == WHISPER_RATE:
        return pcm
    cutoff = 0.45 * WHISPER_RATE / rate
    taps = np.arange(-32, 33)
    kernel = 2 * cutoff * np.sinc(2 * cutoff * taps) * np.hamming(len(taps))
    filtered = np.convolve(pcm, kernel / kernel.sum(), mode="same")
    times = np.arange(0, len(pcm) / rate, 1 / WHISPER_RATE)
    return np.interp(times, np.arange(len(pcm)) / rate, filtered).astype(np.float32)


def main() -> None:
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    model = WhisperModel("small", device="cpu", compute_type="int8", local_files_only=True)
    result = {"model": "faster-whisper small (int8, cpu)", "language": "pt", "fixtures": {}}
    for wav in sorted(source.glob("*.wav")):
        segments, _ = model.transcribe(
            read_wav_16k(wav),
            language="pt",
            word_timestamps=True,
            vad_filter=False,
            beam_size=5,
            condition_on_previous_text=False,
        )
        words = []
        for segment in segments:
            for word in segment.words or []:
                words.append({"word": word.word.strip(), "start": round(word.start, 3), "end": round(word.end, 3), "p": round(word.probability, 3)})
        result["fixtures"][wav.stem] = words
        print(wav.stem, len(words), " ".join(w["word"] for w in words)[:160], flush=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
