
import os

try:
    with open('frontend/css/style.css', 'rb') as f:
        content = f.read()

    # Search for the specific unique block at the end of valid CSS
    # We look for the media query closing brace after #msg-search-input
    
    # Identify the location of #msg-search-input
    target = b'#msg-search-input'
    idx = content.rfind(target)
    
    if idx == -1:
        print("Could not find #msg-search-input anchor.")
        exit(1)
        
    # Find the next '}' (end of rule)
    idx_rule_end = content.find(b'}', idx)
    if idx_rule_end == -1:
        print("Could not find rule closing brace.")
        exit(1)
        
    # Find the next '}' (end of media query)
    idx_mq_end = content.find(b'}', idx_rule_end + 1)
    if idx_mq_end == -1:
        print("Could not find media query closing brace.")
        exit(1)
        
    # Valid content ends at idx_mq_end + 1 (include the brace)
    valid_content = content[:idx_mq_end + 1]
    
    # New CSS to append
    new_css = b"""

/* Modal Overlay */
.modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 5000;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
}

.modal.active {
    display: flex;
}

/* Media Gallery Modal */
.media-gallery-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.95);
    z-index: 6000;
    flex-direction: column;
}

.media-gallery-header {
    padding: 15px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: white;
    background: rgba(0,0,0,0.5);
}

.media-tabs {
    display: flex;
    justify-content: center;
    gap: 20px;
    padding: 10px;
    border-bottom: 1px solid #333;
}

.media-tab {
    color: #888;
    cursor: pointer;
    padding-bottom: 5px;
    font-weight: 500;
}

.media-tab.active {
    color: var(--accent-color);
    border-bottom: 2px solid var(--accent-color);
}
"""
    
    with open('frontend/css/style.css', 'wb') as f:
        f.write(valid_content + new_css)
        
    print("Strictly repaired style.css")

except Exception as e:
    print(f"Error: {e}")
