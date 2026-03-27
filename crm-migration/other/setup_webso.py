#!/usr/bin/env python3
"""
Webso CRM Setup
===============
1. Resets the Neon database
2. Starts the Twenty server to initialize the workspace
3. Signs up pekka@webso.fi and creates the Webso workspace
4. Fetches ALL data from Pipedrive and migrates it to Twenty CRM

Usage:
    cd /Users/juusokayhko/Documents/Webso/twenty/crm-migration
    python setup_webso.py
"""

import html2text as _html2text
import json as _json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Optional

import psycopg
import requests
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn

load_dotenv()

console = Console()

NEON_DB_URL     = os.getenv("PG_DATABASE_URL", "")
PIPEDRIVE_TOKEN = os.getenv("PIPEDRIVE_API_TOKEN", "")
SERVER_URL      = "http://localhost:3000"
SERVER_DIR      = "/Users/juusokayhko/Documents/Webso/twenty/packages/twenty-server"

PEKKA_EMAIL     = "pekka@webso.fi"
PEKKA_PASSWORD  = "Pekka123"
WORKSPACE_NAME  = "Webso"

# ─────────────────────────────────────────────────────────────────────────────
# DATABASE RESET
# ─────────────────────────────────────────────────────────────────────────────

def reset_database():
    console.print("\n[bold cyan]Step 1: Resetting database (full wipe)...[/bold cyan]")
    steps = [
        ("Dropping schemas",    ["npx", "nx", "ts-node-no-deps-transpile-only", "--", "./scripts/truncate-db.ts"]),
        ("Creating core schema",["npx", "nx", "ts-node-no-deps-transpile-only", "--", "./scripts/setup-db.ts"]),
        ("Running migrations",  ["npx", "nx", "database:migrate", "twenty-server"]),
    ]
    for label, cmd in steps:
        console.print(f"  [dim]{label}...[/dim]", end="")
        result = subprocess.run(cmd, cwd=SERVER_DIR, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            console.print(" [red]FAILED[/red]")
            console.print(f"[red]{result.stderr[-500:]}[/red]")
            sys.exit(1)
        console.print(" [green]✓[/green]")

# ─────────────────────────────────────────────────────────────────────────────
# SERVER
# ─────────────────────────────────────────────────────────────────────────────

server_process = None

def start_server():
    global server_process
    console.print("\n[bold cyan]Step 2: Starting Twenty server...[/bold cyan]")
    server_process = subprocess.Popen(
        ["node", "dist/main.js"],
        cwd=SERVER_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

def wait_for_server(timeout=120):
    deadline = time.time() + timeout
    with Progress(SpinnerColumn(), TextColumn("[cyan]Waiting for server..."), transient=True) as p:
        p.add_task("")
        while time.time() < deadline:
            try:
                r = requests.get(f"{SERVER_URL}/healthz", timeout=3)
                if r.status_code == 200:
                    console.print("  [green]✓ Server ready[/green]")
                    return
            except requests.exceptions.RequestException:
                pass
            time.sleep(2)
    console.print("[red]Server did not start in time[/red]")
    stop_server()
    sys.exit(1)

def stop_server():
    global server_process
    if server_process:
        server_process.terminate()
        try:
            server_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server_process.kill()
        server_process = None
        console.print("  [dim]Server stopped[/dim]")

# ─────────────────────────────────────────────────────────────────────────────
# GRAPHQL
# ─────────────────────────────────────────────────────────────────────────────

def gql(query: str, variables: dict = None, token: str = None, timeout: int = 30) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    endpoint = "/metadata" if any(
        m in query for m in [
            "signUp", "signIn", "signUpInNewWorkspace", "getAuthTokensFromLoginToken",
            "updateWorkspace", "activateWorkspace", "assignRole",
        ]
    ) else "/graphql"
    resp = requests.post(
        f"{SERVER_URL}{endpoint}",
        json={"query": query, "variables": variables or {}},
        headers=headers,
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(f"GraphQL error: {data['errors']}")
    return data["data"]

# ─────────────────────────────────────────────────────────────────────────────
# WORKSPACE
# ─────────────────────────────────────────────────────────────────────────────

def create_workspace() -> tuple[str, str]:
    console.print("\n[bold cyan]Step 3: Creating Webso workspace...[/bold cyan]")

    console.print("  [dim]Signing up pekka@webso.fi...[/dim]", end="")
    try:
        result = gql("""
            mutation SignUp($email: String!, $password: String!) {
                signUp(email: $email, password: $password) {
                    availableWorkspaces {
                        availableWorkspacesForSignIn { id displayName loginToken }
                        availableWorkspacesForSignUp { id displayName loginToken }
                    }
                    tokens { accessOrWorkspaceAgnosticToken { token } }
                }
            }
        """, {"email": PEKKA_EMAIL, "password": PEKKA_PASSWORD})
        auth_data = result["signUp"]
    except RuntimeError:
        console.print(" [dim](user exists, signing in)[/dim]", end="")
        result = gql("""
            mutation SignIn($email: String!, $password: String!) {
                signIn(email: $email, password: $password) {
                    availableWorkspaces {
                        availableWorkspacesForSignIn { id displayName loginToken }
                        availableWorkspacesForSignUp { id displayName loginToken }
                    }
                    tokens { accessOrWorkspaceAgnosticToken { token } }
                }
            }
        """, {"email": PEKKA_EMAIL, "password": PEKKA_PASSWORD})
        auth_data = result["signIn"]

    agnostic_token = auth_data["tokens"]["accessOrWorkspaceAgnosticToken"]["token"]
    ws_obj = auth_data.get("availableWorkspaces", {})
    existing = (
        ws_obj.get("availableWorkspacesForSignIn", []) +
        ws_obj.get("availableWorkspacesForSignUp", [])
    )
    console.print(" [green]✓[/green]")

    if existing:
        ws = existing[0]
        workspace_id = ws["id"]
        login_token = ws["loginToken"]
        console.print(f"  [dim]Found existing workspace {workspace_id[:8]}...[/dim]", end="")
        with psycopg.connect(NEON_DB_URL) as conn:
            row = conn.execute(
                'SELECT "activationStatus" FROM core.workspace WHERE id = %s', (workspace_id,)
            ).fetchone()
        if row and row[0] == "ACTIVE":
            console.print(" [green]✓ already ACTIVE[/green]")
            ws_tokens = gql("""
                mutation GetTokens($loginToken: String!) {
                    getAuthTokensFromLoginToken(loginToken: $loginToken, origin: "http://localhost:3001") {
                        tokens { accessOrWorkspaceAgnosticToken { token } }
                    }
                }
            """, {"loginToken": login_token})
            access_token = ws_tokens["getAuthTokensFromLoginToken"]["tokens"]["accessOrWorkspaceAgnosticToken"]["token"]
            return access_token, workspace_id
        console.print(" [yellow]not yet ACTIVE, waiting...[/yellow]")
    else:
        console.print("  [dim]Creating Webso workspace...[/dim]", end="")
        ws_result = gql("""
            mutation SignUpInNewWorkspace {
                signUpInNewWorkspace {
                    loginToken { token }
                    workspace { id }
                }
            }
        """, token=agnostic_token)
        workspace_id = ws_result["signUpInNewWorkspace"]["workspace"]["id"]
        login_token_obj = ws_result["signUpInNewWorkspace"]["loginToken"]
        login_token = login_token_obj["token"] if isinstance(login_token_obj, dict) else login_token_obj
        console.print(f" [green]✓ {workspace_id[:8]}...[/green]")

        console.print("  [dim]Activating workspace...[/dim]", end="")
        ws_tokens = gql("""
            mutation GetTokens($loginToken: String!) {
                getAuthTokensFromLoginToken(loginToken: $loginToken, origin: "http://localhost:3001") {
                    tokens { accessOrWorkspaceAgnosticToken { token } }
                }
            }
        """, {"loginToken": login_token})
        access_token = ws_tokens["getAuthTokensFromLoginToken"]["tokens"]["accessOrWorkspaceAgnosticToken"]["token"]

        gql("""
            mutation ActivateWorkspace($data: ActivateWorkspaceInput!) {
                activateWorkspace(data: $data) { id activationStatus }
            }
        """, {"data": {"displayName": WORKSPACE_NAME}}, token=access_token, timeout=180)
        console.print(" [green]✓[/green]")

    console.print("  [dim]Waiting for workspace initialization[/dim]", end="")
    deadline = time.time() + 60
    while time.time() < deadline:
        with psycopg.connect(NEON_DB_URL) as conn:
            row = conn.execute(
                'SELECT "activationStatus" FROM core.workspace WHERE id = %s', (workspace_id,)
            ).fetchone()
        if row and row[0] == "ACTIVE":
            console.print(" [green]✓[/green]")
            break
        time.sleep(1)
        console.print(".", end="")
    else:
        console.print(" [red]TIMEOUT — workspace never became ACTIVE[/red]")
        stop_server()
        sys.exit(1)

    ws_tokens = gql("""
        mutation GetTokens($loginToken: String!) {
            getAuthTokensFromLoginToken(loginToken: $loginToken, origin: "http://localhost:3001") {
                tokens { accessOrWorkspaceAgnosticToken { token } }
            }
        }
    """, {"loginToken": login_token})
    access_token = ws_tokens["getAuthTokensFromLoginToken"]["tokens"]["accessOrWorkspaceAgnosticToken"]["token"]
    return access_token, workspace_id


def rename_workspace(access_token: str):
    console.print("  [dim]Renaming workspace to 'Webso'...[/dim]", end="")
    try:
        gql("""
            mutation UpdateWorkspace($data: UpdateWorkspaceInput!) {
                updateWorkspace(data: $data) { id displayName }
            }
        """, {"data": {"displayName": WORKSPACE_NAME}}, token=access_token)
        console.print(" [green]✓[/green]")
    except Exception as e:
        console.print(f" [yellow]skipped ({e})[/yellow]")


def get_workspace_schema(workspace_id: str) -> str:
    """Mirrors Twenty's getWorkspaceSchemaName: workspace_${uuidToBase36(id)}"""
    n = int(workspace_id.replace("-", ""), 16)
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    base36 = ""
    while n:
        n, r = divmod(n, 36)
        base36 = chars[r] + base36
    return f"workspace_{base36}"

# ─────────────────────────────────────────────────────────────────────────────
# PIPEDRIVE FETCH
# ─────────────────────────────────────────────────────────────────────────────

def fetch_all_pages(endpoint: str) -> list:
    """Fetch all pages from a Pipedrive endpoint."""
    records, start = [], 0
    url = f"https://api.pipedrive.com/{endpoint}"
    while True:
        resp = requests.get(url, params={"api_token": PIPEDRIVE_TOKEN, "start": start, "limit": 500}, timeout=30)
        if resp.status_code >= 400:
            break
        data = resp.json()
        if not data.get("success"):
            break
        page = data.get("data") or []
        if not page:
            break
        records.extend(page)
        if not data.get("additional_data", {}).get("pagination", {}).get("more_items_in_collection"):
            break
        start += 500
    return records

def fetch_stages() -> dict[int, str]:
    """Return {stage_id: twenty_stage} mapped from Pipedrive stage names."""
    STAGE_NAME_MAP = {
        # English
        "new": "NEW", "prospect": "NEW", "potentiaali": "NEW",
        "epämiellyttävät": "NEW",
        # Screening
        "soittoon": "SCREENING", "screening": "SCREENING", "qualified": "SCREENING",
        "tried to contact": "SCREENING", "value communicated": "SCREENING",
        "pekka ollu yhteydessä": "SCREENING", "on hold": "SCREENING",
        "keskustelu avattu": "SCREENING", "cv lähtetty": "SCREENING",
        # Meeting
        "palaveerattu (icebox)": "MEETING", "palaveerattu": "MEETING",
        "uudet palaverit": "MEETING", "jatkopalsut": "MEETING",
        "meeting": "MEETING", "meeting arranged": "MEETING",
        "haastattelu": "MEETING",
        # Proposal
        "tarjous": "PROPOSAL", "on hold - tarjous": "PROPOSAL",
        "neuvottelu": "PROPOSAL", "proposal": "PROPOSAL",
        "proposal made": "PROPOSAL", "proposal sent": "PROPOSAL",
        "negotiations started": "PROPOSAL", "tarjous lähetetty": "PROPOSAL",
        # Customer
        "customer": "CUSTOMER", "won": "CUSTOMER",
        "green light": "CUSTOMER", "kauppaa tehty": "CUSTOMER",
    }
    resp = requests.get(
        "https://api.pipedrive.com/v1/stages",
        params={"api_token": PIPEDRIVE_TOKEN},
        timeout=30,
    )
    result = {}
    for s in resp.json().get("data") or []:
        name = (s.get("name") or "").strip()
        result[s["id"]] = STAGE_NAME_MAP.get(name.lower(), "NEW")
    return result

# ─────────────────────────────────────────────────────────────────────────────
# DATA HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def safe_str(v) -> Optional[str]:
    if not v:
        return None
    s = str(v).strip()
    return s or None

def safe_url(v) -> Optional[str]:
    if not v:
        return None
    if isinstance(v, dict):
        v = v.get("primaryLinkUrl") or ""
    s = str(v).strip()
    return s or None

def ts(v) -> Optional[datetime]:
    if not v:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(v)[:19], fmt)
        except ValueError:
            pass
    return None

def micros(v) -> Optional[int]:
    if v is None:
        return None
    try:
        if isinstance(v, dict):
            v = v.get("amount", 0)
        return int(float(v) * 1_000_000)
    except (TypeError, ValueError):
        return None

def nested_id(v) -> Optional[int]:
    if v is None:
        return None
    if isinstance(v, dict):
        return v.get("id")
    return v

_h2t = _html2text.HTML2Text()
_h2t.ignore_links = True
_h2t.ignore_images = True
_h2t.body_width = 0

def html_to_markdown(html: str) -> str:
    if not html:
        return ""
    md = _h2t.handle(html)
    md = re.sub(r'\n{3,}', '\n\n', md)
    return md.strip()

def markdown_to_blocknote(markdown: str) -> str:
    """Convert Markdown to BlockNote JSON array (Twenty CRM rich text format)."""
    blocks = []
    for i, line in enumerate(markdown.splitlines()):
        stripped = line.strip()
        block_id = f"block-{i}"
        props = {"textColor": "default", "backgroundColor": "default", "textAlignment": "left"}
        if stripped.startswith(('* ', '- ')):
            text = stripped[2:].strip()
            blocks.append({"id": block_id, "type": "bulletListItem", "props": props,
                            "content": [{"type": "text", "text": text, "styles": {}}], "children": []})
        else:
            text = re.sub(r'\*\*(.*?)\*\*', r'\1', stripped)
            text = re.sub(r'\*(.*?)\*', r'\1', text)
            text = re.sub(r'__(.*?)__', r'\1', text)
            text = re.sub(r'_(.*?)_', r'\1', text)
            blocks.append({"id": block_id, "type": "paragraph", "props": props,
                            "content": ([{"type": "text", "text": text, "styles": {}}] if text else []),
                            "children": []})
    if not blocks:
        blocks = [{"id": "block-0", "type": "paragraph",
                   "props": {"textColor": "default", "backgroundColor": "default", "textAlignment": "left"},
                   "content": [], "children": []}]
    return _json.dumps(blocks)

def note_title(markdown: str) -> str:
    for line in markdown.splitlines():
        line = line.strip().lstrip('#').strip()
        if line:
            if len(line) <= 120:
                return line
            return line[:120].rsplit(' ', 1)[0] + '…'
    return "Note"

def map_stage_id(stage_id: Optional[int], stage_map: dict) -> str:
    if stage_id is None:
        return "NEW"
    return stage_map.get(stage_id, "NEW")

def insert(cur, sql: str, params: tuple) -> int:
    cur.execute("SAVEPOINT sp")
    try:
        cur.execute(sql, params)
        cur.execute("RELEASE SAVEPOINT sp")
        return cur.rowcount
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT sp")
        return 0

# ─────────────────────────────────────────────────────────────────────────────
# DATA MIGRATION
# ─────────────────────────────────────────────────────────────────────────────

def migrate_data(ws: str):
    console.print("\n[bold cyan]Step 4: Migrating Pipedrive data (all records)...[/bold cyan]")

    stage_map = fetch_stages()

    console.print("  [dim]Fetching orgs, persons, deals, leads...[/dim]", end="")
    orgs    = fetch_all_pages("v1/organizations")
    persons = fetch_all_pages("v1/persons")
    deals   = fetch_all_pages("v1/deals")
    leads   = fetch_all_pages("v1/leads")
    console.print(f" [green]{len(orgs)} orgs, {len(persons)} persons, {len(deals)} deals, {len(leads)} leads[/green]")

    # Notes: global paginated fetch (fast, returns all notes with org/deal/person IDs)
    console.print("  [dim]Fetching notes...[/dim]", end="")
    notes = fetch_all_pages("v1/notes")
    console.print(f" [green]{len(notes)}[/green]")

    # Activities: global endpoint returns 0 (Pipedrive limitation) — fetch per deal in parallel
    console.print(f"  [dim]Fetching activities for {len(deals)} deals (parallel)...[/dim]", end="")
    seen_activity_ids: set[int] = set()
    activities: list = []

    def fetch_deal_activities(deal_id: int) -> list:
        return fetch_all_pages(f"v1/deals/{deal_id}/activities")

    completed = 0
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_deal_activities, d["id"]): d["id"] for d in deals}
        for future in as_completed(futures):
            for a in future.result():
                if a["id"] not in seen_activity_ids:
                    seen_activity_ids.add(a["id"])
                    activities.append(a)
            completed += 1
            if completed % 50 == 0:
                console.print(f"\n    [{completed}/{len(deals)} deals, {len(activities)} activities]", end="")
    console.print(f" [green]{len(activities)} activities[/green]")

    with psycopg.connect(NEON_DB_URL) as conn:
        conn.autocommit = False
        cur = conn.cursor()

        # Clear all workspace data (imported + demo/system seed records)
        for t in ["taskTarget", "noteTarget", "task", "note", "opportunity", "person", "company"]:
            cur.execute(f'DELETE FROM "{ws}"."{t}"')

        # ── Companies ──────────────────────────────────────────────────────
        company_map: dict[int, str] = {}
        for org in orgs:
            cid = str(uuid.uuid4())
            rows = insert(cur, f"""
                INSERT INTO "{ws}".company (
                    id, name,
                    "domainNamePrimaryLinkUrl",
                    "addressAddressStreet1",
                    "linkedinLinkPrimaryLinkUrl",
                    "createdAt", "updatedAt",
                    "createdBySource", "updatedBySource"
                ) VALUES (%s,%s,%s,%s,%s,
                    COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                    'IMPORT','IMPORT')
                ON CONFLICT (id) DO NOTHING
            """, (
                cid,
                safe_str(org.get("name")) or "Unknown",
                safe_url(org.get("domain_name") or org.get("website")),
                safe_str(org.get("address")),
                safe_url(org.get("website")),
                ts(org.get("add_time")), ts(org.get("update_time")),
            ))
            if rows:
                company_map[org["id"]] = cid
        console.print(f"  [green]✓ {len(company_map)}/{len(orgs)} companies[/green]")

        # ── People ─────────────────────────────────────────────────────────
        person_map: dict[int, str] = {}
        for p in persons:
            pid = str(uuid.uuid4())
            first = p.get("first_name", "") or ""
            last  = p.get("last_name", "") or ""
            if not last and first and " " in first:
                first, last = first.split(" ", 1)

            emails = p.get("email", [])
            primary_email = None
            if isinstance(emails, list) and emails:
                e = emails[0]
                primary_email = (e.get("value") if isinstance(e, dict) else e) or None
            elif isinstance(emails, str):
                primary_email = emails or None

            phones = p.get("phone", [])
            primary_phone = None
            if isinstance(phones, list) and phones:
                ph = phones[0]
                primary_phone = safe_str(ph.get("value") if isinstance(ph, dict) else ph)

            rows = insert(cur, f"""
                INSERT INTO "{ws}".person (
                    id,
                    "nameFirstName", "nameLastName",
                    "emailsPrimaryEmail",
                    "phonesPrimaryPhoneNumber",
                    "jobTitle", city,
                    "companyId",
                    "createdAt", "updatedAt",
                    "createdBySource", "updatedBySource"
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,
                    COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                    'IMPORT','IMPORT')
                ON CONFLICT (id) DO NOTHING
            """, (
                pid,
                safe_str(first), safe_str(last),
                primary_email, primary_phone,
                safe_str(p.get("title")), safe_str(p.get("city")),
                company_map.get(nested_id(p.get("org_id"))),
                ts(p.get("add_time")), ts(p.get("update_time")),
            ))
            if rows:
                person_map[p["id"]] = pid
        console.print(f"  [green]✓ {len(person_map)}/{len(persons)} people[/green]")

        # ── Opportunities ──────────────────────────────────────────────────
        opp_map: dict[str, str] = {}
        org_to_opps: dict[int, list[str]] = {}
        for d in deals:
            oid = str(uuid.uuid4())
            rows = insert(cur, f"""
                INSERT INTO "{ws}".opportunity (
                    id, name,
                    "amountAmountMicros", "amountCurrencyCode",
                    "closeDate", stage,
                    "pointOfContactId", "companyId",
                    "createdAt", "updatedAt",
                    "createdBySource", "updatedBySource"
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,
                    COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                    'IMPORT','IMPORT')
                ON CONFLICT (id) DO NOTHING
            """, (
                oid,
                safe_str(d.get("title")) or "Untitled",
                micros(d.get("value")), d.get("currency", "EUR"),
                d.get("expected_close_date"),
                map_stage_id(d.get("stage_id"), stage_map),
                person_map.get(nested_id(d.get("person_id"))),
                company_map.get(nested_id(d.get("org_id"))),
                ts(d.get("add_time")), ts(d.get("update_time")),
            ))
            if rows:
                opp_map[f"deal_{d['id']}"] = oid
                org_id = nested_id(d.get("org_id"))
                if org_id:
                    org_to_opps.setdefault(org_id, []).append(oid)

        for l in leads:
            oid = str(uuid.uuid4())
            rows = insert(cur, f"""
                INSERT INTO "{ws}".opportunity (
                    id, name,
                    "amountAmountMicros", "amountCurrencyCode",
                    stage,
                    "pointOfContactId", "companyId",
                    "createdAt", "updatedAt",
                    "createdBySource", "updatedBySource"
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,
                    COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                    'IMPORT','IMPORT')
                ON CONFLICT (id) DO NOTHING
            """, (
                oid,
                safe_str(l.get("title")) or "Untitled",
                micros(l.get("value")), "EUR",
                "NEW",
                person_map.get(nested_id(l.get("person_id"))),
                company_map.get(nested_id(l.get("organization_id"))),
                ts(l.get("created_at")), ts(l.get("updated_at")),
            ))
            if rows:
                opp_map[str(l["id"])] = oid
                org_id = nested_id(l.get("organization_id"))
                if org_id:
                    org_to_opps.setdefault(org_id, []).append(oid)
        console.print(f"  [green]✓ {len(opp_map)}/{len(deals)+len(leads)} opportunities[/green]")

        # ── Notes ──────────────────────────────────────────────────────────
        note_count = 0
        for n in notes:
            nid = str(uuid.uuid4())
            content = html_to_markdown(n.get("content") or "")
            title = note_title(content)
            rows = insert(cur, f"""
                INSERT INTO "{ws}".note (
                    id, title, "bodyV2Markdown", "bodyV2Blocknote",
                    "createdAt", "updatedAt",
                    "createdBySource", "updatedBySource"
                ) VALUES (%s,%s,%s,%s,
                    COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                    'IMPORT','IMPORT')
                ON CONFLICT (id) DO NOTHING
            """, (nid, title, content, markdown_to_blocknote(content),
                  ts(n.get("add_time")), ts(n.get("update_time"))))
            if not rows:
                continue
            note_count += 1
            co = company_map.get(n.get("org_id"))
            pe = person_map.get(n.get("person_id"))
            op = opp_map.get(f"deal_{n.get('deal_id')}") if n.get("deal_id") else None
            org_opps = org_to_opps.get(n.get("org_id"), []) if not op else []
            target_opps = [op] if op else (org_opps or [None])
            for target_op in target_opps:
                if not (co or pe or target_op):
                    continue
                insert(cur, f"""
                    INSERT INTO "{ws}"."noteTarget" (
                        id, "noteId",
                        "targetCompanyId", "targetPersonId", "targetOpportunityId"
                    ) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING
                """, (str(uuid.uuid4()), nid, co, pe, target_op))
        console.print(f"  [green]✓ {note_count}/{len(notes)} notes[/green]")

        # ── Tasks ──────────────────────────────────────────────────────────
        task_count = 0
        for a in activities:
            tid = str(uuid.uuid4())
            due_date = a.get("due_date")
            due_time = a.get("due_time")
            due_at = None
            if due_date:
                try:
                    dt_str = f"{due_date} {due_time}" if due_time else f"{due_date} 00:00:00"
                    due_at = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
                except Exception:
                    pass
            status = "DONE" if a.get("done", False) else "TODO"
            task_body = html_to_markdown(a.get("note") or "") or None
            rows = insert(cur, f"""
                INSERT INTO "{ws}".task (
                    id, title, "bodyV2Markdown", "bodyV2Blocknote",
                    "dueAt", status,
                    "createdAt", "updatedAt",
                    "createdBySource", "updatedBySource"
                ) VALUES (%s,%s,%s,%s,%s,%s,
                    COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                    'IMPORT','IMPORT')
                ON CONFLICT (id) DO NOTHING
            """, (
                tid,
                safe_str(a.get("subject")) or "Task",
                task_body,
                markdown_to_blocknote(task_body) if task_body else None,
                due_at, status,
                ts(a.get("add_time")), ts(a.get("update_time")),
            ))
            if not rows:
                continue
            task_count += 1
            co = company_map.get(a.get("org_id"))
            pe = person_map.get(a.get("person_id"))
            op = opp_map.get(f"deal_{a.get('deal_id')}") if a.get("deal_id") else None
            org_opps = org_to_opps.get(a.get("org_id"), []) if not op else []
            target_opps = [op] if op else (org_opps or [None])
            for target_op in target_opps:
                if not (co or pe or target_op):
                    continue
                insert(cur, f"""
                    INSERT INTO "{ws}"."taskTarget" (
                        id, "taskId",
                        "targetCompanyId", "targetPersonId", "targetOpportunityId"
                    ) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING
                """, (str(uuid.uuid4()), tid, co, pe, target_op))
        console.print(f"  [green]✓ {task_count}/{len(activities)} tasks[/green]")

        conn.commit()

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    console.print(Panel(
        "[bold]Webso CRM Setup[/bold]\n"
        "pekka@webso.fi · Pipedrive → Twenty\n"
        "[yellow]Full migration · Full DB reset[/yellow]",
        title="Setup"
    ))

    if not NEON_DB_URL:
        console.print("[red]PG_DATABASE_URL not set in .env[/red]")
        sys.exit(1)
    if not PIPEDRIVE_TOKEN:
        console.print("[red]PIPEDRIVE_API_TOKEN not set in .env[/red]")
        sys.exit(1)

    def cleanup(sig=None, frame=None):
        stop_server()
        sys.exit(0)
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    try:
        reset_database()
        start_server()
        wait_for_server()
        access_token, workspace_id = create_workspace()
        rename_workspace(access_token)
        ws_schema = get_workspace_schema(workspace_id)
        stop_server()

        console.print(f"\n[dim]Workspace schema: {ws_schema}[/dim]")
        migrate_data(ws_schema)

    except Exception as e:
        console.print(f"\n[red]Error: {e}[/red]")
        stop_server()
        raise

    console.print(Panel(
        "[bold green]Setup complete![/bold green]\n\n"
        f"Workspace : [cyan]{WORKSPACE_NAME}[/cyan]\n"
        f"User      : [cyan]{PEKKA_EMAIL}[/cyan] / [cyan]{PEKKA_PASSWORD}[/cyan]\n\n"
        "Start the app:\n"
        "  [bold]npx nx start twenty-server[/bold]\n"
        "  [bold]npx nx start twenty-front[/bold]",
        title="Done"
    ))

if __name__ == "__main__":
    main()
