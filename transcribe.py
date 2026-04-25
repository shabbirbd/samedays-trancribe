import sys
import os
from faster_whisper import WhisperModel

def transcribe_audio(file_path):
    # Load the largest, most accurate model into the GPU (cuda)
    # We use float16 to make it even faster on the T4 GPU
    model_size = "large-v3"
    model = WhisperModel(model_size, device="cuda", compute_type="float16")

    # Run the transcription
    # beam_size 5 makes it more accurate for long sales calls
    segments, info = model.transcribe(file_path, beam_size=5)

    # Print the result so Node.js can catch it
    for segment in segments:
        print(f"[{segment.start:.2f}s - {segment.end:.2f}s] {segment.text}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Error: No file path provided")
        sys.exit(1)
    
    file_to_process = sys.argv[1]
    if os.path.exists(file_to_process):
        transcribe_audio(file_to_process)
    else:
        print(f"Error: File {file_to_process} not found")