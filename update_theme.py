
import os

style_path = r'frontend/css/style.css'

with open(style_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Define the old block to identify the location (using a smaller unique snippet)
old_bg = '--bg-color: #0f0f0f;'
start_idx = content.find(old_bg)

if start_idx == -1:
    print("Could not find old bg color ref")
    exit(1)

# Find the start of the block [data-theme="dark"] before this
block_start = content.rfind('[data-theme="dark"]', 0, start_idx)

# Find the closing brace of this block
block_end = content.find('}', start_idx)

if block_start == -1 or block_end == -1:
    print("Could not delimit block")
    exit(1)

# Construct new block
new_block = """[data-theme="dark"] {
    /* Premium Dark Theme - Modern Graphite */
    --bg-color: #181818;
    --sidebar-bg: #212121;
    --chat-bg: #0f0f0f;
    --header-bg: #212121;
    --input-bg: #2c2c2e;
    --text-primary: #e0e0e0;
    --text-secondary: #aaaaaa;
    --accent-color: #5288c1;
    --message-bg-in: #2b2b2b;
    --message-bg-out: #3e5a7a;
    /* Muted Blue */
    --msg-text: #e0e0e0;
    --msg-meta: #7a8a9a;
    --link-color: #64b5f6;
    --border-color: #333333;
    --hover-color: #2c2c2e;
    --scroll-thumb: rgba(255, 255, 255, 0.15);
}"""

# Replace
new_content = content[:block_start] + new_block + content[block_end+1:]

with open(style_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Successfully replaced dark theme block")
