import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser

def log_reader(pipe, prefix):
    """Reads logs from a process stream and prints them with a prefix."""
    for line in iter(pipe.readline, ''):
        if line:
            print(f"[{prefix}] {line.strip()}")

def main():
    # Detect local network IP for phone access
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "TU_IP_LOCAL"

    print("====================================================")
    print("   Real Shuffle Player - Iniciando Servidores...     ")
    print("====================================================\n")
    print(f"   PC  : http://127.0.0.1:5173")
    print(f"   Red : http://{local_ip}:5173  ← usa esta en el teléfono\n")
    
    # 1. Start backend process (NestJS + youtubei.js)
    use_shell = sys.platform == 'win32'  # npm is a cmd wrapper on Windows
    backend_dir = "backend-node"
    dist_main = os.path.join(backend_dir, "dist", "main.js")

    # Build the Node backend the first time (or after deleting dist/).
    if not os.path.exists(dist_main):
        print("-> Compilando backend Node por primera vez (npm install + build)...")
        if not os.path.exists(os.path.join(backend_dir, "node_modules")):
            subprocess.run(["npm", "install"], cwd=backend_dir, shell=use_shell)
        subprocess.run(["npm", "run", "build"], cwd=backend_dir, shell=use_shell)

    print("-> Iniciando NestJS Backend en port 8000...")
    backend_proc = subprocess.Popen(
        ["node", dist_main],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    
    # Read backend logs in a separate thread
    backend_thread = threading.Thread(target=log_reader, args=(backend_proc.stdout, "BACKEND"), daemon=True)
    backend_thread.start()
    
    # Give the backend a second to boot up
    time.sleep(1.5)
    
    # 2. Start frontend process
    print("-> Iniciando React + Vite Frontend en port 5173...")
    # On Windows, we need shell=True to run 'npm' cmd wrapper
    frontend_proc = subprocess.Popen(
        ["npm", "run", "dev", "--prefix", "frontend"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        shell=True
    )
    
    # Read frontend logs in a separate thread
    frontend_thread = threading.Thread(target=log_reader, args=(frontend_proc.stdout, "FRONTEND"), daemon=True)
    frontend_thread.start()
    
    # Give frontend a second to boot up and open browser
    time.sleep(2.0)
    print(f"\n-> ¡Listo! Abriendo el navegador en http://127.0.0.1:5173")
    print(f"-> Desde el teléfono usa: http://{local_ip}:5173\n")
    webbrowser.open("http://127.0.0.1:5173")
    
    print("Presiona Ctrl+C en cualquier momento para detener ambos servidores.\n")
    
    try:
        # Keep launcher alive and monitor processes
        while True:
            time.sleep(1.0)
            if backend_proc.poll() is not None:
                print("[!] El proceso del Backend se detuvo inesperadamente.")
                break
            if frontend_proc.poll() is not None:
                print("[!] El proceso del Frontend se detuvo inesperadamente.")
                break
    except KeyboardInterrupt:
        print("\n\nDeteniendo servidores...")
    finally:
        # Clean termination of subprocesses
        try:
            backend_proc.terminate()
            backend_proc.wait(timeout=3)
        except Exception:
            pass
            
        try:
            # On windows npm spawns shell child processes, taskkill is safer
            if sys.platform == 'win32':
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(frontend_proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                frontend_proc.terminate()
                frontend_proc.wait(timeout=3)
        except Exception:
            pass
            
        print("=== Servidores detenidos. ¡Hasta pronto! ===")

if __name__ == "__main__":
    main()
