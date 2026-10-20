"""Optional build-time neural TTS. pip install edge-tts==7.3.1; no runtime API."""
import asyncio
import sys
from pathlib import Path
import edge_tts

TEXT = {
    'SHOULDER_ELBOW_OFFSET': '어깨와 팔꿈치가 어긋나 보여요. 팔꿈치를 어깨 아래에 맞춰 주세요.',
    'KNEE_BENT': '무릎이 굽혀져 보여요. 무릎을 펴고 몸을 길게 유지해 주세요.',
}

async def main():
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=True)
    for short, voice in [('sunhi', 'ko-KR-SunHiNeural'), ('injoon', 'ko-KR-InJoonNeural')]:
        for code, text in TEXT.items():
            await edge_tts.Communicate(text, voice).save(str(destination / f'{short}-{code}.mp3'))
            print(short, code)

if __name__ == '__main__':
    asyncio.run(main())
