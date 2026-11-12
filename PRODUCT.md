# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Rendered in WebView2 inside a Tauri 2 desktop app for Windows. The design language is the app's
own, not native WinUI.) Planned order: Windows now, Android next (same Tauri code plus native
capture pieces), Mac and iPhone later (a MacBook and iPhone are on hand for testing).

## Stack

Tauri 2 + Svelte + TipTap (ProseMirror) editor; thin Rust layer for files, encryption and the
global shortcut. Notes stored as plain `.md` files with an `images` folder. Fully offline.
Chosen by Claude with Bhavyam's agreement (he explicitly ruled out C#/pure-Rust native).

## Users

Public app (decided 12 Nov 2026; it started as Bhavyam's personal app). For people who want a
fast, private notes app they open many times a day, and who find Notion slow and Obsidian too
much setup. Strangers will install it, so nothing may assume Bhavyam's laptop, language or habits.
Job: catch any thought, link, website or screenshot the moment it appears, and find it again
later by keyword.

## Product Purpose

Plico is one calm place to drop anything: a passing thought, a link, a screenshot, or a proper
formatted note. Success: it opens instantly, never lags, and reading a note feels pleasant.

## Positioning

A desktop answer to Nothing's Essential Space and Apple Notes: a global quick-capture box from
anywhere in Windows, plain files on disk with no account or database, and a locked folder that
is truly encrypted but still recoverable via a security question.

Against the big names (research, 12 Nov 2026): people leave Notion mainly over speed and weak
offline use, and Obsidian's slow capture (especially on phones) and plugin setup are long-standing
complaints. Plico wins on instant capture, offline, plain files and no account. It does not try
to match databases, canvas, graph view, AI, plugins or live co-editing.

## Operating Context

Used alongside everything else on the laptop. Quick capture (Ctrl+Shift+Space) pops over
whatever app is in front. Longer writing happens in the main window. On the phone (later), the
same capture box opens from a Quick Settings tile.

## Capabilities and Constraints

- Notes list on the left grouped by date (Today, Yesterday, Previous 30 days, months), with
  title, first line and date/time. List view and card view.
- Search at the top by keywords in title and body, instant.
- Editor: H1/H2/H3, bold, italic, underline, strikethrough, highlight, bullets, numbered lists,
  checkboxes, quotes, dividers, tables. Markdown shortcuts plus a `/` menu; a small format bar
  appears on text selection. First line is the title. Autosave.
- Paste or drag images and screenshots. Paste links; page titles fetched in the background when
  online, never blocking.
- Optional folders (off until used). Sidebar: All notes, folders, Pinned, Locked, Recently deleted.
- Pin notes. Trash keeps deleted notes 30 days.
- Locked folder: password set on first use plus a security question. Either unlocks. Notes
  encrypted on disk. Re-locks on close or idle. 5 wrong tries triggers a 1 minute wait.
- Note backgrounds: plain, warm paper, lined, grid, dotted. No photo backgrounds.
- Light and dark mode (follow Windows, manual override).
- Shortcuts: Ctrl+N new note, Ctrl+K search, Ctrl+Shift+Space quick capture.
- Hard constraint: must open in under a second and never feel laggy.
- Quick capture: New note or Add to a note (pick an existing note; text is added to its end).
- Out of scope: accounts, servers, AI, Tasks tab, templates, databases, canvas, graph view,
  plugins, live co-editing. Phone sync is planned but device to device only (see SPEC.md).

## Business Model and Release

- Price: one-time purchase, planned at ₹99. Buy once, yours forever. No ads, no subscription,
  no tracking.
- First release is a free test release, to find out whether people want it before paying for
  anything. No Play Store or Microsoft Store fees yet; stores come later if feedback is good.
- Download from a website hosted free on Vercel (a `.vercel.app` address is fine for now; a
  custom domain later). Instagram stories, other social media, videos and Reddit link to it.
- Before strangers install it: auto-update, a first-run intro to the capture shortcut, settings
  for things fixed to Bhavyam (capture shortcut, date and time format), version history, a
  privacy policy and terms on the website, a contact for feedback. An unsigned installer shows
  Windows SmartScreen's warning; acceptable for the free test, code signing before charging.
- Code: public on GitHub so anyone can check the privacy claims, with all rights reserved
  (LICENSE, 12 Nov 2026). Can be switched to an open source licence later.
- Name: Plico (chosen 12 Nov 2026), Italian for a sealed packet of letters, from the Latin for
  "fold": it matches the envelope icon and the way quick capture folds away. A web search found
  no app with this name and no US software trademark for it. Before the big launch: search
  India's trademark register (Class 9), check the Instagram handle, and file the trademark.
- Listening is part of the product: a Send feedback option in the app (email or a GitHub issue,
  no tracking), a public list of what's planned and what changed in each update, and replies to
  feedback. Updates ship when users genuinely need them, not on a fixed schedule. Ads may say
  this, worded as what we actually do (we read every message, we change what people ask for
  when it fits the app) rather than promising to add anything anyone asks.
- Marketing must stay honest: no fake reviews, user counts or invented numbers. Real measured
  facts (opens in about 0.8 s, 5 MB app) are fine.

## Brand Commitments

- Name: Plico. Vibe: warm, minimal, paper and nature, premium not ordinary.
- Fonts (chosen by Bhavyam): Newsreader for titles/headings, Instrument Sans for text. Bundled.
- Accent: muted terracotta (Claude's pick, pending Bhavyam's approval).
- Bans from Bhavyam's standing rules: no purple gradients, no pill-shaped buttons, no emoji
  icons, no em dashes in copy, no cursor or gimmicky scroll animations, no AI slop imagery or copy.

## Evidence on Hand

Reference screenshots of Bhavyam's phone notes app (shared in chat, not in repo). Competitor
research on Notion, Obsidian, Apple Notes, Bear, Google Keep and Joplin (chat, 12 Nov 2026).

## Marketing Message

Bhavyam's pillars for videos, ads and social media live in `marketing/MESSAGING.md`: private,
local files with a backup, only what's needed, instant capture, customizable and shaped by
feedback. Features should keep those claims true.

## Product Principles

1. Speed is a feature: nothing ships that delays opening or typing.
2. Capture first, organise later: dropping a thought takes one shortcut and Enter.
3. Quiet by default: controls appear when needed and stay out of the writing.
4. Your files, your devices: plain files, offline, no account, nothing sent to a server.
   Sync (later) goes straight between your own devices and never makes opening or capture wait.

## Accessibility & Inclusion

Readability is the stated priority: comfortable type size and contrast in both themes, full
keyboard use.
