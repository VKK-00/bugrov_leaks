from bootstrap_env import fix_env
fix_env()

import os
import time
import subprocess
from pathlib import Path

def get_mtime_sum(directory):
    """Рахує суму часу модифікації всіх файлів для відстеження змін."""
    total = 0
    for path in Path(directory).rglob('*'):
        if path.is_file():
            try:
                total += path.stat().st_mtime
            except FileNotFoundError:
                continue
    return total

def main():
    root = Path(__file__).parent
    frontend_dir = root / "frontend"
    
    print("🚀 Запуск Dev-режиму для Bugrov Leaks...")
    
    # Початкова збірка
    print("📦 Перша збірка...")
    subprocess.run(["python", "build.py"], cwd=root)
    
    # Запуск сервера в окремому процесі
    print("🌐 Запуск сервера на http://localhost:8080...")
    server_process = subprocess.Popen(
        ["python", "-m", "http.server", "8080", "--directory", "site"],
        cwd=root
    )
    
    last_mtime = get_mtime_sum(frontend_dir)
    
    try:
        while True:
            time.sleep(1)
            current_mtime = get_mtime_sum(frontend_dir)
            
            if current_mtime != last_mtime:
                print("\n⚡ Зміни виявлено! Оновлення...")
                subprocess.run(["python", "build.py"], cwd=root)
                last_mtime = current_mtime
                print("✅ Готово. Оновіть сторінку в браузері.")
                
    except KeyboardInterrupt:
        print("\n🛑 Зупинка сервера...")
        server_process.terminate()
        server_process.wait()

if __name__ == "__main__":
    main()
