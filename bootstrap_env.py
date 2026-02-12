import os
from pathlib import Path

def fix_env():
    home = Path("/tmp/home")
    home.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("HOME", str(home))
    os.environ.setdefault("XDG_CACHE_HOME", str(home / ".cache"))
    os.environ.setdefault("XDG_CONFIG_HOME", str(home / ".config"))

    pw_browsers = Path("/tmp/pw-browsers")
    pw_browsers.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(pw_browsers))

if __name__ == "__main__":
    fix_env()
    print("Environment fixed:")
    for var in ["HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "PLAYWRIGHT_BROWSERS_PATH"]:
        print(f"  {var}={os.environ.get(var)}")
