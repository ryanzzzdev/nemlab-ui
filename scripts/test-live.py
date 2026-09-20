"""Disposable PostgreSQL + packaged Java API + production-browser integration.

Never uses .env or an existing database. Requires cached backend dependencies,
Java 25, Docker, installed npm tooling and Playwright Chromium.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
BACKEND = Path(os.environ.get("NEMLAB_BACKEND", ROOT.parent / "nemlab")).resolve()
NAME = "nemlab-ui-test-" + uuid.uuid4().hex[:12]


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def sql(text):
    run("docker", "exec", "-i", NAME, "psql", "-U", "test", "-d", "test",
        "-v", "ON_ERROR_STOP=1", input=text, stdout=subprocess.DEVNULL)


api = None
try:
    run("node", "scripts/contract.mjs", "--backend", cwd=ROOT)
    run("./gradlew", ":api:bootJar", "--offline", "--no-daemon", cwd=BACKEND)
    run("npm", "run", "build", cwd=ROOT)
    run("docker", "run", "--rm", "--detach", "--name", NAME,
        "-e", "POSTGRES_USER=test", "-e", "POSTGRES_PASSWORD=test",
        "-e", "POSTGRES_DB=test", "-p", "127.0.0.1::5432", "postgres:18.6-alpine",
        stdout=subprocess.DEVNULL)
    for _ in range(100):
        ready = subprocess.run(["docker", "exec", NAME, "pg_isready", "-h", "127.0.0.1", "-U", "test"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ready.returncode == 0:
            break
        time.sleep(0.2)
    else:
        raise RuntimeError("Disposable PostgreSQL did not start")
    port = subprocess.check_output(["docker", "port", NAME, "5432"], text=True).strip().split(":")[-1]
    for migration in sorted((BACKEND / "infrastructure/src/main/resources/db/migration").glob("V*.sql")):
        sql(migration.read_text())
    for day, incomplete in [("2023-10-01", False), ("2023-10-02", True)]:
        slots = [{"kind": "VALUE", "price": "123.4567890123456789" if i == 0 else "0"} for i in range(288)]
        if incomplete:
            slots[3] = {"kind": "MISSING", "price": None}
            slots[4] = {"kind": "SOURCE_NULL", "price": None}
        revision = str(uuid.uuid4())
        sql(f"""INSERT INTO price_revision
            (id,region,market_day,content_hash,slots,valid_count,missing_count,null_count)
            VALUES ('{revision}','NSW1','{day}','{'a' * 64}','{json.dumps(slots)}',
                    {286 if incomplete else 288},{int(incomplete)},{int(incomplete)});
            INSERT INTO price_current VALUES ('NSW1','{day}','{revision}',now());""")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        api_port = sock.getsockname()[1]
    env = os.environ.copy()
    env.update({"PORT": str(api_port), "SERVER_ADDRESS": "127.0.0.1",
                "NEMLAB_DATA_ENABLED": "true", "NEMLAB_ADMIN_ENABLED": "false",
                "NEMLAB_DB_URL": f"jdbc:postgresql://127.0.0.1:{port}/test",
                "NEMLAB_DB_USER": "test", "NEMLAB_DB_PASSWORD": "test"})
    java = str(Path(env["JAVA_HOME"]) / "bin/java") if "JAVA_HOME" in env else "java"
    with tempfile.TemporaryFile(mode="w+") as log:
        api = subprocess.Popen([java, "-jar", str(BACKEND / "api/build/libs/api.jar")],
                               env=env, stdout=log, stderr=subprocess.STDOUT)
        for _ in range(150):
            if api.poll() is not None:
                raise RuntimeError("Test API exited during startup")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/actuator/health", timeout=1):
                    break
            except OSError:
                time.sleep(0.2)
        else:
            raise RuntimeError("Test API did not start")
        env["NEMLAB_API_TARGET"] = f"http://127.0.0.1:{api_port}"
        run("npx", "--no-install", "playwright", "test", "--config", "playwright.live.config.ts",
            cwd=ROOT, env=env)
finally:
    if api is not None:
        api.terminate()
        try:
            api.wait(timeout=10)
        except subprocess.TimeoutExpired:
            api.kill()
            api.wait()
    subprocess.run(["docker", "rm", "-f", NAME], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
