#!/usr/bin/env python3
"""
Telegram HTML Export → Static JSON Viewer Builder

Parses Telegram Desktop HTML export files and generates:
- JSON message chunks (for lazy loading)
- Chat manifests (metadata)
- Search indexes
- Copies media files

Output is ready for GitHub Pages deployment.
"""

import json
import re
import shutil
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from bs4 import BeautifulSoup
import os

# Configuration
CHUNK_SIZE = 10000  # Messages per chunk
EXPORT_DIR = Path(__file__).parent / "Files"
OUTPUT_DIR = Path(__file__).parent / "site"

DT_RE = re.compile(r"^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$")

# Custom Title Overrides
TITLE_OVERRIDES = {
    "chat_002": "фрагмент з Ярослава Хоменко"
}


@dataclass
class Attachment:
    kind: str              # "photo" | "video" | "file" | "sticker" | "voice" | "round_video"
    href: str              # path relative to site/
    title: Optional[str] = None
    duration: Optional[str] = None


@dataclass
class Message:
    message_id: str
    dt_iso: Optional[str]
    from_name: Optional[str]
    html_text: Optional[str]
    plain_text: str
    reply_to: Optional[str] = None
    forwarded_from: Optional[str] = None
    forwarded_date: Optional[str] = None
    call_type: Optional[str] = None  # "incoming" | "outgoing" | "missed"
    call_duration: Optional[int] = None  # seconds
    attachments: List[Attachment] = field(default_factory=list)
    is_service: bool = False


def parse_dt(title_value: Optional[str]) -> Optional[str]:
    """Parse Telegram's date format to ISO 8601."""
    if not title_value:
        return None
    title_value = title_value.strip()
    if DT_RE.match(title_value):
        dt = datetime.strptime(title_value, "%d.%m.%Y %H:%M:%S")
        return dt.isoformat()
    return None


def norm_text(s: str) -> str:
    """Normalize whitespace in text."""
    return re.sub(r"\s+", " ", s).strip()


def classify_href(href: str) -> str:
    """Determine attachment type from href."""
    h = href.lower()
    if "/photos/" in h or h.startswith("photos/") or any(h.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")):
        return "photo"
    if "/video_files/" in h or h.startswith("video_files/") or any(h.endswith(ext) for ext in (".mp4", ".mov", ".webm", ".mkv")):
        return "video"
    if "/stickers/" in h or h.startswith("stickers/"):
        return "sticker"
    if "/voice_messages/" in h or h.startswith("voice_messages/") or h.endswith(".ogg"):
        return "voice"
    if "/round_video_messages/" in h or h.startswith("round_video_messages/"):
        return "round_video"
    if "/files/" in h or h.startswith("files/"):
        return "file"
    return "file"


def extract_attachments(msg_div, chat_id: str) -> List[Attachment]:
    """Extract all attachments from a message div."""
    out: List[Attachment] = []
    media_folders = ("photos/", "files/", "video_files/", "stickers/", "voice_messages/", "round_video_messages/")
    
    for a in msg_div.select("a[href]"):
        href = a.get("href", "").strip()
        if not href:
            continue
        
        # Check if this is a media link
        is_media = any(seg in href for seg in media_folders)
        if not is_media:
            continue
        
        # Convert relative path to site-relative path
        # Original: ../../chats/chat_001/photos/photo.jpg
        # New: media/chat_001/photos/photo.jpg
        new_href = href
        if "chats/" in href:
            # Extract path from chats/chat_XXX/...
            match = re.search(r"chats/(chat_\d+)/(.+)", href)
            if match:
                new_href = f"media/{match.group(1)}/{match.group(2)}"
        
        title = norm_text(a.get_text(" ", strip=True)) or None
        
        # Get duration for media
        duration = None
        duration_div = a.select_one(".video_duration, .duration")
        if duration_div:
            duration = norm_text(duration_div.get_text())
        
        out.append(Attachment(
            kind=classify_href(href),
            href=new_href,
            title=title,
            duration=duration
        ))
    
    # Also check for inline stickers/photos
    for img in msg_div.select("img.sticker, img.photo"):
        src = img.get("src", "").strip()
        if src and any(seg in src for seg in media_folders):
            match = re.search(r"chats/(chat_\d+)/(.+)", src)
            if match:
                new_href = f"media/{match.group(1)}/{match.group(2)}"
            else:
                new_href = src
            out.append(Attachment(
                kind="sticker" if "sticker" in src.lower() else "photo",
                href=new_href
            ))
    
    # Deduplicate by href
    uniq = {}
    for att in out:
        uniq[att.href] = att
    
    # Filter out thumbnails (ending in _thumb.jpg/png etc)
    final_atts = []
    for att in uniq.values():
        # Check for _thumb pattern
        if "_thumb" in att.href.lower():
            continue
        final_atts.append(att)
        
    return final_atts


def parse_messages_html(path: Path, chat_id: str, last_sender: Dict[str, str]) -> List[Message]:
    """Parse a single messages.html file."""
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="ignore"), "lxml")
    messages: List[Message] = []
    
    for msg_div in soup.select("div.history div.message"):
        msg_id = msg_div.get("id") or ""
        msg_id = msg_id.strip() or "unknown"
        
        classes = set(msg_div.get("class") or [])
        is_service = "service" in classes
        is_joined = "joined" in classes
        
        # Get datetime
        date_div = msg_div.select_one("div.date.details[title]")
        dt_iso = parse_dt(date_div.get("title") if date_div else None)
        
        # Get sender (may be missing for "joined" messages)
        from_name = None
        from_div = msg_div.select_one("div.from_name")
        if from_div:
            from_name = norm_text(from_div.get_text(" ", strip=True)) or None
            if from_name:
                last_sender["name"] = from_name
        elif is_joined and "name" in last_sender:
            from_name = last_sender["name"]
        
        # Get reply_to
        reply_to = None
        reply_div = msg_div.select_one("div.reply_to a")
        if reply_div:
            onclick = reply_div.get("onclick", "")
            match = re.search(r"GoToMessage\((\d+)\)", onclick)
            if match:
                reply_to = f"message{match.group(1)}"
        
        # Get forwarded from
        forwarded_from = None
        forwarded_date = None
        fwd_div = msg_div.select_one("div.forwarded.body")
        if fwd_div:
            fwd_name_div = fwd_div.select_one("div.from_name")
            if fwd_name_div:
                # Extract name (before span.details)
                fwd_text = fwd_name_div.get_text(" ", strip=True)
                # Extract date from span.details if present
                fwd_date_span = fwd_name_div.select_one("span.details")
                if fwd_date_span:
                    forwarded_date = norm_text(fwd_date_span.get_text(" ", strip=True))
                    # Remove date part from name
                    fwd_text = fwd_text.replace(forwarded_date, "").strip()
                forwarded_from = norm_text(fwd_text)
        
        # Get call information
        call_type = None
        call_duration = None
        call_div = msg_div.select_one("div.media_call")
        if call_div:
            call_classes = set(call_div.get("class") or [])
            status_div = call_div.select_one("div.status.details")
            if status_div:
                status_text = norm_text(status_div.get_text(" ", strip=True))
                
                # Determine call type
                if "Incoming" in status_text:
                    call_type = "incoming"
                elif "Outgoing" in status_text:
                    call_type = "outgoing"
                elif "Cancelled" in status_text:
                    call_type = "cancelled"
                elif "Missed" in status_text:
                    call_type = "missed"
                
                # Check if answered (has 'success' class)
                if "success" not in call_classes and call_type and call_type != "cancelled":
                    call_type = "missed"
                
                # Extract duration if present
                duration_match = re.search(r"\((\d+)\s+seconds?\)", status_text)
                if duration_match:
                    call_duration = int(duration_match.group(1))
        
        # Get text
        text_div = msg_div.select_one("div.text")
        html_text = None
        plain_text = ""
        
        if text_div:
            html_text = "".join(str(x) for x in text_div.contents).strip() or None
            plain_text = norm_text(text_div.get_text(" ", strip=True))
        elif is_service:
            details = msg_div.select_one("div.body.details")
            if details:
                plain_text = norm_text(details.get_text(" ", strip=True))
                
                # IGNORE Date Service Messages
                # Telegram export uses service messages for dates like "7 August 2021"
                # We identify them by regex or simple property
                # Regex for "D Month YYYY"
                if re.match(r"^\d{1,2} [A-Za-z]+ \d{4}$", plain_text):
                    continue 

        attachments = extract_attachments(msg_div, chat_id)
        
        messages.append(Message(
            message_id=msg_id,
            dt_iso=dt_iso,
            from_name=from_name,
            html_text=html_text,
            plain_text=plain_text,
            reply_to=reply_to,
            forwarded_from=forwarded_from,
            forwarded_date=forwarded_date,
            call_type=call_type,
            call_duration=call_duration,
            attachments=attachments,
            is_service=is_service
        ))
    
    return messages


def get_chat_title(html_path: Path) -> str:
    """Extract chat title from first messages.html."""
    soup = BeautifulSoup(html_path.read_text(encoding="utf-8", errors="ignore"), "lxml")
    header = soup.select_one(".page_header .text.bold")
    if header:
        return norm_text(header.get_text(" ", strip=True))
    return html_path.parent.name


def process_chat(chat_dir: Path, output_data_dir: Path, output_media_dir: Path) -> Dict[str, Any]:
    """Process a single chat directory."""
    chat_id = chat_dir.name
    print(f"  Processing {chat_id}...")
    
    # Find all messages*.html files
    html_files = sorted(chat_dir.glob("messages*.html"), key=lambda p: (
        0 if p.name == "messages.html" else int(re.search(r"messages(\d+)", p.name).group(1))
    ))
    
    if not html_files:
        print(f"    No messages.html found, skipping")
        return None
    
    # Get chat title
    if chat_id in TITLE_OVERRIDES:
        title = TITLE_OVERRIDES[chat_id]
    else:
        title = get_chat_title(html_files[0])
    
    # Parse all messages
    all_messages: List[Message] = []
    last_sender: Dict[str, str] = {}
    
    for html_file in html_files:
        print(f"    Parsing {html_file.name}...")
        messages = parse_messages_html(html_file, chat_id, last_sender)
        all_messages.extend(messages)
    
    print(f"    Total messages: {len(all_messages)}")
    
    # Create output directory
    chat_output_dir = output_data_dir / chat_id
    chat_output_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir = chat_output_dir / "chunks"
    chunks_dir.mkdir(exist_ok=True)
    
    # Split into chunks and write
    chunks_info = []
    for i in range(0, len(all_messages), CHUNK_SIZE):
        chunk = all_messages[i:i + CHUNK_SIZE]
        chunk_num = (i // CHUNK_SIZE) + 1
        chunk_filename = f"chunk_{chunk_num:04d}.json"
        
        # Convert to dicts
        chunk_data = []
        for msg in chunk:
            d = asdict(msg)
            d["attachments"] = [asdict(a) for a in msg.attachments]
            chunk_data.append(d)
        
        (chunks_dir / chunk_filename).write_text(
            json.dumps(chunk_data, ensure_ascii=False),
            encoding="utf-8"
        )
        
        # Get date range for this chunk
        dates = [m.dt_iso for m in chunk if m.dt_iso]
        chunks_info.append({
            "filename": chunk_filename,
            "message_count": len(chunk),
            "start_id": chunk[0].message_id if chunk else None,
            "end_id": chunk[-1].message_id if chunk else None,
            "start_date": min(dates) if dates else None,
            "end_date": max(dates) if dates else None
        })
    
    # Generate search index
    search_data = []
    for msg in all_messages:
        if msg.plain_text and not msg.is_service:
            search_data.append({
                "id": msg.message_id,
                "dt": msg.dt_iso[:10] if msg.dt_iso else None,  # Just date for display
                "from": msg.from_name,
                "text": msg.plain_text[:500]  # Limit text length
            })
    
    (chat_output_dir / "search.json").write_text(
        json.dumps(search_data, ensure_ascii=False),
        encoding="utf-8"
    )
    
    # Copy media files
    media_dest = output_media_dir / chat_id
    media_folders = ["photos", "files", "video_files", "stickers", "voice_messages", "round_video_messages"]
    
    for folder_name in media_folders:
        src_folder = chat_dir / folder_name
        if src_folder.exists():
            dst_folder = media_dest / folder_name
            if dst_folder.exists():
                shutil.rmtree(dst_folder)
            print(f"    Copying {folder_name}/...")
            shutil.copytree(src_folder, dst_folder)
    
    # Get date range
    all_dates = [m.dt_iso for m in all_messages if m.dt_iso]
    
    # Write chat manifest
    chat_manifest = {
        "chat_id": chat_id,
        "title": title,
        "message_count": len([m for m in all_messages if not m.forwarded_from]),
        "chunk_count": len(chunks_info),
        "chunks": chunks_info,
        "start_date": min(all_dates) if all_dates else None,
        "end_date": max(all_dates) if all_dates else None,
        "search_file": "search.json"
    }
    
    (chat_output_dir / "manifest.json").write_text(
        json.dumps(chat_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    
    return {
        "chat_id": chat_id,
        "title": title,
        "message_count": len([m for m in all_messages if not m.forwarded_from]),
        "chunk_count": len(chunks_info),
        "start_date": min(all_dates) if all_dates else None,
        "end_date": max(all_dates) if all_dates else None
    }


def main():
    print("=" * 60)
    print("Telegram Archive → Static Viewer Builder")
    print("=" * 60)
    
    # Setup output directories
    output_data_dir = OUTPUT_DIR / "data"
    output_media_dir = OUTPUT_DIR / "media"
    
    # Clean previous output
    if OUTPUT_DIR.exists():
        print(f"Cleaning previous output: {OUTPUT_DIR}")
        shutil.rmtree(OUTPUT_DIR)
    
    output_data_dir.mkdir(parents=True)
    output_media_dir.mkdir(parents=True)
    
    # Find all chat directories
    chats_dir = EXPORT_DIR / "chats"
    if not chats_dir.exists():
        print(f"ERROR: Chats directory not found: {chats_dir}")
        return
    
    chat_dirs = sorted([d for d in chats_dir.iterdir() if d.is_dir() and d.name.startswith("chat_")])
    print(f"\nFound {len(chat_dirs)} chats to process\n")
    
    # Process each chat
    global_manifest = []
    for chat_dir in chat_dirs:
        result = process_chat(chat_dir, output_data_dir, output_media_dir)
        if result:
            global_manifest.append(result)
    
    # Sort by message count (most messages first)
    global_manifest.sort(key=lambda x: x["message_count"], reverse=True)
    
    # Write global manifest
    (output_data_dir / "manifest.json").write_text(
        json.dumps({
            "chats": global_manifest,
            "total_chats": len(global_manifest),
            "total_messages": sum(c["message_count"] for c in global_manifest),
            "generated_at": datetime.now().isoformat()
        }, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    
    # Copy Frontend Code
    frontend_dir = Path(__file__).parent / "frontend"
    if frontend_dir.exists():
        print(f"Copying frontend from {frontend_dir}...")
        for item in frontend_dir.iterdir():
            s = item
            d = OUTPUT_DIR / item.name
            if s.is_dir():
                if d.exists():
                    shutil.rmtree(d)
                shutil.copytree(s, d)
            else:
                shutil.copy2(s, d)

    # Copy Wallpapers
    wallpaper_src = EXPORT_DIR / "wallpaper"
    wallpaper_dest = OUTPUT_DIR / "images" / "wallpaper"
    
    if wallpaper_src.exists():
        print(f"Copying wallpapers from {wallpaper_src}...")
        wallpaper_dest.parent.mkdir(parents=True, exist_ok=True)
        if wallpaper_dest.exists():
            shutil.rmtree(wallpaper_dest)
        shutil.copytree(wallpaper_src, wallpaper_dest)
    else:
        print(f"Wallpaper directory not found: {wallpaper_src}")
    
    print("\n" + "=" * 60)
    print("BUILD COMPLETE!")
    print("=" * 60)
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Total chats: {len(global_manifest)}")
    print(f"Total messages: {sum(c['message_count'] for c in global_manifest)}")
    print("\nNext steps:")
    print("  1. cd site")
    print("  2. python -m http.server 8080")
    print("  3. Open http://localhost:8080")


if __name__ == "__main__":
    main()
