#!/usr/bin/env python3
"""
Initial Migration: Pipedrive → Twenty CRM

Fetches ALL data from Pipedrive and writes directly into the
Twenty CRM workspace tables in Neon PostgreSQL.

Usage:
  python init_migration.py              # Write to Neon (default)
  python init_migration.py --clear      # Clear workspace data first
  python init_migration.py --local      # Write to local DB instead
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime
from typing import Dict, List, Optional

import psycopg
import requests
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

load_dotenv()

API_TOKEN = os.getenv("PIPEDRIVE_API_TOKEN")
NEON_DB_URL = os.getenv("PG_DATABASE_URL", "")
LOCAL_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/crm_migration_test")
WS = "workspace_1wgvd1injqtife6y4rvfbu3h5"

console = Console()

# ============================================================================
# PIPEDRIVE API
# ============================================================================

def fetch_all(endpoint: str, per_page: int = 500) -> List[Dict]:
    """Fetch ALL records from a Pipedrive endpoint using pagination."""
    records = []
    start = 0
    url = f"https://api.pipedrive.com/{endpoint}"

    with Progress(SpinnerColumn(), TextColumn("[cyan]{task.description}"), transient=True) as progress:
        task = progress.add_task(f"Fetching {endpoint.split('/')[-1]}...")

        while True:
            resp = requests.get(url, params={"api_token": API_TOKEN, "start": start, "limit": per_page}, timeout=30)
            if resp.status_code >= 400:
                console.print(f"[yellow]  ⚠ API {resp.status_code} on {endpoint}[/yellow]")
                break

            data = resp.json()
            if not data.get("success"):
                break

            page = data.get("data") or []
            if not page:
                break

            records.extend(page)
            progress.update(task, description=f"Fetching {endpoint.split('/')[-1]}... ({len(records)})")
            start += per_page

    return records

# ============================================================================
# STAGE / STATUS MAPPING
# ============================================================================

STAGE_MAP = {
    "new": "NEW",
    "qualified": "SCREENING",
    "screening": "SCREENING",
    "meeting": "MEETING",
    "proposal sent": "PROPOSAL",
    "proposal": "PROPOSAL",
    "customer": "CUSTOMER",
    "won": "CUSTOMER",
}

def map_stage(raw: Optional[str]) -> str:
    if not raw:
        return "NEW"
    return STAGE_MAP.get(raw.strip().lower(), "NEW")

def map_status(raw: Optional[str]) -> str:
    if not raw:
        return "TODO"
    return {"todo": "TODO", "done": "DONE", "in_progress": "IN_PROGRESS"}.get(raw.lower(), "TODO")

# ============================================================================
# INSERT HELPERS
# ============================================================================

def insert(cur, sql: str, params: tuple):
    """Execute INSERT with savepoint so one failure doesn't abort the batch."""
    cur.execute("SAVEPOINT sp")
    try:
        cur.execute(sql, params)
        cur.execute("RELEASE SAVEPOINT sp")
        return cur.rowcount
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT sp")
        return 0

def safe_url(value) -> Optional[str]:
    """Return URL string or None (never empty string — unique constraints)."""
    if not value:
        return None
    if isinstance(value, dict):
        return value.get("primaryLinkUrl") or None
    s = str(value).strip()
    return s or None

def safe_str(value) -> Optional[str]:
    if not value:
        return None
    s = str(value).strip()
    return s or None

# ============================================================================
# MIGRATION FUNCTIONS
# ============================================================================

def migrate_companies(cur, orgs: List[Dict]) -> Dict[int, str]:
    """Pipedrive Organizations → Twenty company table."""
    mapping: Dict[int, str] = {}

    for org in orgs:
        company_id = str(uuid.uuid4())
        pd_id = org.get("id")

        # Address is a flat string in Pipedrive
        address = org.get("address", "")

        rows = insert(cur, f"""
            INSERT INTO "{WS}".company (
                id, name,
                "domainNamePrimaryLinkUrl",
                employees,
                "addressAddressStreet1",
                "linkedinLinkPrimaryLinkUrl",
                "createdAt", "updatedAt",
                "createdBySource", "updatedBySource"
            ) VALUES (%s,%s,%s,%s,%s,%s,
                COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                'IMPORT','IMPORT')
            ON CONFLICT (id) DO NOTHING
        """, (
            company_id,
            safe_str(org.get("name")) or "Unknown",
            safe_url(org.get("domain_name") or org.get("website")),
            org.get("employees_count"),
            safe_str(address),
            safe_url(org.get("website")),
            _ts(org.get("add_time")),
            _ts(org.get("update_time")),
        ))

        if rows:
            mapping[pd_id] = company_id

    return mapping


def migrate_people(cur, persons: List[Dict], company_map: Dict[int, str]) -> Dict[int, str]:
    """Pipedrive Persons → Twenty person table."""
    mapping: Dict[int, str] = {}

    for p in persons:
        person_id = str(uuid.uuid4())
        pd_id = p.get("id")

        first_name = p.get("first_name", "")
        last_name = p.get("last_name", "")
        # Some Pipedrive accounts only send a single name field
        if not last_name and first_name and " " in first_name:
            parts = first_name.split(" ", 1)
            first_name, last_name = parts[0], parts[1]

        # Primary email
        emails = p.get("email", [])
        primary_email = None
        additional_emails = []
        if isinstance(emails, list):
            for e in emails:
                val = e.get("value") if isinstance(e, dict) else e
                if not primary_email:
                    primary_email = val or None
                elif val:
                    additional_emails.append(val)
        elif isinstance(emails, str):
            primary_email = emails or None

        # Primary phone
        phones = p.get("phone", [])
        primary_phone = country_code = calling_code = None
        if isinstance(phones, list) and phones:
            ph = phones[0]
            if isinstance(ph, dict):
                primary_phone = safe_str(ph.get("value"))
                country_code = safe_str(ph.get("country_code"))
                calling_code = safe_str(ph.get("calling_code"))
            else:
                primary_phone = safe_str(ph)

        company_id = company_map.get(_nested_id(p.get("org_id")))

        rows = insert(cur, f"""
            INSERT INTO "{WS}".person (
                id,
                "nameFirstName", "nameLastName",
                "emailsPrimaryEmail", "emailsAdditionalEmails",
                "phonesPrimaryPhoneNumber",
                "phonesPrimaryPhoneCountryCode",
                "phonesPrimaryPhoneCallingCode",
                "jobTitle", city,
                "companyId",
                "createdAt", "updatedAt",
                "createdBySource", "updatedBySource"
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                'IMPORT','IMPORT')
            ON CONFLICT (id) DO NOTHING
        """, (
            person_id,
            safe_str(first_name), safe_str(last_name),
            primary_email,
            json.dumps(additional_emails) if additional_emails else None,
            primary_phone, country_code, calling_code,
            safe_str(p.get("title")), safe_str(p.get("city")),
            company_id,
            _ts(p.get("add_time")), _ts(p.get("update_time")),
        ))

        if rows:
            mapping[pd_id] = person_id

    return mapping


def migrate_deals(cur, deals: List[Dict], company_map: Dict[int, str], person_map: Dict[int, str]) -> Dict[str, str]:
    """Pipedrive Deals → Twenty opportunity table."""
    mapping: Dict[str, str] = {}

    for d in deals:
        opp_id = str(uuid.uuid4())
        pd_id = f"deal_{d.get('id')}"

        stage_name = d.get("stage", {}).get("name", "") if isinstance(d.get("stage"), dict) else ""
        amount = _micros(d.get("value"))
        company_id = company_map.get(_nested_id(d.get("org_id")))
        person_id = person_map.get(_nested_id(d.get("person_id")))

        rows = insert(cur, f"""
            INSERT INTO "{WS}".opportunity (
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
            opp_id, safe_str(d.get("title")) or "Untitled",
            amount, d.get("currency", "EUR"),
            d.get("expected_close_date"), map_stage(stage_name),
            person_id, company_id,
            _ts(d.get("add_time")), _ts(d.get("update_time")),
        ))

        if rows:
            mapping[pd_id] = opp_id

    return mapping


def migrate_leads(cur, leads: List[Dict], company_map: Dict[int, str], person_map: Dict[int, str]) -> Dict[str, str]:
    """Pipedrive Leads → Twenty opportunity table."""
    mapping: Dict[str, str] = {}

    for l in leads:
        opp_id = str(uuid.uuid4())
        pd_id = str(l.get("id"))

        amount = _micros(l.get("value"))
        company_id = company_map.get(_nested_id(l.get("org_id")))
        person_id = person_map.get(_nested_id(l.get("person_id")))

        rows = insert(cur, f"""
            INSERT INTO "{WS}".opportunity (
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
            opp_id, safe_str(l.get("title")) or "Untitled",
            amount, l.get("currency", "EUR"),
            l.get("expected_close_date"), "NEW",
            person_id, company_id,
            _ts(l.get("add_time")), _ts(l.get("update_time")),
        ))

        if rows:
            mapping[pd_id] = opp_id

    return mapping


def migrate_notes(cur, notes: List[Dict], company_map: Dict[int, str],
                  person_map: Dict[int, str], opp_map: Dict[str, str]):
    """Pipedrive Notes → Twenty note + noteTarget tables."""
    count = 0

    for n in notes:
        note_id = str(uuid.uuid4())
        content = n.get("content", "")
        title = content[:80] if content else None

        rows = insert(cur, f"""
            INSERT INTO "{WS}".note (
                id, title, "bodyV2Markdown",
                "createdAt", "updatedAt",
                "createdBySource", "updatedBySource"
            ) VALUES (%s,%s,%s,
                COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                'IMPORT','IMPORT')
            ON CONFLICT (id) DO NOTHING
        """, (
            note_id, title, safe_str(content),
            _ts(n.get("add_time")), _ts(n.get("update_time")),
        ))

        if not rows:
            continue
        count += 1

        # noteTarget — link to company / person / opportunity
        company_id = company_map.get(_nested_id(n.get("org")))
        person_id = person_map.get(_nested_id(n.get("person")))
        deal_id = n.get("deal", {}).get("id") if isinstance(n.get("deal"), dict) else None
        opp_id = opp_map.get(f"deal_{deal_id}") if deal_id else None

        if company_id or person_id or opp_id:
            insert(cur, f"""
                INSERT INTO "{WS}"."noteTarget" (
                    id, "noteId",
                    "targetCompanyId", "targetPersonId", "targetOpportunityId"
                ) VALUES (%s,%s,%s,%s,%s)
            """, (str(uuid.uuid4()), note_id, company_id, person_id, opp_id))

    return count


def migrate_tasks(cur, activities: List[Dict], company_map: Dict[int, str],
                  person_map: Dict[int, str], opp_map: Dict[str, str]):
    """Pipedrive Activities → Twenty task + taskTarget tables."""
    count = 0

    for a in activities:
        task_id = str(uuid.uuid4())

        rows = insert(cur, f"""
            INSERT INTO "{WS}".task (
                id, title, "bodyV2Markdown",
                "dueAt", status,
                "createdAt", "updatedAt",
                "createdBySource", "updatedBySource"
            ) VALUES (%s,%s,%s,%s,%s,
                COALESCE(%s, NOW()), COALESCE(%s, NOW()),
                'IMPORT','IMPORT')
            ON CONFLICT (id) DO NOTHING
        """, (
            task_id,
            safe_str(a.get("subject")),
            safe_str(a.get("note")),
            _due(a.get("due_date"), a.get("due_time")),
            "DONE" if a.get("done") else "TODO",
            _ts(a.get("add_time")), _ts(a.get("update_time")),
        ))

        if not rows:
            continue
        count += 1

        company_id = company_map.get(_nested_id(a.get("company_id") or a.get("org_id")))
        person_id = person_map.get(_nested_id(a.get("person_id")))
        deal_id = a.get("deal_id") or (_nested_id(a.get("deal")))
        opp_id = opp_map.get(f"deal_{deal_id}") if deal_id else None

        if company_id or person_id or opp_id:
            insert(cur, f"""
                INSERT INTO "{WS}"."taskTarget" (
                    id, "taskId",
                    "targetCompanyId", "targetPersonId", "targetOpportunityId"
                ) VALUES (%s,%s,%s,%s,%s)
            """, (str(uuid.uuid4()), task_id, company_id, person_id, opp_id))

    return count

# ============================================================================
# SMALL HELPERS
# ============================================================================

def _ts(value) -> Optional[datetime]:
    """Convert Pipedrive timestamp (int epoch or ISO string) to datetime."""
    if not value:
        return None
    if isinstance(value, int):
        try:
            return datetime.fromtimestamp(value)
        except Exception:
            return None
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
    return None

def _due(due_date: Optional[str], due_time: Optional[str]) -> Optional[datetime]:
    """Combine Pipedrive due_date + due_time into a datetime."""
    if not due_date:
        return None
    try:
        dt_str = f"{due_date} {due_time}" if due_time else f"{due_date} 00:00:00"
        return datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None

def _micros(value) -> Optional[int]:
    """Convert a deal/lead value to micros (integer)."""
    if value is None:
        return None
    try:
        if isinstance(value, dict):
            value = value.get("amount", 0)
        return int(float(value) * 1_000_000)
    except (TypeError, ValueError):
        return None

def _nested_id(value) -> Optional[int]:
    """Pipedrive often returns {id: N, ...} objects for FK fields."""
    if value is None:
        return None
    if isinstance(value, dict):
        return value.get("id")
    return value

def clear_workspace(conn):
    cur = conn.cursor()
    for t in ["taskTarget", "noteTarget", "task", "note", "opportunity", "person", "company"]:
        cur.execute(f'DELETE FROM "{WS}"."{t}"')
    conn.commit()
    console.print("[yellow]✓ Cleared existing workspace data[/yellow]")

# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Migrate all Pipedrive data into Twenty CRM")
    parser.add_argument("--clear", action="store_true", help="Clear workspace data before import")
    parser.add_argument("--local", action="store_true", help="Use local PostgreSQL instead of Neon")
    args = parser.parse_args()

    db_url = LOCAL_DB_URL if args.local else NEON_DB_URL
    db_label = "Local PostgreSQL" if args.local else "Neon"

    console.print(Panel(f"[bold]Pipedrive → Twenty CRM[/bold]\nTarget: {db_label}", title="Migration"))

    conn = psycopg.connect(db_url)
    console.print(f"[green]✓ Connected to {db_label}[/green]")

    if args.clear:
        clear_workspace(conn)

    # ── Fetch ─────────────────────────────────────────────────────────────
    console.print("\n[cyan]Fetching from Pipedrive...[/cyan]")
    orgs       = fetch_all("v1/organizations")
    persons    = fetch_all("v1/persons")
    deals      = fetch_all("v1/deals")
    leads      = fetch_all("v1/leads")
    notes      = fetch_all("v1/notes")
    activities = fetch_all("v1/activities")

    console.print(f"  [green]{len(orgs)} organizations[/green]")
    console.print(f"  [green]{len(persons)} persons[/green]")
    console.print(f"  [green]{len(deals)} deals + {len(leads)} leads[/green]")
    console.print(f"  [green]{len(notes)} notes[/green]")
    console.print(f"  [green]{len(activities)} activities[/green]")

    # ── Migrate ───────────────────────────────────────────────────────────
    console.print("\n[cyan]Writing to Twenty CRM workspace...[/cyan]")
    cur = conn.cursor()

    company_map = migrate_companies(cur, orgs)
    conn.commit()
    console.print(f"  [green]✓ {len(company_map)} companies[/green]")

    person_map = migrate_people(cur, persons, company_map)
    conn.commit()
    console.print(f"  [green]✓ {len(person_map)} people[/green]")

    opp_map = migrate_deals(cur, deals, company_map, person_map)
    opp_map.update(migrate_leads(cur, leads, company_map, person_map))
    conn.commit()
    console.print(f"  [green]✓ {len(opp_map)} opportunities[/green]")

    n_count = migrate_notes(cur, notes, company_map, person_map, opp_map)
    conn.commit()
    console.print(f"  [green]✓ {n_count} notes[/green]")

    t_count = migrate_tasks(cur, activities, company_map, person_map, opp_map)
    conn.commit()
    console.print(f"  [green]✓ {t_count} tasks[/green]")

    # ── Verify ────────────────────────────────────────────────────────────
    table = Table(title="Twenty CRM Workspace")
    table.add_column("Entity", style="cyan")
    table.add_column("Count", style="green")
    for entity in ["company", "person", "opportunity", "note", "task"]:
        cur.execute(f'SELECT COUNT(*) FROM "{WS}"."{entity}"')
        table.add_row(entity.capitalize(), str(cur.fetchone()[0]))

    console.print(table)
    console.print("\n[green]✓ Done![/green]")
    conn.close()

if __name__ == "__main__":
    main()
