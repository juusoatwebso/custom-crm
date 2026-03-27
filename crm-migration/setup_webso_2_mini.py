#!/usr/bin/env python3
"""
Webso CRM Mini Migration  (setup_webso_2_mini.py)
Pipedrive → Twenty CRM  —  end-to-end setup + data migration

1. Resets the Twenty database (no demo/seed data)
2. Starts the Twenty server
3. Creates a "Webso" workspace with pekka@webso.fi
4. Stops the server
5. Migrates Pipedrive data (top N orgs) via direct SQL

Usage:
  python setup_webso_2_mini.py              # full reset + migrate top 25 orgs
  python setup_webso_2_mini.py --size 50    # larger sample
  python setup_webso_2_mini.py --no-reset   # skip DB reset + workspace creation
  python setup_webso_2_mini.py --dry-run    # count only, no writes
  python setup_webso_2_mini.py --local      # use local DB instead of Neon
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
from html.parser import HTMLParser
from pathlib import Path

import psycopg
import requests
from dotenv import load_dotenv

load_dotenv()
DATA_DIR = Path(__file__).parent / "data"
SERVER_DIR = str(Path(__file__).resolve().parent.parent / "packages" / "twenty-server")
SERVER_URL = "http://localhost:3000"

PEKKA_EMAIL    = "pekka@webso.fi"
PEKKA_PASSWORD = "Pekka123"
WORKSPACE_NAME = "Webso"

# ── Database Reset ────────────────────────────────────────────────────────────

def reset_database():
    print("\n  Step 1: Resetting database (full wipe)...")
    steps = [
        ("Dropping schemas",    ["npx", "nx", "ts-node-no-deps-transpile-only", "--", "./scripts/truncate-db.ts"]),
        ("Creating core schema",["npx", "nx", "ts-node-no-deps-transpile-only", "--", "./scripts/setup-db.ts"]),
        ("Running migrations",  ["npx", "nx", "database:migrate", "twenty-server"]),
    ]
    for label, cmd in steps:
        print(f"    {label}...", end="", flush=True)
        result = subprocess.run(cmd, cwd=SERVER_DIR, capture_output=True, text=True, timeout=180)
        if result.returncode != 0:
            print(" FAILED")
            print(f"    {result.stderr[-500:]}")
            sys.exit(1)
        print(" ✓")

# ── Server Management ─────────────────────────────────────────────────────────

_server_process = None

def start_server():
    global _server_process
    print("\n  Step 2: Starting Twenty server...")
    _server_process = subprocess.Popen(
        ["node", "dist/main.js"], cwd=SERVER_DIR,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

def wait_for_server(timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(f"{SERVER_URL}/healthz", timeout=3)
            if r.status_code == 200:
                print("    ✓ Server ready")
                return
        except requests.exceptions.RequestException:
            pass
        time.sleep(2)
    print("    ✗ Server did not start in time")
    stop_server()
    sys.exit(1)

def stop_server():
    global _server_process
    if _server_process:
        _server_process.terminate()
        try: _server_process.wait(timeout=10)
        except subprocess.TimeoutExpired: _server_process.kill()
        _server_process = None
        print("    Server stopped")

# ── GraphQL / Workspace Creation ──────────────────────────────────────────────

def gql(query, variables=None, token=None, timeout=30):
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    endpoint = "/metadata" if any(m in query for m in [
        "signUp", "signIn", "signUpInNewWorkspace", "getAuthTokensFromLoginToken",
        "updateWorkspace", "activateWorkspace", "assignRole",
    ]) else "/graphql"
    resp = requests.post(f"{SERVER_URL}{endpoint}", json={"query": query, "variables": variables or {}},
                         headers=headers, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data: raise RuntimeError(f"GraphQL error: {data['errors']}")
    return data["data"]

def get_workspace_schema_name(workspace_id):
    n = int(workspace_id.replace("-", ""), 16)
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    base36 = ""
    while n:
        n, r = divmod(n, 36)
        base36 = chars[r] + base36
    return f"workspace_{base36}"

def create_workspace(db_url):
    print("\n  Step 3: Creating Webso workspace...")

    print(f"    Signing up {PEKKA_EMAIL}...", end="", flush=True)
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
        print(" (user exists, signing in)", end="", flush=True)
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
    existing = ws_obj.get("availableWorkspacesForSignIn", []) + ws_obj.get("availableWorkspacesForSignUp", [])
    print(" ✓")

    if existing:
        ws = existing[0]
        workspace_id = ws["id"]
        login_token = ws["loginToken"]
        print(f"    Found existing workspace {workspace_id[:8]}...", end="", flush=True)
        with psycopg.connect(db_url) as conn:
            row = conn.execute('SELECT "activationStatus" FROM core.workspace WHERE id = %s', (workspace_id,)).fetchone()
        if row and row[0] == "ACTIVE":
            print(" ✓ already ACTIVE")
            ws_tokens = gql("""
                mutation GetTokens($loginToken: String!) {
                    getAuthTokensFromLoginToken(loginToken: $loginToken, origin: "http://localhost:3001") {
                        tokens { accessOrWorkspaceAgnosticToken { token } }
                    }
                }
            """, {"loginToken": login_token})
            access_token = ws_tokens["getAuthTokensFromLoginToken"]["tokens"]["accessOrWorkspaceAgnosticToken"]["token"]
            return access_token, workspace_id
        print(" not yet ACTIVE, waiting...")
    else:
        print("    Creating new workspace...", end="", flush=True)
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
        print(f" ✓ {workspace_id[:8]}...")

        print("    Activating workspace...", end="", flush=True)
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
        print(" ✓")

    print("    Waiting for workspace initialization", end="", flush=True)
    deadline = time.time() + 60
    while time.time() < deadline:
        with psycopg.connect(db_url) as conn:
            row = conn.execute('SELECT "activationStatus" FROM core.workspace WHERE id = %s', (workspace_id,)).fetchone()
        if row and row[0] == "ACTIVE":
            print(" ✓")
            break
        time.sleep(1)
        print(".", end="", flush=True)
    else:
        print(" TIMEOUT — workspace never became ACTIVE")
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

    try:
        gql("""
            mutation UpdateWorkspace($data: UpdateWorkspaceInput!) {
                updateWorkspace(data: $data) { id displayName }
            }
        """, {"data": {"displayName": WORKSPACE_NAME}}, token=access_token)
        print(f"    Workspace renamed to '{WORKSPACE_NAME}' ✓")
    except Exception:
        pass

    return access_token, workspace_id

# ── Constants (same as setup_webso_2.py) ─────────────────────────────────────

NAMESPACE = uuid.UUID("b7e5a3c1-2d4f-4e8a-9b1c-3f7d2e6a8b4c")
def pd_uuid(entity, pd_id): return str(uuid.uuid5(NAMESPACE, f"webso:{entity}:{pd_id}"))

PD_USERS = {
    14953693: {"name": "Aleksi Puttonen",  "email": "aleksi@webso.fi"},
    23011193: {"name": "Buukkarit",         "email": "myynti@webso.fi"},
    21113836: {"name": "Mikko Mattinen",    "email": "mikko.mattinen@webso.fi"},
    20319999: {"name": "Jimi Hiltunen",     "email": "jimi@webso.fi"},
    16135335: {"name": "Juho",              "email": "juho@webso.fi"},
    30071928: {"name": "Juuso Käyhkö",      "email": "juuso@webso.fi"},
    14953726: {"name": "Matias Nieminen",   "email": "matias@webso.fi"},
    14953704: {"name": "Pekka Mattinen",    "email": "pekka@webso.fi"},
    14953715: {"name": "Roope Lassila",     "email": "roope@webso.fi"},
    22319227: {"name": "Sampo Puheloinen",  "email": "sampo@webso.fi"},
    17287783: {"name": "Sauli",             "email": "sauli@webso.fi"},
}
STAGE_MAP = {
    7:("UP-SELL","Keskustelu avattu","UPSELL_KESKUSTELU_AVATTU"),
    8:("UP-SELL","Tarjous","UPSELL_TARJOUS"),
    26:("UP-SELL","On Hold - Tarjous","UPSELL_ON_HOLD"),
    9:("UP-SELL","Neuvottelu","UPSELL_NEUVOTTELU"),
    10:("Oma myynti","Palaveerattu (Icebox)","OMA_PALAVEERATTU_ICEBOX"),
    43:("Oma myynti","Soittoon","OMA_SOITTOON"),
    11:("Oma myynti","Uudet palaverit","OMA_UUDET_PALAVERIT"),
    36:("Oma myynti","Jatkopalsut","OMA_JATKOPALSUT"),
    25:("Oma myynti","On Hold","OMA_ON_HOLD"),
    12:("Oma myynti","Proposal Made","OMA_PROPOSAL_MADE"),
    13:("Oma myynti","Negotiations Started","OMA_NEGOTIATIONS_STARTED"),
    14:("Sellai","Prospect","SELLAI_PROSPECT"),
    15:("Sellai","Tried to contact","SELLAI_TRIED_TO_CONTACT"),
    16:("Sellai","Value communicated","SELLAI_VALUE_COMMUNICATED"),
    17:("Sellai","Meeting arranged","SELLAI_MEETING_ARRANGED"),
    18:("Sellai","Proposal sent","SELLAI_PROPOSAL_SENT"),
    19:("Sellai","Green light","SELLAI_GREEN_LIGHT"),
    27:("Alihankinta yritykset","Pekka ollu yhteydessä.","ALI_PEKKA_YHTEYDESSA"),
    28:("Alihankinta yritykset","Value communicated","ALI_VALUE_COMMUNICATED"),
    29:("Alihankinta yritykset","Palaveerattu","ALI_PALAVEERATTU"),
    30:("Alihankinta yritykset","Tarjous lähetetty","ALI_TARJOUS_LAHETETTY"),
    31:("Alihankinta yritykset","Kauppaa tehty","ALI_KAUPPAA_TEHTY"),
    37:("Alihankinta yritykset","Epämiellyttävät","ALI_EPAMIELLYTTAVAT"),
    32:("Alihankinta - Bodyshop","Potentiaali","BODYSHOP_POTENTIAALI"),
    33:("Alihankinta - Bodyshop","CV Lähtetty","BODYSHOP_CV_LAHETETTY"),
    34:("Alihankinta - Bodyshop","Haastattelu","BODYSHOP_HAASTATTELU"),
    35:("Alihankinta - Bodyshop","Neuvottelu","BODYSHOP_NEUVOTTELU"),
}
ORG_CF = {
    "virallinen_nimi":"a233077bb653400c6a6fcfebb3851cd4dd039915",
    "ytunnus":"931425dd4a675487146add0d454d2927ce41f2fc",
    "henkilokunta":"8e248eb04d03c62894bc34a39a7a395ae5a007fa",
    "liikevaihto":"312b2fa7cef1b39558d40e2b64e659ccf8993680",
    "perustettu":"af0ff61c2117c518fd67862bca60dc006cf24eb5",
    "www":"8c93d48db9e4713a692d2193a3041ceeaeb79aee",
    "paatoimiala_tol":"54fb878d1bed7f4ece48ca37be3d9102672e0c4e",
    "paatoimiala_pf":"d0ddd72ec2c009bd6d74ff88f3fbb1831bcf6125",
    "markkinointinimi":"19396b4979bfbc4d1dff20bd4e18934709d069ea",
}
PERSON_CF = {
    "title_en":"4c9293737b1fa9399cb4eeb5c36c5391bc10bddd",
    "title_fi":"e629f88dd960275ca6aadfe10ff8608578433f5c",
}
DEAL_CF = {"drive":"27d4af5421c600368b825b433bae74c2691e19a9"}
ACTIVITY_TYPE_MAP = {
    "call":"CALL","meeting":"MEETING","email":"EMAIL",
    "unanswered_call":"UNANSWERED_CALL","task":"TASK","deadline":"DEADLINE",
    "lunch":"LUNCH","buukkaus":"BUUKKAUS","peruttu_palaveri":"PERUTTU_PALAVERI",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

class _S(HTMLParser):
    B = {"p","br","li","div","h1","h2","h3","h4","tr","td"}
    def __init__(self): super().__init__(); self._p=[]
    def handle_data(self,d): self._p.append(d)
    def handle_starttag(self,t,a):
        if t in self.B: self._p.append("\n")
    def r(self): return re.sub(r"\n{3,}","\n\n","".join(self._p)).strip()

def html_to_text(h):
    if not h: return ""
    if "<" not in h: return h.strip()
    s=_S(); s.feed(h); return s.r()

def j(o): return None if o is None else json.dumps(o, ensure_ascii=False)

def to_iso(ts):
    if not ts: return None
    ts=str(ts)
    if "T" in ts: return ts if ts.endswith("Z") else ts+"Z"
    return ts.replace(" ","T")+"Z"

def map_stage(deal):
    if deal.get("status")=="won":  return "WON","Won","–"
    if deal.get("status")=="lost": return "LOST","Lost","–"
    e=STAGE_MAP.get(deal.get("stage_id"))
    return (e[2],e[1],e[0]) if e else ("OMA_PALAVEERATTU_ICEBOX","Palaveerattu (Icebox)","Oma myynti")

def normalize_phones(phones):
    if not phones:
        return {"primaryPhoneNumber":"","primaryPhoneCountryCode":"FI","primaryPhoneCallingCode":"+358","additionalPhones":[]}
    def parse(e):
        n=(e.get("value") or "").strip()
        if n.startswith("+358"): return n,"FI","+358"
        if n.startswith("+46"):  return n,"SE","+46"
        if n.startswith("+44"):  return n,"GB","+44"
        if n.startswith("+1"):   return n,"US","+1"
        if n.startswith("+"):    return n,"",n[:4]
        return n,"FI","+358"
    p=next((x for x in phones if x.get("primary")),phones[0])
    others=[x for x in phones if x is not p and (x.get("value") or "").strip()]
    pn,pcc,pca=parse(p)
    return {"primaryPhoneNumber":pn,"primaryPhoneCountryCode":pcc,"primaryPhoneCallingCode":pca,
            "additionalPhones":[{"number":n,"countryCode":cc,"callingCode":ca} for n,cc,ca in (parse(x) for x in others) if n]}

def normalize_emails(emails):
    if not emails: return {"primaryEmail":"","additionalEmails":[]}
    p=next((e for e in emails if e.get("primary")),emails[0])
    return {"primaryEmail":p.get("value",""),"additionalEmails":[e["value"] for e in emails if e is not p and e.get("value")]}

def normalize_address(addr):
    if not addr or not isinstance(addr,dict): return None
    street=" ".join(filter(None,[addr.get("route"),addr.get("street_number")])).strip()
    if not street: street=(addr.get("value") or "").split(",")[0].strip()
    city=addr.get("locality") or addr.get("admin_area_level_2")
    if not any([street,city,addr.get("country")]): return None
    return {k:v for k,v in {"addressStreet1":street or None,"addressStreet2":addr.get("subpremise") or None,
        "addressCity":city or None,"addressState":addr.get("admin_area_level_1") or None,
        "addressZipCode":addr.get("postal_code") or None,"addressCountry":addr.get("country") or None,
        "addressLat":addr.get("lat"),"addressLng":addr.get("lng")}.items() if v is not None}

def note_title(c):
    t=html_to_text(c or ""); f=t.split("\n")[0].strip()
    return (f[:80]+"…" if len(f)>80 else f) or "Note"

def parse_due(d,t):
    if not d: return None
    hhmm=(t or "00:00").replace(":",""); h=hhmm[:2] if len(hhmm)>=2 else "00"; m=hhmm[2:4] if len(hhmm)>=4 else "00"
    return f"{d}T{h}:{m}:00Z"

def make_actor(pid, mm):
    u=PD_USERS.get(pid,{})
    return {"source":"IMPORT","workspaceMemberId":mm.get(u.get("email","")),"name":u.get("name","Pipedrive Migration"),"context":{}}

def load_json(name):
    with open(DATA_DIR/"raw"/f"{name}.json",encoding="utf-8") as f: return json.load(f)

# ── DB ────────────────────────────────────────────────────────────────────────

def get_schema(conn):
    row=conn.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'workspace_%' ORDER BY schema_name LIMIT 1").fetchone()
    if not row: raise RuntimeError("No workspace schema found.")
    return row[0]

def get_columns(conn,schema,table):
    return {r[0] for r in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s",(schema,table)).fetchall()}

def get_stage_enum_labels(conn,schema):
    """Return set of allowed stage values for opportunity.stage in this workspace."""
    row=conn.execute("SELECT c.udt_schema,c.udt_name FROM information_schema.columns c WHERE c.table_schema=%s AND c.table_name=%s AND c.column_name=%s",(schema,"opportunity","stage")).fetchone()
    if not row: return set()
    udt_schema,udt_name=row
    rows=conn.execute("SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid JOIN pg_namespace n ON t.typnamespace=n.oid WHERE n.nspname=%s AND t.typname=%s ORDER BY e.enumsortorder",(udt_schema,udt_name)).fetchall()
    return {r[0] for r in rows}

def coerce_stage(stage,allowed):
    """Map stage to a value in allowed; fallback for default Twenty (NEW, CUSTOMER, etc.)."""
    if stage in allowed: return stage
    fallback_won = "CUSTOMER" if "CUSTOMER" in allowed else (next(iter(allowed)) if allowed else "NEW")
    fallback_lost = "NEW" if "NEW" in allowed else (next(iter(allowed)) if allowed else "NEW")
    fallback_other = "NEW" if "NEW" in allowed else (next(iter(allowed)) if allowed else "NEW")
    if stage == "WON": return fallback_won
    if stage == "LOST": return fallback_lost
    if stage == "LEAD": return fallback_other
    return fallback_other

def get_member_map(conn,schema):
    try: return {r[1]:str(r[0]) for r in conn.execute(f'SELECT id,"userEmail" FROM {schema}."workspaceMember"').fetchall() if r[1]}
    except Exception: return {}

def ins(conn,schema,table,vals,dry_run):
    if dry_run: return
    cols=list(vals.keys()); col_sql=", ".join(f'"{c}"' for c in cols); ph=", ".join(["%s"]*len(cols))
    conn.execute(f'INSERT INTO {schema}."{table}" ({col_sql}) VALUES ({ph}) ON CONFLICT (id) DO NOTHING',list(vals.values()))

# ── Slice ─────────────────────────────────────────────────────────────────────

def select_slice(orgs, persons, deals, leads, notes, activities, deal_flows, size):
    scores = {}
    for d in deals:
        if d.get("org_id"): scores[d["org_id"]] = scores.get(d["org_id"],0)+3
    for n in notes:
        if n.get("org_id"): scores[n["org_id"]] = scores.get(n["org_id"],0)+2
    for a in activities:
        if a.get("org_id"): scores[a["org_id"]] = scores.get(a["org_id"],0)+1
    s_orgs    = sorted(orgs, key=lambda o: scores.get(o["id"],0), reverse=True)[:size]
    org_ids   = {o["id"] for o in s_orgs}
    s_persons = [p for p in persons if p.get("org_id") in org_ids]
    person_ids= {p["id"] for p in s_persons}
    s_deals   = [d for d in deals if d.get("org_id") in org_ids]
    s_leads   = [l for l in leads if l.get("organization_id") in org_ids]
    deal_ids  = {d["id"] for d in s_deals}
    lead_ids  = {l["id"] for l in s_leads}
    s_notes   = [n for n in notes if n.get("org_id") in org_ids or n.get("person_id") in person_ids or n.get("deal_id") in deal_ids or n.get("lead_id") in lead_ids]
    s_acts    = [a for a in activities if a.get("org_id") in org_ids or a.get("person_id") in person_ids or a.get("deal_id") in deal_ids or a.get("lead_id") in lead_ids]
    s_flows   = {str(k):v for k,v in deal_flows.items() if int(k) in deal_ids}
    return s_orgs, s_persons, s_deals, s_leads, s_notes, s_acts, s_flows

# ── Phases (identical logic to setup_webso_2.py) ─────────────────────────────

def phase_a(conn,schema,orgs,mm,dry_run):
    existing=get_columns(conn,schema,"company")
    cf_map={col:key for col,key in {"ytunnus":ORG_CF["ytunnus"],"virallinen_nimi":ORG_CF["virallinen_nimi"],
        "henkilokunta":ORG_CF["henkilokunta"],"liikevaihto":ORG_CF["liikevaihto"],"perustettu":ORG_CF["perustettu"],
        "paatoimiala_tol":ORG_CF["paatoimiala_tol"],"paatoimiala_pf":ORG_CF["paatoimiala_pf"],
        "markkinointinimi":ORG_CF["markkinointinimi"]}.items() if col in existing}
    has_pd="pipedriveId" in existing; n=0
    for i,org in enumerate(orgs):
        cf=org.get("custom_fields") or {}; actor=j(make_actor(org.get("owner_id"),mm))
        www=cf.get(ORG_CF["www"]) or org.get("website")
        vals={"id":pd_uuid("org",org["id"]),"name":org["name"],
            "domainName":j({"primaryLinkLabel":"","primaryLinkUrl":www,"secondaryLinks":[]}) if www else None,
            "address":j(normalize_address(org.get("address"))),
            "annualRecurringRevenue":j({"amountMicros":int(float(org["annual_revenue"]))*1_000_000,"currencyCode":"EUR"}) if org.get("annual_revenue") else None,
            "createdAt":to_iso(org["add_time"]),"updatedAt":to_iso(org["update_time"]),
            "deletedAt":to_iso(org["update_time"]) if org.get("is_deleted") else None,
            "position":float(i+1),"createdBy":actor,"updatedBy":actor}
        for col,key in cf_map.items(): vals[col]=cf.get(key)
        if has_pd: vals["pipedriveId"]=org["id"]
        ins(conn,schema,"company",{k:v for k,v in vals.items() if k in existing},dry_run); n+=1
    print(f"    {'[dry]' if dry_run else '✓'} {n} companies"); return n

def phase_b(conn,schema,persons,mm,dry_run):
    existing=get_columns(conn,schema,"person"); has_title="title" in existing; has_pd="pipedriveId" in existing; n=0
    for i,p in enumerate(persons):
        cf=p.get("custom_fields") or {}; actor=j(make_actor(p.get("owner_id"),mm))
        first=p.get("first_name") or (p.get("name") or "").split()[0]
        last=p.get("last_name") or " ".join((p.get("name") or "").split()[1:]) or None
        title=cf.get(PERSON_CF["title_en"]) or cf.get(PERSON_CF["title_fi"])
        vals={"id":pd_uuid("person",p["id"]),"name":j({"firstName":first,"lastName":last}),
            "emails":j(normalize_emails(p.get("emails") or [])),"phones":j(normalize_phones(p.get("phones") or [])),
            "jobTitle":title,"companyId":pd_uuid("org",p["org_id"]) if p.get("org_id") else None,
            "createdAt":to_iso(p["add_time"]),"updatedAt":to_iso(p["update_time"]),
            "deletedAt":to_iso(p["update_time"]) if p.get("is_deleted") else None,
            "position":float(i+1),"createdBy":actor,"updatedBy":actor}
        if has_title: vals["title"]=title
        if has_pd: vals["pipedriveId"]=p["id"]
        ins(conn,schema,"person",{k:v for k,v in vals.items() if k in existing},dry_run); n+=1
    print(f"    {'[dry]' if dry_run else '✓'} {n} people"); return n

def phase_c(conn,schema,deals,mm,dry_run,person_ids=None):
    person_ids=person_ids or set()
    existing=get_columns(conn,schema,"opportunity"); allowed_stages=get_stage_enum_labels(conn,schema)
    opp_cf={col for col in ["pipelineName","pipelineStage","lostReason","probability","stageChangedAt","wonAt","lostAt","origin","drive","isLead","pipedriveId"] if col in existing}
    n=0
    for i,d in enumerate(deals):
        cf=d.get("custom_fields") or {}; actor=j(make_actor(d.get("creator_user_id"),mm)); sv,sl,pn=map_stage(d)
        stage_ok=coerce_stage(sv,allowed_stages)
        owner_id=mm.get(PD_USERS.get(d.get("owner_id"),{}).get("email",""))
        close=d.get("expected_close_date") or (to_iso(d["close_time"])[:10] if d.get("close_time") else None)
        poc_id=d.get("person_id")
        point_of_contact=pd_uuid("person",poc_id) if poc_id and poc_id in person_ids else None
        vals={"id":pd_uuid("deal",d["id"]),"name":d["title"],"stage":stage_ok,"closeDate":close,
            "amount":j({"amountMicros":int(float(d.get("value") or 0))*1_000_000,"currencyCode":d.get("currency","EUR")}),
            "companyId":pd_uuid("org",d["org_id"]) if d.get("org_id") else None,
            "pointOfContactId":point_of_contact,
            "ownerId":owner_id,"createdAt":to_iso(d["add_time"]),"updatedAt":to_iso(d["update_time"]),
            "deletedAt":to_iso(d["update_time"]) if d.get("is_deleted") else None,
            "position":float(i+1),"createdBy":actor,"updatedBy":actor}
        cf_data={"pipelineName":pn,"pipelineStage":sl,"lostReason":d.get("lost_reason"),"probability":d.get("probability"),
            "stageChangedAt":to_iso(d.get("stage_change_time")),"wonAt":to_iso(d.get("won_time")),"lostAt":to_iso(d.get("lost_time")),
            "origin":d.get("origin"),"drive":cf.get(DEAL_CF["drive"]),"isLead":False,"pipedriveId":str(d["id"])}
        for col in opp_cf: vals[col]=cf_data[col]
        ins(conn,schema,"opportunity",{k:v for k,v in vals.items() if k in existing},dry_run); n+=1
    print(f"    {'[dry]' if dry_run else '✓'} {n} opportunities (deals)"); return n

def phase_d(conn,schema,leads,mm,dry_run,person_ids=None):
    person_ids=person_ids or set()
    existing=get_columns(conn,schema,"opportunity"); allowed_stages=get_stage_enum_labels(conn,schema)
    opp_cf={col for col in ["pipelineName","pipelineStage","isLead","origin","pipedriveId"] if col in existing}
    lead_stage=coerce_stage("LEAD",allowed_stages)
    n=0
    for i,lead in enumerate(leads):
        actor=j(make_actor(lead.get("creator_id"),mm)); owner_id=mm.get(PD_USERS.get(lead.get("owner_id"),{}).get("email",""))
        vo=lead.get("value"); amount=j({"amountMicros":int(vo["amount"])*1_000_000,"currencyCode":vo.get("currency","EUR")}) if isinstance(vo,dict) and vo.get("amount") else None
        poc_id=lead.get("person_id")
        point_of_contact=pd_uuid("person",poc_id) if poc_id and poc_id in person_ids else None
        vals={"id":pd_uuid("lead",lead["id"]),"name":lead["title"],"stage":lead_stage,"closeDate":lead.get("expected_close_date"),
            "amount":amount,"companyId":pd_uuid("org",lead["organization_id"]) if lead.get("organization_id") else None,
            "pointOfContactId":point_of_contact,
            "ownerId":owner_id,"createdAt":to_iso(lead["add_time"]),"updatedAt":to_iso(lead["update_time"]),
            "deletedAt":to_iso(lead.get("archive_time")) if lead.get("is_archived") else None,
            "position":float(i+1),"createdBy":actor,"updatedBy":actor}
        cf_data={"pipelineName":"Leads","pipelineStage":"Lead","isLead":True,"origin":lead.get("source_name"),"pipedriveId":str(lead["id"])}
        for col in opp_cf: vals[col]=cf_data[col]
        ins(conn,schema,"opportunity",{k:v for k,v in vals.items() if k in existing},dry_run); n+=1
    print(f"    {'[dry]' if dry_run else '✓'} {n} opportunities (leads)"); return n

def phase_e(conn,schema,notes,mm,dry_run,org_ids=None,person_ids=None,deal_ids=None,lead_ids=None):
    org_ids=org_ids or set(); person_ids=person_ids or set()
    deal_ids=deal_ids or set(); lead_ids=lead_ids or set()
    note_cols=get_columns(conn,schema,"note"); nt_cols=get_columns(conn,schema,"noteTarget")
    n_n=n_t=0
    for i,note in enumerate(notes):
        uid=pd_uuid("note",note["id"]); actor=j(make_actor(note.get("user_id"),mm)); text=html_to_text(note.get("content"))
        note_vals={"id":uid,"title":note_title(note.get("content")),"bodyV2":j({"blocknote":None,"markdown":text}),
            "position":float(i+1),"createdAt":to_iso(note["add_time"]),"updatedAt":to_iso(note["update_time"]),
            "createdBy":actor,"updatedBy":actor}
        ins(conn,schema,"note",{k:v for k,v in note_vals.items() if k in note_cols},dry_run); n_n+=1
        targets=[]
        if note.get("org_id")    and note["org_id"]    in org_ids:    targets.append(("targetCompanyId",    pd_uuid("org",    note["org_id"])))
        if note.get("person_id") and note["person_id"] in person_ids: targets.append(("targetPersonId",     pd_uuid("person", note["person_id"])))
        if note.get("deal_id")   and note["deal_id"]   in deal_ids:   targets.append(("targetOpportunityId",pd_uuid("deal",   note["deal_id"])))
        elif note.get("lead_id") and note["lead_id"]   in lead_ids:   targets.append(("targetOpportunityId",pd_uuid("lead",   note["lead_id"])))
        for col,fk in targets:
            nt_vals={"id":pd_uuid("note_target",f"{note['id']}_{col}"),"noteId":uid,col:fk,
                "createdAt":to_iso(note["add_time"]),"updatedAt":to_iso(note["update_time"])}
            ins(conn,schema,"noteTarget",{k:v for k,v in nt_vals.items() if k in nt_cols},dry_run); n_t+=1
    print(f"    {'[dry]' if dry_run else '✓'} {n_n} notes, {n_t} noteTargets"); return n_n,n_t

def phase_f(conn,schema,activities,mm,dry_run,org_ids=None,person_ids=None,deal_ids=None,lead_ids=None):
    org_ids=org_ids or set(); person_ids=person_ids or set()
    deal_ids=deal_ids or set(); lead_ids=lead_ids or set()
    existing=get_columns(conn,schema,"task"); tt_cols=get_columns(conn,schema,"taskTarget")
    has_at="activityType" in existing; has_dur="duration" in existing; has_pd="pipedriveId" in existing
    n_t=n_tg=0
    for i,act in enumerate(activities):
        uid=pd_uuid("activity",act["id"]); actor=j(make_actor(act.get("creator_user_id"),mm)); text=html_to_text(act.get("note"))
        assignee=mm.get(PD_USERS.get(act.get("owner_id"),{}).get("email",""))
        vals={"id":uid,"title":act.get("subject") or "Activity","status":"DONE" if act.get("done") else "TODO",
            "dueAt":parse_due(act.get("due_date"),act.get("due_time")),"bodyV2":j({"blocknote":None,"markdown":text}) if text else None,
            "assigneeId":assignee,"position":float(i+1),"createdAt":to_iso(act["add_time"]),"updatedAt":to_iso(act["update_time"]),
            "createdBy":actor,"updatedBy":actor}
        if has_at:  vals["activityType"]=ACTIVITY_TYPE_MAP.get(act.get("type",""),"TASK")
        if has_dur: vals["duration"]=act.get("duration")
        if has_pd:  vals["pipedriveId"]=act["id"]
        ins(conn,schema,"task",{k:v for k,v in vals.items() if k in existing},dry_run); n_t+=1
        targets=[]
        if act.get("org_id")    and act["org_id"]    in org_ids:    targets.append(("targetCompanyId",    pd_uuid("org",    act["org_id"])))
        if act.get("person_id") and act["person_id"] in person_ids: targets.append(("targetPersonId",     pd_uuid("person", act["person_id"])))
        if act.get("deal_id")   and act["deal_id"]   in deal_ids:   targets.append(("targetOpportunityId",pd_uuid("deal",   act["deal_id"])))
        elif act.get("lead_id") and act["lead_id"]   in lead_ids:   targets.append(("targetOpportunityId",pd_uuid("lead",   act["lead_id"])))
        for col,fk in targets:
            tt_vals={"id":pd_uuid("task_target",f"{act['id']}_{col}"),"taskId":uid,col:fk,
                "createdAt":to_iso(act["add_time"]),"updatedAt":to_iso(act["update_time"])}
            ins(conn,schema,"taskTarget",{k:v for k,v in tt_vals.items() if k in tt_cols},dry_run); n_tg+=1
    print(f"    {'[dry]' if dry_run else '✓'} {n_t} tasks, {n_tg} taskTargets"); return n_t,n_tg

def phase_i(conn,schema,deal_flows,deals,notes,activities,mm,dry_run):
    tl_cols=get_columns(conn,schema,"timelineActivity")
    deal_by_id={str(d["id"]):d for d in deals}
    note_titles={str(n["id"]):note_title(n.get("content")) for n in notes}
    act_subjects={str(a["id"]):a.get("subject") or "Activity" for a in activities}
    n=0
    for deal_id_str,events in deal_flows.items():
        deal=deal_by_id.get(deal_id_str)
        if not deal: continue
        opp_uuid=pd_uuid("deal",int(deal_id_str)); deal_title=deal["title"]; last_stage=None
        for event in sorted(events,key=lambda e:e.get("timestamp","")):
            obj=event.get("object"); data=event.get("data") or {}
            ts=to_iso(event.get("timestamp") or deal["add_time"])
            uid_key=(event.get("timestamp","") + deal_id_str).replace(" ","")
            additional=data.get("additional_data") or {}
            member_id=mm.get(PD_USERS.get(data.get("user_id"),{}).get("email",""))
            tl_id=tl_name=properties=None; linked_rec_id=opp_uuid; linked_name=deal_title; target_note=target_task=None
            if obj=="dealChange":
                fk,ov,nv=data.get("field_key"),data.get("old_value"),data.get("new_value")
                if fk=="add_time":
                    sv,_,_=map_stage(deal); last_stage=sv
                    tl_id,tl_name=pd_uuid("tl_created",deal_id_str),"opportunity.created"
                    properties={"after":{"name":deal_title,"stage":sv,"amount":{"amountMicros":int(float(deal.get("value") or 0))*1_000_000,"currencyCode":deal.get("currency","EUR")}}}
                elif fk=="stage_id":
                    old_e=STAGE_MAP.get(int(ov)) if ov else None; new_e=STAGE_MAP.get(int(nv)) if nv else None
                    old_v=old_e[2] if old_e else last_stage; new_v=new_e[2] if new_e else additional.get("new_value_formatted") or str(nv or "")
                    last_stage=new_v; tl_id,tl_name=pd_uuid("tl_stage",uid_key),"opportunity.updated"
                    properties={"diff":{"stage":{"before":old_v,"after":new_v}}}
                elif fk=="status" and nv in ("won","lost"):
                    new_v="WON" if nv=="won" else "LOST"; last_stage=new_v
                    tl_id,tl_name=pd_uuid("tl_status",uid_key),"opportunity.updated"
                    properties={"diff":{"stage":{"before":last_stage,"after":new_v}}}
                elif fk=="user_id":
                    tl_id,tl_name=pd_uuid("tl_owner",uid_key),"opportunity.updated"
                    properties={"diff":{"owner":{"before":additional.get("old_value_formatted") or str(ov or ""),"after":additional.get("new_value_formatted") or str(nv or "")}}}
                elif fk=="value":
                    cur=deal.get("currency","EUR"); tl_id,tl_name=pd_uuid("tl_value",uid_key),"opportunity.updated"
                    properties={"diff":{"amount":{"before":{"amountMicros":int(float(ov or 0))*1_000_000,"currencyCode":cur},"after":{"amountMicros":int(float(nv or 0))*1_000_000,"currencyCode":cur}}}}
                elif fk=="person_id":
                    tl_id,tl_name=pd_uuid("tl_person",uid_key),"opportunity.updated"
                    properties={"diff":{"pointOfContact":{"before":additional.get("old_value_formatted"),"after":additional.get("new_value_formatted") or str(nv or "")}}}
                elif fk=="expected_close_date":
                    tl_id,tl_name=pd_uuid("tl_closedate",uid_key),"opportunity.updated"
                    properties={"diff":{"closeDate":{"before":ov,"after":nv}}}
            elif obj=="note":
                note_pd=str(data.get("id","")); title_t=note_titles.get(note_pd,"Note")
                tl_id,tl_name=pd_uuid("tl_note_link",f"{deal_id_str}_{note_pd}"),"linked-note.created"
                properties={"diff":{"title":{"before":None,"after":title_t}}}
                linked_rec_id=pd_uuid("note",note_pd) if note_pd else opp_uuid; linked_name=title_t
                target_note=pd_uuid("note",note_pd) if note_pd else None
            elif obj=="activity":
                act_pd=str(data.get("id","")); subj=act_subjects.get(act_pd,"Activity")
                tl_id,tl_name=pd_uuid("tl_act_link",f"{deal_id_str}_{act_pd}"),"linked-task.created"
                properties={"diff":{"title":{"before":None,"after":subj}}}
                linked_rec_id=pd_uuid("activity",act_pd) if act_pd else opp_uuid; linked_name=subj
                target_task=pd_uuid("activity",act_pd) if act_pd else None
            if not (tl_id and tl_name and properties): continue
            tl_vals={"id":tl_id,"name":tl_name,"happensAt":ts,"properties":j(properties),
                "linkedRecordId":str(linked_rec_id),"linkedRecordCachedName":linked_name,
                "workspaceMemberId":member_id,"targetOpportunityId":opp_uuid,"createdAt":ts,"updatedAt":ts}
            if target_note: tl_vals["targetNoteId"]=target_note
            if target_task: tl_vals["targetTaskId"]=target_task
            ins(conn,schema,"timelineActivity",{k:v for k,v in tl_vals.items() if k in tl_cols},dry_run); n+=1
    print(f"    {'[dry]' if dry_run else '✓'} {n} timeline activities"); return n

# ── Validate ──────────────────────────────────────────────────────────────────

def validate(conn,schema):
    for tbl,label in [("company","companies"),("person","people"),("opportunity","opportunities"),
        ("note","notes"),("noteTarget","noteTargets"),("task","tasks"),
        ("taskTarget","taskTargets"),("timelineActivity","timeline events")]:
        try:
            t=conn.execute(f'SELECT COUNT(*) FROM {schema}."{tbl}"').fetchone()[0]
            print(f"    {label:<22} {t}")
        except Exception as e:
            print(f"    {label:<22} ERROR: {e}")

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--local",    action="store_true")
    parser.add_argument("--no-reset", action="store_true")
    parser.add_argument("--dry-run",  action="store_true")
    parser.add_argument("--size",     type=int, default=25)
    args=parser.parse_args()

    db_url=os.getenv("DATABASE_URL" if args.local else "PG_DATABASE_URL")
    if not db_url: sys.exit("ERROR: PG_DATABASE_URL not set in .env")

    print(f"\n{'='*60}")
    print(f"  Webso CRM Setup + Migration  sample={args.size} orgs")
    print(f"  DB: {'Local' if args.local else 'Neon'}  |  Reset: {'no' if args.no_reset else 'yes'}  |  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"{'='*60}")

    def cleanup(sig=None, frame=None):
        stop_server()
        sys.exit(0)
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    # ── Phase 0: DB reset + Workspace creation ──
    if not args.no_reset:
        try:
            reset_database()
            start_server()
            wait_for_server()
            _access_token, workspace_id = create_workspace(db_url)
            stop_server()
            ws_schema = get_workspace_schema_name(workspace_id)
        except Exception as e:
            print(f"\n  ✗ Setup error: {e}")
            stop_server()
            raise
    else:
        ws_schema = None

    # ── Load Pipedrive data from local JSON ──
    print("\n  Loading Pipedrive data from JSON...")
    orgs=load_json("organizations"); persons=load_json("persons"); deals=load_json("deals")
    leads=load_json("leads"); notes=load_json("notes"); activities=load_json("activities")
    flows_path=DATA_DIR/"raw"/"deal_flows.json"
    deal_flows=json.loads(flows_path.read_text(encoding="utf-8")) if flows_path.exists() else {}

    s_orgs,s_persons,s_deals,s_leads,s_notes,s_acts,s_flows=select_slice(orgs,persons,deals,leads,notes,activities,deal_flows,args.size)
    org_ids    = {o["id"] for o in s_orgs}
    person_ids = {p["id"] for p in s_persons}
    deal_ids   = {d["id"] for d in s_deals}
    lead_ids   = {l["id"] for l in s_leads}
    print(f"  Slice: {len(s_orgs)} orgs  {len(s_persons)} people  {len(s_deals)} deals  {len(s_leads)} leads  {len(s_notes)} notes  {len(s_acts)} activities  {len(s_flows)} flows\n")

    # ── Phase 1: Data migration via direct SQL ──
    with psycopg.connect(db_url) as conn:
        schema = ws_schema or get_schema(conn)
        mm=get_member_map(conn,schema)
        print(f"  Schema: {schema}")
        print(f"  Members: {list(mm.keys()) or 'none'}\n")

        if not args.no_reset:
            print("  Clearing workspace data before migration...")
            for tbl in ["timelineActivity","taskTarget","task","noteTarget","note","opportunity","person","company"]:
                try:
                    conn.execute(f'DELETE FROM {schema}."{tbl}"')
                    print(f"    ✓ cleared {tbl}")
                except Exception as e:
                    conn.rollback()
                    print(f"    ! skipped {tbl}: {e}")
            print()

        phase_a(conn,schema,s_orgs,   mm,args.dry_run)
        phase_b(conn,schema,s_persons,mm,args.dry_run)
        phase_c(conn,schema,s_deals,  mm,args.dry_run,person_ids=person_ids)
        phase_d(conn,schema,s_leads,  mm,args.dry_run,person_ids=person_ids)
        phase_e(conn,schema,s_notes,  mm,args.dry_run,org_ids=org_ids,person_ids=person_ids,deal_ids=deal_ids,lead_ids=lead_ids)
        phase_f(conn,schema,s_acts,   mm,args.dry_run,org_ids=org_ids,person_ids=person_ids,deal_ids=deal_ids,lead_ids=lead_ids)
        phase_i(conn,schema,s_flows,s_deals,s_notes,s_acts,mm,args.dry_run)
        print("\n  Counts:"); validate(conn,schema)

    print(f"\n{'='*60}")
    print(f"  ✓ Setup complete!")
    print(f"  Workspace : {WORKSPACE_NAME}")
    print(f"  User      : {PEKKA_EMAIL} / {PEKKA_PASSWORD}")
    print(f"")
    print(f"  Start the app:")
    print(f"    npx nx start twenty-server")
    print(f"    npx nx start twenty-front")
    print(f"{'='*60}")

if __name__=="__main__":
    main()
