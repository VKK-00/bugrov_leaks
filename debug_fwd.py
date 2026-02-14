
from bs4 import BeautifulSoup
from pathlib import Path
import sys

# Mocking Message class and helper function to avoid importing whole build.py if complex
# But let's try importing first. 
# If that fails, I'll copy.

try:
    from build import parse_messages_html, Message
except ImportError:
    # Append current dir to path
    sys.path.append(".")
    from build import parse_messages_html, Message

def debug_chat():
    path = Path("Files/chats/chat_017/messages.html")
    if not path.exists():
        print(f"File not found: {path}")
        return

    print(f"Parsing {path}...")
    # We need a mock last_sender
    last_sender = {}
    
    # Run parser
    messages = parse_messages_html(path, "chat_017", last_sender)
    
    # Find specific message
    target_id = "message45426"
    
    found = False
    for m in messages:
        if m.message_id == target_id:
            found = True
            print(f"[{target_id}] Found:")
            print(f"  is_forwarded: {m.is_forwarded}")
            print(f"  forwarded_from: {m.forwarded_from}")
            print(f"  text: {m.plain_text[:50]}...")
            break
            
    if not found:
        print(f"Message {target_id} not found in parsed output.")
        
    # Also check count
    total = len(messages)
    fwd_count = len([m for m in messages if m.is_forwarded])
    print(f"Total messages: {total}")
    print(f"Forwarded messages: {fwd_count}")

if __name__ == "__main__":
    debug_chat()
