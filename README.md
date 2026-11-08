<div align="center">

# Murmur

**Hold a key, speak, release. Your words are typed into whatever app you're using.**
Private voice dictation powered by Whisper running on your own computer. No account, no API key, no cloud.

[Download](../../releases/latest) · [Report a bug](../../issues)

</div>

## Features
- **Works everywhere:** types into any text field: browsers, chat, documents, code editors.
- **Fully local:** speech recognition runs on your machine. Your audio never leaves it.
- **Hold to talk:** hold a key, speak, let go. Press another key while holding it to cancel, so shortcuts like Right Ctrl+C still work.
- **Clean text:** filler words like "um" and "uh" are removed and the sentence is capitalised.
- **Three model sizes:** tiny (fastest), base (default), small (most accurate).
- **Lives in the tray:** change the key and model, or turn on *Launch at login*.
- **Light on screen:** a small floating pill with a live waveform shows when it is listening.

## Requirements
Windows 10 / 11 (64-bit) or macOS Big Sur 11 and newer (Intel and Apple Silicon).

## Install
1. Open the [latest release](../../releases/latest) and download the file for your computer:
   - **Windows:** `Murmur-*-win-x64.exe`
   - **Mac with Apple chip (M1/M2/M3/M4):** `Murmur-*-mac-arm64.dmg`
   - **Mac with Intel chip:** `Murmur-*-mac-x64.dmg`
2. **Windows:** run the installer. If SmartScreen warns, click *More info*, then *Run anyway*.
3. **macOS:** open the `.dmg`, drag Murmur to Applications, then right-click it and choose *Open* the first time.
   If macOS says the app is "damaged", open Terminal and run `xattr -cr /Applications/Murmur.app`, then open it again.
4. **First launch needs internet once** to download the speech model (about 80 MB for the default). The tray icon tooltip shows progress. After that Murmur works offline.

## Use it
Click into any text field, **hold the key**, talk, **let go**.
Default key: **Right Option** on Mac, **Right Ctrl** on Windows. Change it from the tray menu.
Space is not used as the trigger because a global Space hook would fire on every space you type.

## Permissions
- **Mac, first launch:** *Microphone*, *Accessibility* (to paste) and *Input Monitoring* (to see the hotkey). Add Murmur under System Settings > Privacy & Security.
- **Windows:** only the microphone prompt.

## Tray menu
- Hold-to-talk key: Right Option/Alt, Right Ctrl or Right Shift
- Model: tiny, base, small
- Launch at login

## Privacy
Audio is processed on your computer and discarded after transcription. The only network use is the one-time model download from Hugging Face.

## Notes
- Text is inserted by pasting, then your previous clipboard text is restored. Non-text clipboard contents (images) are not preserved.
- Models are English by default. For other languages, swap the model IDs in `src/main.js` for multilingual ones (for example `Xenova/whisper-small`).
- Installers are not code-signed, so first launch shows a security prompt.

## Run from source
Needs Node 18+.
```
npm install
npm start
```

## Build installers
```
npm run dist
```
Produces a `.dmg` on Mac and an `.exe` on Windows (build on each OS), in the `dist` folder. Or push a tag (`git tag v1.0.0 && git push --tags`) and GitHub Actions builds Windows and both Mac versions.

## License
MIT. See [LICENSE](LICENSE).
