#!/usr/bin/env python3
"""
Neon DB Verification Test
=========================
Validates the Neon database after setup_webso.py has run.

Checks:
  1. core.workspace is ACTIVE
  2. All expected tables exist in the workspace schema
  3. All expected columns exist on each table
  4. Data was migrated (record counts > 0)
  5. No orphaned records (FK integrity)
  6. Junction tables have entries

Usage:
    python verify_neon.py                # Verify only
    python verify_neon.py --setup        # Run setup_webso.py first, then verify
"""

import argparse
import os
import subprocess
import sys

import psycopg
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

load_dotenv()

console = Console()

NEON_DB_URL = os.getenv("PG_DATABASE_URL", "")

# Expected tables and their required columns (from setup_webso.py inserts)
EXPECTED_SCHEMA = {
    "company": [
        "id", "name",
        "domainNamePrimaryLinkUrl",
        "addressAddressStreet1",
        "linkedinLinkPrimaryLinkUrl",
        "createdAt", "updatedAt",
        "createdBySource", "updatedBySource",
    ],
    "person": [
        "id",
        "nameFirstName", "nameLastName",
        "emailsPrimaryEmail",
        "phonesPrimaryPhoneNumber",
        "jobTitle", "city",
        "companyId",
        "createdAt", "updatedAt",
        "createdBySource", "updatedBySource",
    ],
    "opportunity": [
        "id", "name",
        "amountAmountMicros", "amountCurrencyCode",
        "closeDate", "stage",
        "pointOfContactId", "companyId",
        "createdAt", "updatedAt",
        "createdBySource", "updatedBySource",
    ],
    "note": [
        "id", "title", "bodyV2Markdown",
        "createdAt", "updatedAt",
        "createdBySource", "updatedBySource",
    ],
    "noteTarget": [
        "id", "noteId",
        "targetCompanyId", "targetPersonId", "targetOpportunityId",
    ],
    "task": [
        "id", "title", "bodyV2Markdown",
        "dueAt", "status",
        "createdAt", "updatedAt",
        "createdBySource", "updatedBySource",
    ],
    "taskTarget": [
        "id", "taskId",
        "targetCompanyId", "targetPersonId", "targetOpportunityId",
    ],
}

PASS = "[bold green]PASS[/bold green]"
FAIL = "[bold red]FAIL[/bold red]"
WARN = "[bold yellow]WARN[/bold yellow]"


def get_active_workspace(conn) -> tuple[str, str]:
    """Return (workspace_id, schema) for the active Webso workspace."""
    rows = conn.execute(
        """
        SELECT id, "databaseSchema", "displayName", "activationStatus"
        FROM core.workspace
        ORDER BY "createdAt" DESC
        LIMIT 5
        """
    ).fetchall()

    if not rows:
        raise RuntimeError("No workspaces found in core.workspace")

    # Prefer the one named Webso or the most recent ACTIVE one
    for row in rows:
        ws_id, schema, name, status = row
        if status == "ACTIVE":
            console.print(
                f"  [dim]Found workspace: {name!r} ({ws_id[:8]}…) schema={schema} status={status}[/dim]"
            )
            return ws_id, schema

    raise RuntimeError(
        f"No ACTIVE workspace found. Statuses: {[r[3] for r in rows]}"
    )


def check_workspace(conn) -> bool:
    console.print("\n[bold cyan]1. Workspace[/bold cyan]")
    try:
        ws_id, schema = get_active_workspace(conn)
        console.print(f"  Workspace ID : {ws_id}")
        console.print(f"  DB Schema    : {schema}")
        console.print(f"  Status       : {PASS}")
        return True, schema
    except RuntimeError as e:
        console.print(f"  [red]{e}[/red]")
        console.print(f"  Status       : {FAIL}")
        return False, None


def check_tables(conn, schema: str) -> bool:
    console.print("\n[bold cyan]2. Tables[/bold cyan]")
    rows = conn.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = %s
        """,
        (schema,),
    ).fetchall()
    existing = {r[0] for r in rows}

    all_ok = True
    for table in EXPECTED_SCHEMA:
        if table in existing:
            console.print(f"  [green]✓[/green] {table}")
        else:
            console.print(f"  [red]✗[/red] {table} [red](MISSING)[/red]")
            all_ok = False

    extra = existing - set(EXPECTED_SCHEMA)
    if extra:
        console.print(f"  [dim]Extra tables ({len(extra)}): {sorted(extra)[:5]}…[/dim]")

    return all_ok


def check_columns(conn, schema: str) -> bool:
    console.print("\n[bold cyan]3. Columns[/bold cyan]")
    rows = conn.execute(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = %s
        """,
        (schema,),
    ).fetchall()
    existing: dict[str, set] = {}
    for table, col in rows:
        existing.setdefault(table, set()).add(col)

    all_ok = True
    for table, expected_cols in EXPECTED_SCHEMA.items():
        table_cols = existing.get(table, set())
        missing = [c for c in expected_cols if c not in table_cols]
        if missing:
            console.print(f"  [red]✗[/red] {table}: missing columns {missing}")
            all_ok = False
        else:
            console.print(
                f"  [green]✓[/green] {table}: all {len(expected_cols)} required columns present"
            )

    return all_ok


def check_record_counts(conn, schema: str) -> bool:
    console.print("\n[bold cyan]4. Record Counts[/bold cyan]")
    tables_to_count = ["company", "person", "opportunity", "note", "task"]

    t = Table()
    t.add_column("Table", style="cyan")
    t.add_column("Count", style="green", justify="right")
    t.add_column("Imported", style="yellow", justify="right")

    all_ok = True
    for table in tables_to_count:
        try:
            total = conn.execute(
                f'SELECT COUNT(*) FROM "{schema}"."{table}"'
            ).fetchone()[0]

            imported = conn.execute(
                f'SELECT COUNT(*) FROM "{schema}"."{table}" WHERE "createdBySource" = \'IMPORT\''
            ).fetchone()[0]

            t.add_row(table, str(total), str(imported))

            if total == 0:
                console.print(f"  [yellow]⚠ {table}: no records at all[/yellow]")
                all_ok = False
            elif imported == 0:
                console.print(f"  [yellow]⚠ {table}: no IMPORT records[/yellow]")
        except Exception as e:
            t.add_row(table, "ERR", str(e)[:30])
            all_ok = False

    console.print(t)
    return all_ok


def check_relationships(conn, schema: str) -> bool:
    console.print("\n[bold cyan]5. Relationships / FK Integrity[/bold cyan]")
    checks = [
        # (description, query)
        (
            "People → Company (no orphans)",
            f"""
            SELECT COUNT(*) FROM "{schema}".person p
            WHERE p."companyId" IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM "{schema}".company c WHERE c.id = p."companyId"
            )
            """,
        ),
        (
            "Opportunities → Company (no orphans)",
            f"""
            SELECT COUNT(*) FROM "{schema}".opportunity o
            WHERE o."companyId" IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM "{schema}".company c WHERE c.id = o."companyId"
            )
            """,
        ),
        (
            "Opportunities → Person (no orphans)",
            f"""
            SELECT COUNT(*) FROM "{schema}".opportunity o
            WHERE o."pointOfContactId" IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM "{schema}".person p WHERE p.id = o."pointOfContactId"
            )
            """,
        ),
        (
            "NoteTargets → Note (no orphans)",
            f"""
            SELECT COUNT(*) FROM "{schema}"."noteTarget" nt
            WHERE NOT EXISTS (
                SELECT 1 FROM "{schema}".note n WHERE n.id = nt."noteId"
            )
            """,
        ),
        (
            "TaskTargets → Task (no orphans)",
            f"""
            SELECT COUNT(*) FROM "{schema}"."taskTarget" tt
            WHERE NOT EXISTS (
                SELECT 1 FROM "{schema}".task t WHERE t.id = tt."taskId"
            )
            """,
        ),
    ]

    all_ok = True
    for desc, query in checks:
        try:
            count = conn.execute(query).fetchone()[0]
            if count == 0:
                console.print(f"  [green]✓[/green] {desc}")
            else:
                console.print(f"  [red]✗[/red] {desc}: {count} orphaned records")
                all_ok = False
        except Exception as e:
            console.print(f"  [yellow]⚠[/yellow] {desc}: {e}")

    return all_ok


def check_junction_tables(conn, schema: str) -> bool:
    console.print("\n[bold cyan]6. Junction Tables[/bold cyan]")
    for table in ("noteTarget", "taskTarget"):
        try:
            count = conn.execute(
                f'SELECT COUNT(*) FROM "{schema}"."{table}"'
            ).fetchone()[0]
            if count > 0:
                console.print(f"  [green]✓[/green] {table}: {count} entries")
            else:
                console.print(f"  [yellow]⚠[/yellow] {table}: 0 entries (no links created)")
        except Exception as e:
            console.print(f"  [red]✗[/red] {table}: {e}")
            return False
    return True


def run_setup():
    console.print(Panel("[bold]Running setup_webso.py first…[/bold]", title="Setup"))
    result = subprocess.run(
        ["./venv/bin/python", "setup_webso.py"],
        cwd=os.path.dirname(os.path.abspath(__file__)),
    )
    if result.returncode != 0:
        console.print("[red]setup_webso.py failed — aborting verification[/red]")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Verify Neon DB after Webso setup")
    parser.add_argument("--setup", action="store_true", help="Run setup_webso.py before verifying")
    args = parser.parse_args()

    console.print(Panel("[bold]Neon DB Verification[/bold]", title="verify_neon.py"))

    if not NEON_DB_URL:
        console.print("[red]PG_DATABASE_URL not set in .env[/red]")
        sys.exit(1)

    if args.setup:
        run_setup()

    try:
        conn = psycopg.connect(NEON_DB_URL)
    except Exception as e:
        console.print(f"[red]Cannot connect to Neon: {e}[/red]")
        sys.exit(1)

    ws_ok, schema = check_workspace(conn)
    if not ws_ok or not schema:
        console.print("\n[red]Cannot continue without an active workspace.[/red]")
        sys.exit(1)

    tables_ok    = check_tables(conn, schema)
    columns_ok   = check_columns(conn, schema)
    counts_ok    = check_record_counts(conn, schema)
    rel_ok       = check_relationships(conn, schema)
    junction_ok  = check_junction_tables(conn, schema)

    conn.close()

    # ── Summary ────────────────────────────────────────────────────────────
    console.print("\n")
    results = Table(title="Verification Summary")
    results.add_column("Check", style="cyan")
    results.add_column("Result")

    def row(label, ok):
        results.add_row(label, PASS if ok else FAIL)

    row("1. Workspace active",       ws_ok)
    row("2. Tables exist",           tables_ok)
    row("3. Columns present",        columns_ok)
    row("4. Records migrated",       counts_ok)
    row("5. FK integrity",           rel_ok)
    row("6. Junction tables",        junction_ok)

    console.print(results)

    all_ok = all([ws_ok, tables_ok, columns_ok, counts_ok, rel_ok, junction_ok])
    if all_ok:
        console.print("\n[bold green]All checks passed — Neon DB looks good![/bold green]")
        sys.exit(0)
    else:
        console.print("\n[bold red]Some checks failed — review output above.[/bold red]")
        sys.exit(1)


if __name__ == "__main__":
    main()
