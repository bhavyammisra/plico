//! Earlier versions of each note, kept in `.history/<note>/` so a bad edit or an overwrite can be
//! undone. While someone types, at most one version is kept per ten minutes, and the newest 50 per note.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const KEEP: usize = 50;
const EVERY_MINUTES: i64 = 10;
const STAMP: &str = "%Y%m%d-%H%M%S";

#[derive(Serialize)]
pub struct Version {
    pub saved: String,
    pub body: String,
}

/// A note's history folder, named from its created time, which (unlike its file name) never changes.
fn dir(root: &Path, created: &str) -> PathBuf {
    let id: String = created.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    root.join(".history").join(id)
}

fn when(name: &str) -> Option<chrono::NaiveDateTime> {
    chrono::NaiveDateTime::parse_from_str(name.strip_suffix(".md")?, STAMP).ok()
}

/// Version file names, oldest first.
fn names(d: &Path) -> Vec<String> {
    let mut out: Vec<String> = fs::read_dir(d)
        .map(|r| r.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| when(n).is_some()).collect())
        .unwrap_or_default();
    out.sort();
    out
}

/// Keeps `previous`, the note's text before this save, unless a version was kept in the last ten
/// minutes (`force` keeps it anyway, used before restoring an old version).
pub fn keep(root: &Path, created: &str, previous: &str, force: bool) {
    if created.is_empty() || previous.trim().is_empty() {
        return;
    }
    let d = dir(root, created);
    let mut list = names(&d);
    if let Some(last) = list.last() {
        let recent = when(last).is_some_and(|t| chrono::Local::now().naive_local() - t < chrono::Duration::minutes(EVERY_MINUTES));
        if (recent && !force) || fs::read_to_string(d.join(last)).is_ok_and(|t| t == previous) {
            return;
        }
    }
    if fs::create_dir_all(&d).is_err() {
        return;
    }
    let name = format!("{}.md", chrono::Local::now().format(STAMP));
    if fs::write(d.join(&name), previous).is_err() {
        return;
    }
    if !list.contains(&name) {
        list.push(name);
    }
    while list.len() > KEEP {
        let _ = fs::remove_file(d.join(list.remove(0)));
    }
}

/// A note's kept versions, newest first.
pub fn list(root: &Path, created: &str) -> Vec<Version> {
    let d = dir(root, created);
    names(&d)
        .into_iter()
        .rev()
        .filter_map(|n| {
            let t = when(&n)?.and_local_timezone(chrono::Local).single()?;
            Some(Version { saved: t.to_rfc3339(), body: fs::read_to_string(d.join(&n)).ok()? })
        })
        .collect()
}

/// Removes a note's history (when it is locked or deleted for good, so no readable copy is left).
pub fn forget(root: &Path, created: &str) {
    if !created.is_empty() {
        let _ = fs::remove_dir_all(dir(root, created));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_versions_spaced_out_and_forgets() {
        let root = std::env::temp_dir().join(format!("plico-history-test-{}", std::process::id()));
        let created = "2026-11-12T17:00:00+05:30";
        keep(&root, created, "first", false);
        keep(&root, created, "second", false); // within ten minutes: skipped
        assert_eq!(list(&root, created).len(), 1);
        std::thread::sleep(std::time::Duration::from_millis(1100));
        keep(&root, created, "third", true); // forced, as before a restore
        let v = list(&root, created);
        assert_eq!(v.iter().map(|v| v.body.as_str()).collect::<Vec<_>>(), ["third", "first"]);
        keep(&root, created, "third", true); // same as the newest: not kept twice
        assert_eq!(list(&root, created).len(), 2);
        forget(&root, created);
        assert!(list(&root, created).is_empty());
        let _ = fs::remove_dir_all(&root);
    }
}
