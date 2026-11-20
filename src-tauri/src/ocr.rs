//! Text inside pictures, read with Windows' built-in offline text recognition so screenshots can be
//! found by search. Results are cached in `.plico/picture-text.json` (picture path to text), so each
//! picture is read once, in the background, and nothing leaves the laptop.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;

static INDEXING: Mutex<()> = Mutex::new(());

fn cache_path(root: &Path) -> PathBuf {
    root.join(".plico").join("picture-text.json")
}

pub fn load(root: &Path) -> HashMap<String, String> {
    fs::read_to_string(cache_path(root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(root: &Path, map: &HashMap<String, String>) {
    let p = cache_path(root);
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(s) = serde_json::to_string(map) {
        let _ = fs::write(p, s);
    }
}

fn is_picture(p: &Path) -> bool {
    p.extension().and_then(|x| x.to_str()).is_some_and(|x| {
        ["png", "jpg", "jpeg", "gif", "webp"].contains(&x.to_ascii_lowercase().as_str())
    })
}

/// Reads every picture in `images/` that has no cached text yet, telling the main window as each is done.
pub fn index_in_background(app: tauri::AppHandle, root: PathBuf) {
    std::thread::spawn(move || {
        let Ok(_one_at_a_time) = INDEXING.lock() else { return };
        init_thread();
        let mut map = load(&root);
        let Ok(entries) = fs::read_dir(root.join("images")) else { return };
        let mut changed = false;
        let present: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| is_picture(p)).collect();
        for p in &present {
            let key = format!("images/{}", p.file_name().unwrap_or_default().to_string_lossy());
            if map.contains_key(&key) {
                continue;
            }
            // an unreadable picture is stored as empty so it isn't retried on every start
            let text = read_text(p).unwrap_or_default();
            if !text.is_empty() {
                let _ = app.emit_to("main", "picture-text", (key.clone(), text.clone()));
            }
            map.insert(key, text);
            changed = true;
        }
        let before = map.len();
        map.retain(|k, _| present.iter().any(|p| k.ends_with(&*p.file_name().unwrap_or_default().to_string_lossy())));
        if changed || map.len() != before {
            save(&root, &map);
        }
    });
}

#[cfg(windows)]
fn init_thread() {
    // WinRT needs the thread joined to an apartment before use
    unsafe {
        let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);
    }
}

#[cfg(not(windows))]
fn init_thread() {}

#[cfg(windows)]
pub fn read_text(file: &Path) -> Result<String, String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, BitmapTransform, ColorManagementMode, ExifOrientationMode,
    };
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};

    let run = || -> windows::core::Result<String> {
        // the Storage API only accepts backslashes
        let path = HSTRING::from(file.to_string_lossy().replace('/', "\\"));
        let stream = StorageFile::GetFileFromPathAsync(&path)?.join()?.OpenAsync(FileAccessMode::Read)?.join()?;
        let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let max = OcrEngine::MaxImageDimension()?;
        let (w, h) = (decoder.PixelWidth()?, decoder.PixelHeight()?);
        // very large pictures are scaled down to what the recogniser accepts
        let transform = BitmapTransform::new()?;
        if w.max(h) > max {
            let scale = max as f64 / w.max(h) as f64;
            transform.SetScaledWidth(((w as f64 * scale) as u32).max(1))?;
            transform.SetScaledHeight(((h as f64 * scale) as u32).max(1))?;
        }
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Premultiplied,
                &transform,
                ExifOrientationMode::RespectExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )?
            .join()?;
        Ok(engine.RecognizeAsync(&bitmap)?.join()?.Text()?.to_string())
    };
    run().map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn read_text(_: &Path) -> Result<String, String> {
    Ok(String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs a picture with text in it: `PLICO_OCR_SAMPLE=<png> cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn reads_text_from_a_picture() {
        init_thread();
        let p = std::env::var("PLICO_OCR_SAMPLE").expect("set PLICO_OCR_SAMPLE");
        let text = read_text(Path::new(&p)).unwrap();
        assert!(text.to_lowercase().contains("invoice"), "got: {text}");
    }

    #[test]
    fn only_pictures_are_read() {
        assert!(is_picture(Path::new("images/a.PNG")));
        assert!(is_picture(Path::new("images/a.webp")));
        assert!(!is_picture(Path::new("images/a.md")));
    }
}
