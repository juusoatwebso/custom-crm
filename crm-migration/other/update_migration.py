#!/usr/bin/env python3
"""
Incremental Update: Sync changes from Pipedrive

Fetches only new/modified records since last sync and updates the database.
Tracks sync state in .migration_state.json

Usage:
  python update_migration.py                 # Update local database
  python update_migration.py --neon          # Update Neon instead
  python update_migration.py --full-sync     # Force re-fetch all records
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import psycopg
import requests
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

load_dotenv()

API_TOKEN = os.getenv("PIPEDRIVE_API_TOKEN")
LOCAL_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/crm_migration_test")
NEON_DB_URL = os.getenv("PG_DATABASE_URL", "")
STATE_FILE = ".migration_state.json"

console = Console()

# ============================================================================
# STATE MANAGEMENT
# ============================================================================

def load_state() -> Dict:
    """Load migration state from file."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                return json.load(f)
        except:
            pass

    return {
        "last_sync_timestamp": None,
        "total_synced_records": 0,
        "companies": 0,
        "people": 0,
        "opportunities": 0,
        "notes": 0,
        "tasks": 0
    }

def save_state(state: Dict):
    """Save migration state to file."""
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2, default=str)

# ============================================================================
# HELPERS
# ============================================================================

def fetch_updated_since(endpoint: str, since_timestamp: Optional[str] = None, per_page: int = 500) -> List[Dict]:
    """Fetch records updated since timestamp."""
    records = []
    start = 0
    url = f"https://api.pipedrive.com/{endpoint}"

    while True:
        params = {
            "api_token": API_TOKEN,
            "start": start,
            "limit": per_page
        }

        if since_timestamp:
            params["since"] = since_timestamp

        try:
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code >= 400:
                break

            data = resp.json()
            if not data.get("success"):
                break

            page_data = data.get("data", [])
            if not page_data:
                break

            records.extend(page_data)
            start += per_page

        except Exception as e:
            console.print(f"[yellow]Fetch warning: {str(e)[:60]}[/yellow]")
            break

    return records

def create_actor_metadata() -> Dict:
    return {
        "id": str(uuid.uuid4()),
        "displayName": "Migration System (Update)",
        "email": "system@migration.local",
        "avatarUrl": None
    }

# ============================================================================
# UPDATE OPERATIONS
# ============================================================================

def upsert_companies(conn, companies: List[Dict]) -> int:
    """Insert or update companies."""
    if not companies:
        return 0

    cur = conn.cursor()
    count = 0

    for company in companies:
        try:
            pd_id = company.get("id")
            # Check if exists
            cur.execute("SELECT id FROM companies WHERE \"pipedriveId\" = %s", (pd_id,))
            existing = cur.fetchone()

            if existing:
                # Update
                cur.execute("""
                    UPDATE companies SET
                        name = %s,
                        "updatedAt" = NOW(),
                        "updatedBy" = %s
                    WHERE "pipedriveId" = %s
                """, (
                    company.get("name", "Unknown"),
                    json.dumps(create_actor_metadata()),
                    pd_id
                ))
            else:
                # Insert
                company_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO companies (id, "pipedriveId", name, "createdBy", "updatedBy")
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    company_id,
                    pd_id,
                    company.get("name", "Unknown"),
                    json.dumps(create_actor_metadata()),
                    json.dumps(create_actor_metadata())
                ))

            count += 1
        except Exception as e:
            pass

    conn.commit()
    return count

def upsert_people(conn, people: List[Dict]) -> int:
    """Insert or update people."""
    if not people:
        return 0

    cur = conn.cursor()
    count = 0

    for person in people:
        try:
            pd_id = person.get("id")
            cur.execute("SELECT id FROM people WHERE \"pipedriveId\" = %s", (pd_id,))
            existing = cur.fetchone()

            if existing:
                # Update
                cur.execute("""
                    UPDATE people SET
                        name = %s,
                        emails = %s,
                        phones = %s,
                        "jobTitle" = %s,
                        city = %s,
                        "updatedAt" = NOW(),
                        "updatedBy" = %s
                    WHERE "pipedriveId" = %s
                """, (
                    json.dumps({
                        "firstName": person.get("first_name", ""),
                        "lastName": person.get("last_name", ""),
                        "displayName": f"{person.get('first_name', '')} {person.get('last_name', '')}".strip()
                    }),
                    json.dumps([]),
                    json.dumps([]),
                    person.get("title", ""),
                    person.get("city", ""),
                    json.dumps(create_actor_metadata()),
                    pd_id
                ))
            else:
                # Insert
                person_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO people (id, "pipedriveId", name, emails, phones, "jobTitle", city, "createdBy", "updatedBy")
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    person_id,
                    pd_id,
                    json.dumps({
                        "firstName": person.get("first_name", ""),
                        "lastName": person.get("last_name", ""),
                        "displayName": f"{person.get('first_name', '')} {person.get('last_name', '')}".strip()
                    }),
                    json.dumps([]),
                    json.dumps([]),
                    person.get("title", ""),
                    person.get("city", ""),
                    json.dumps(create_actor_metadata()),
                    json.dumps(create_actor_metadata())
                ))

            count += 1
        except Exception as e:
            pass

    conn.commit()
    return count

def upsert_opportunities(conn, opps: List[Dict]) -> int:
    """Insert or update opportunities."""
    if not opps:
        return 0

    cur = conn.cursor()
    count = 0

    for opp in opps:
        try:
            pd_id = opp.get("id")
            opp_type = opp.get("type", "deal")

            # Format pipedrive_id consistently
            if opp_type == "deal":
                pd_id = f"deal_{pd_id}"
            else:
                pd_id = str(pd_id)

            cur.execute("SELECT id FROM opportunities WHERE \"pipedriveId\" = %s", (pd_id,))
            existing = cur.fetchone()

            if existing:
                # Update
                cur.execute("""
                    UPDATE opportunities SET
                        name = %s,
                        stage = %s,
                        "closeDate" = %s,
                        "updatedAt" = NOW(),
                        "updatedBy" = %s
                    WHERE "pipedriveId" = %s
                """, (
                    opp.get("title", "Unknown"),
                    opp.get("stage", ""),
                    opp.get("expected_close_date"),
                    json.dumps(create_actor_metadata()),
                    pd_id
                ))
            else:
                # Insert
                opp_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO opportunities (id, "pipedriveId", name, stage, "closeDate", "createdBy", "updatedBy")
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    opp_id,
                    pd_id,
                    opp.get("title", "Unknown"),
                    opp.get("stage", ""),
                    opp.get("expected_close_date"),
                    json.dumps(create_actor_metadata()),
                    json.dumps(create_actor_metadata())
                ))

            count += 1
        except Exception as e:
            pass

    conn.commit()
    return count

def upsert_notes(conn, notes: List[Dict]) -> int:
    """Insert or update notes."""
    if not notes:
        return 0

    cur = conn.cursor()
    count = 0

    for note in notes:
        try:
            pd_id = note.get("id")
            cur.execute("SELECT id FROM notes WHERE \"pipedriveId\" = %s", (pd_id,))
            existing = cur.fetchone()

            content = note.get("content", "")
            title = content[:80] if content else ""

            if existing:
                # Update
                cur.execute("""
                    UPDATE notes SET
                        title = %s,
                        "bodyV2" = %s,
                        "updatedAt" = NOW(),
                        "updatedBy" = %s
                    WHERE "pipedriveId" = %s
                """, (
                    title,
                    json.dumps({
                        "type": "doc",
                        "content": [{"type": "paragraph", "content": [{"type": "text", "text": content}]}]
                    }) if content else None,
                    json.dumps(create_actor_metadata()),
                    pd_id
                ))
            else:
                # Insert
                note_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO notes (id, "pipedriveId", title, "bodyV2", "createdBy", "updatedBy")
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    note_id,
                    pd_id,
                    title,
                    json.dumps({
                        "type": "doc",
                        "content": [{"type": "paragraph", "content": [{"type": "text", "text": content}]}]
                    }) if content else None,
                    json.dumps(create_actor_metadata()),
                    json.dumps(create_actor_metadata())
                ))

            count += 1
        except Exception as e:
            pass

    conn.commit()
    return count

def upsert_tasks(conn, tasks: List[Dict]) -> int:
    """Insert or update tasks."""
    if not tasks:
        return 0

    cur = conn.cursor()
    count = 0

    for task in tasks:
        try:
            pd_id = task.get("id")
            cur.execute("SELECT id FROM tasks WHERE \"pipedriveId\" = %s", (pd_id,))
            existing = cur.fetchone()

            status = "DONE" if task.get("done") else "TODO"

            if existing:
                # Update
                cur.execute("""
                    UPDATE tasks SET
                        title = %s,
                        status = %s,
                        "dueAt" = %s,
                        "updatedAt" = NOW(),
                        "updatedBy" = %s
                    WHERE "pipedriveId" = %s
                """, (
                    task.get("subject", ""),
                    status,
                    task.get("due_date"),
                    json.dumps(create_actor_metadata()),
                    pd_id
                ))
            else:
                # Insert
                task_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO tasks (id, "pipedriveId", title, status, "dueAt", "createdBy", "updatedBy")
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    task_id,
                    pd_id,
                    task.get("subject", ""),
                    status,
                    task.get("due_date"),
                    json.dumps(create_actor_metadata()),
                    json.dumps(create_actor_metadata())
                ))

            count += 1
        except Exception as e:
            pass

    conn.commit()
    return count

# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Incremental update from Pipedrive")
    parser.add_argument("--neon", action="store_true", help="Update Neon instead of local database")
    parser.add_argument("--full-sync", action="store_true", help="Force full re-sync of all records")
    args = parser.parse_args()

    db_url = NEON_DB_URL if args.neon else LOCAL_DB_URL
    db_name = "Neon" if args.neon else "Local PostgreSQL"

    console.print(Panel(f"[bold]Pipedrive → Twenty CRM Incremental Update[/bold]\nTarget: {db_name}", title="Update"))

    try:
        conn = psycopg.connect(db_url)
        console.print(f"[green]✓ Connected to {db_name}[/green]")

        state = load_state()
        last_sync = state.get("last_sync_timestamp") if not args.full_sync else None

        console.print(f"\n[cyan]Fetching changes since: {last_sync or 'beginning'}[/cyan]")

        companies = fetch_updated_since("v2/organizations", last_sync)
        people = fetch_updated_since("v1/persons", last_sync)
        deals = fetch_updated_since("v1/deals", last_sync)
        leads = fetch_updated_since("v2/leads", last_sync)
        notes = fetch_updated_since("v1/notes", last_sync)
        activities = fetch_updated_since("v1/activities", last_sync)

        opportunities = deals + leads

        console.print(f"[cyan]Found updates: {len(companies)} companies, {len(people)} people, {len(opportunities)} opportunities, {len(notes)} notes, {len(activities)} tasks[/cyan]")

        if sum([len(companies), len(people), len(opportunities), len(notes), len(activities)]) == 0:
            console.print("[yellow]No changes found since last sync[/yellow]")
            conn.close()
            return

        console.print("\n[cyan]Syncing updates...[/cyan]")

        c_count = upsert_companies(conn, companies)
        p_count = upsert_people(conn, people)
        o_count = upsert_opportunities(conn, opportunities)
        n_count = upsert_notes(conn, notes)
        t_count = upsert_tasks(conn, activities)

        # Update state
        state["last_sync_timestamp"] = datetime.utcnow().isoformat() + "Z"
        state["total_synced_records"] += sum([c_count, p_count, o_count, n_count, t_count])
        state["companies"] += c_count
        state["people"] += p_count
        state["opportunities"] += o_count
        state["notes"] += n_count
        state["tasks"] += t_count
        save_state(state)

        # Report
        table = Table(title="Update Summary")
        table.add_column("Entity", style="cyan")
        table.add_column("Updated/Inserted", style="green")
        table.add_row("Companies", str(c_count))
        table.add_row("People", str(p_count))
        table.add_row("Opportunities", str(o_count))
        table.add_row("Notes", str(n_count))
        table.add_row("Tasks", str(t_count))

        console.print(table)
        console.print(f"\n[green]✓ Sync complete! Last sync: {state['last_sync_timestamp']}[/green]")

        conn.close()

    except Exception as e:
        console.print(f"[red]✗ Error: {str(e)}[/red]")
        sys.exit(1)

if __name__ == "__main__":
    main()
