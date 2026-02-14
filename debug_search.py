
from pathlib import Path
from bs4 import BeautifulSoup
import sys

def debug_search():
    path = Path("Files/chats/chat_016/messages.html")
    if not path.exists():
        print(f"File not found: {path}")
        return

    print(f"Scanning {path} for 'вайберу'...")
    try:
        content = path.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(content, "lxml")
        
        # Find messages containing the text
        # We look for the text directly
        target_text = "вайберу"
        
        # Method 1: Search by text content
        # Note: bs4 search might be slow on large file, but efficient enough
        found = False
        
        for msg in soup.select("div.message"):
            if target_text in msg.decode_contents():
                print(f"\n[FOUND] Message ID: {msg.get('id')}")
                print(f"Classes: {msg.get('class')}")
                
                # Print the structure of the body/text
                body = msg.select_one("div.body")
                if body:
                    print("Body structure:")
                    print(body.prettify())
                    
                    # Check specific selectors
                    text_div = body.select_one(".text")
                    if text_div:
                        print("Has .text div: DESCENDANT found")
                        print(f"Content: {text_div.get_text(strip=True)}")
                    else:
                        print("NO .text div found!")
                        
                    msg_text = body.select_one(".message-text")
                    if msg_text:
                        print("Has .message-text div")
                    else:
                        print("NO .message-text div found")
                
                found = True
                break
        
        if not found:
            print("Text not found in any message div.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_search()
