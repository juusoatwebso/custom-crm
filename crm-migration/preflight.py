#!/usr/bin/env python3
"""
preflight.py  —  Pre-migration checklist for Webso CRM migration

Verifies everything is in order before running setup_twenty_schema.py
and setup_webso_2.py. Run this first and fix any FAILs before proceeding.

Usage:
  python preflight.py
"""

import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API_TOKEN = os.getenv("TWENTY_API_TOKEN")
API_URL   = os.getenv("TWENTY_API_URL", "http://localhost:3000")
DATA_DIR  = Path(__file__).parent / "data" / "raw"

PASS  = "\033[32m  ✓\033[0m"
FAIL  = "\033[31m  ✗\033[0m"
WARN  = "\033[33m  !\033[0m"
INFO  = "   "

results: list[tuple[bool, str]] = []   # (passed, message)


def check(passed: bool, msg: str, warn_only: bool = False) -> bool:
    tag  = PASS if passed else (WARN if warn_only else FAIL)
    print(f"{tag} {msg}")
    results.append((passed or warn_only, msg))
    return passed


def section(title: str):
    print(f"\n── {title} {'─' * (54 - len(title))}")


def gql(query: str, variables: dict | None = None) -> dict:
    resp = requests.post(
        f"{API_URL}/metadata",
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
        json={"query": query, "variables": variables or {}},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(data["errors"][0]["message"])
    return data["data"]


def gql_main(query: str) -> dict:
    resp = requests.post(
        f"{API_URL}/graphql",
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
        json={"query": query},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(data["errors"][0]["message"])
    return data["data"]


# ── 1. Environment ─────────────────────────────────────────────────────────────

section("1. Environment")

check(bool(API_TOKEN), "TWENTY_API_TOKEN is set in .env")
check(bool(os.getenv("TWENTY_API_URL") or True),
      f"TWENTY_API_URL = {API_URL}  (using default if not set)", warn_only=True)
check(bool(os.getenv("PIPEDRIVE_API_TOKEN")), "PIPEDRIVE_API_TOKEN is set (for re-fetch if needed)", warn_only=True)


# ── 2. Data files ──────────────────────────────────────────────────────────────

section("2. Data files in data/raw/")

EXPECTED_FILES = {
    "organizations.json": 2067,
    "persons.json":       2864,
    "deals.json":         483,
    "leads.json":         260,
    "notes.json":         1585,
    "activities.json":    6081,
    "deal_flows.json":    483,
}

for filename, expected_count in EXPECTED_FILES.items():
    path = DATA_DIR / filename
    if not path.exists():
        check(False, f"{filename}  — FILE MISSING (run fetch_and_export.py)")
        continue
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    actual = len(data)
    match  = actual == expected_count
    check(match,
          f"{filename:<30} {actual} records  (expected {expected_count})",
          warn_only=(actual > 0 and not match))


# ── 3. Twenty API connectivity ────────────────────────────────────────────────

section("3. Twenty API connectivity")

if not API_TOKEN:
    print(f"{FAIL} Skipping API checks — no token set")
    print(f"{INFO}   → Open Twenty → Settings → API & Webhooks → Generate token")
    print(f"{INFO}   → Add to .env:  TWENTY_API_TOKEN=<token>")
else:
    # Test /metadata endpoint
    try:
        data = gql("query { currentUser { id email } }")
        user = data.get("currentUser") or {}
        check(bool(user.get("id")),
              f"Metadata API reachable  (user: {user.get('email', '?')})")
    except requests.exceptions.ConnectionError:
        check(False, f"Cannot reach {API_URL}/metadata  — is Twenty running?")
    except requests.exceptions.HTTPError as e:
        check(False, f"Metadata API HTTP error: {e}")
    except Exception as e:
        check(False, f"Metadata API error: {e}")

    # Test /graphql endpoint
    try:
        data = gql_main("query { companies(first: 1) { totalCount } }")
        total = data["companies"]["totalCount"]
        check(True, f"Main GraphQL API reachable  (current companies: {total})")
    except Exception as e:
        check(False, f"Main GraphQL API error: {e}")


# ── 4. Custom fields ──────────────────────────────────────────────────────────

section("4. Custom fields on workspace objects")

REQUIRED_FIELDS = {
    "company":     ["ytunnus", "virallinen_nimi", "henkilokunta", "liikevaihto",
                    "perustettu", "paatoimiala_tol", "paatoimiala_pf",
                    "markkinointinimi", "pipedriveId"],
    "person":      ["title", "pipedriveId"],
    "opportunity": ["pipelineName", "pipelineStage", "lostReason", "probability",
                    "stageChangedAt", "wonAt", "lostAt", "origin", "drive",
                    "isLead", "pipedriveId"],
    "task":        ["activityType", "duration", "pipedriveId"],
}

OBJECTS_QUERY = """
query {
  objects(filter: { isSystem: { is: NOT_NULL } }) {
    edges {
      node {
        nameSingular
        fields(filter: { isSystem: { is: NOT_NULL } }) {
          edges { node { name isCustom } }
        }
      }
    }
  }
}
"""

fields_ok = True
stage_options_present = False

if API_TOKEN:
    try:
        data        = gql(OBJECTS_QUERY)
        obj_fields  = {}
        for edge in data["objects"]["edges"]:
            node = edge["node"]
            obj_fields[node["nameSingular"]] = {
                f["node"]["name"] for f in node["fields"]["edges"]
            }

        for obj_name, required in REQUIRED_FIELDS.items():
            existing = obj_fields.get(obj_name, set())
            missing  = [f for f in required if f not in existing]
            if missing:
                fields_ok = False
                check(False,
                      f"{obj_name:<15} missing: {', '.join(missing)}")
            else:
                check(True, f"{obj_name:<15} all {len(required)} custom fields present")

    except Exception as e:
        check(False, f"Could not fetch object metadata: {e}")
        fields_ok = False

    if not fields_ok:
        print(f"{INFO}")
        print(f"{INFO}   → Run:  python setup_twenty_schema.py")


# ── 5. Opportunity stage options ──────────────────────────────────────────────

section("5. Opportunity stage SELECT options")

REQUIRED_STAGES = [
    "LEAD", "WON", "LOST",
    "UPSELL_KESKUSTELU_AVATTU", "UPSELL_TARJOUS", "UPSELL_ON_HOLD", "UPSELL_NEUVOTTELU",
    "OMA_PALAVEERATTU_ICEBOX", "OMA_SOITTOON", "OMA_UUDET_PALAVERIT", "OMA_JATKOPALSUT",
    "OMA_ON_HOLD", "OMA_PROPOSAL_MADE", "OMA_NEGOTIATIONS_STARTED",
    "SELLAI_PROSPECT", "SELLAI_TRIED_TO_CONTACT", "SELLAI_VALUE_COMMUNICATED",
    "SELLAI_MEETING_ARRANGED", "SELLAI_PROPOSAL_SENT", "SELLAI_GREEN_LIGHT",
    "ALI_PEKKA_YHTEYDESSA", "ALI_VALUE_COMMUNICATED", "ALI_PALAVEERATTU",
    "ALI_TARJOUS_LAHETETTY", "ALI_KAUPPAA_TEHTY", "ALI_EPAMIELLYTTAVAT",
    "BODYSHOP_POTENTIAALI", "BODYSHOP_CV_LAHETETTY", "BODYSHOP_HAASTATTELU",
    "BODYSHOP_NEUVOTTELU",
]

STAGE_FIELD_QUERY = """
query {
  fields(filter: {
    objectMetadataId: { is: NOT_NULL }
    name: { eq: "stage" }
  }) {
    edges {
      node {
        name
        type
        options
        object { nameSingular }
      }
    }
  }
}
"""

if API_TOKEN:
    try:
        data  = gql(STAGE_FIELD_QUERY)
        edges = data["fields"]["edges"]
        opp_stage = next(
            (e["node"] for e in edges
             if e["node"].get("object", {}).get("nameSingular") == "opportunity"),
            None,
        )
        if not opp_stage:
            check(False, "opportunity.stage field not found")
        else:
            existing_values = {o["value"] for o in (opp_stage.get("options") or [])}
            missing_stages  = [s for s in REQUIRED_STAGES if s not in existing_values]
            if missing_stages:
                check(False,
                      f"stage field missing {len(missing_stages)}/{len(REQUIRED_STAGES)} options: "
                      f"{', '.join(missing_stages[:5])}{'...' if len(missing_stages) > 5 else ''}")
            else:
                check(True, f"stage field has all {len(REQUIRED_STAGES)} pipeline options")
    except Exception as e:
        check(False, f"Could not check stage options: {e}")


# ── 6. Task activityType options ──────────────────────────────────────────────

section("6. Task activityType SELECT options")

REQUIRED_ACTIVITY_TYPES = [
    "CALL", "MEETING", "EMAIL", "UNANSWERED_CALL",
    "TASK", "DEADLINE", "LUNCH", "BUUKKAUS", "PERUTTU_PALAVERI",
]

ACTIVITY_TYPE_QUERY = """
query {
  fields(filter: {
    name: { eq: "activityType" }
  }) {
    edges {
      node {
        name
        type
        options
        object { nameSingular }
      }
    }
  }
}
"""

if API_TOKEN:
    try:
        data  = gql(ACTIVITY_TYPE_QUERY)
        edges = data["fields"]["edges"]
        at_field = next(
            (e["node"] for e in edges
             if e["node"].get("object", {}).get("nameSingular") == "task"),
            None,
        )
        if not at_field:
            check(False, "task.activityType field not found  → run setup_twenty_schema.py")
        else:
            existing = {o["value"] for o in (at_field.get("options") or [])}
            missing  = [v for v in REQUIRED_ACTIVITY_TYPES if v not in existing]
            if missing:
                check(False, f"activityType missing options: {', '.join(missing)}")
            else:
                check(True, f"activityType has all {len(REQUIRED_ACTIVITY_TYPES)} options")
    except Exception as e:
        check(False, f"Could not check activityType: {e}")


# ── 7. Data integrity spot-checks ──────────────────────────────────────────────

section("7. Data integrity spot-checks")

try:
    with open(DATA_DIR / "organizations.json", encoding="utf-8") as f:
        orgs = json.load(f)
    with open(DATA_DIR / "persons.json", encoding="utf-8") as f:
        persons = json.load(f)
    with open(DATA_DIR / "deals.json", encoding="utf-8") as f:
        deals = json.load(f)
    with open(DATA_DIR / "notes.json", encoding="utf-8") as f:
        notes = json.load(f)
    with open(DATA_DIR / "activities.json", encoding="utf-8") as f:
        acts = json.load(f)
    with open(DATA_DIR / "deal_flows.json", encoding="utf-8") as f:
        flows = json.load(f)

    org_ids    = {o["id"] for o in orgs}
    person_ids = {p["id"] for p in persons}
    deal_ids   = {d["id"] for d in deals}

    # Persons with broken org links
    broken_person_orgs = sum(
        1 for p in persons if p.get("org_id") and p["org_id"] not in org_ids)
    check(broken_person_orgs == 0,
          f"All person→org links valid  ({broken_person_orgs} broken)",
          warn_only=(broken_person_orgs < 10))

    # Deals with broken org links
    broken_deal_orgs = sum(
        1 for d in deals if d.get("org_id") and d["org_id"] not in org_ids)
    check(broken_deal_orgs == 0,
          f"All deal→org links valid  ({broken_deal_orgs} broken)",
          warn_only=(broken_deal_orgs < 10))

    # Deal flows coverage
    flows_with_events = sum(1 for v in flows.values() if v)
    total_flow_events = sum(len(v) for v in flows.values())
    check(len(flows) == len(deals),
          f"Deal flows: {len(flows)}/{len(deals)} deals have history  "
          f"({total_flow_events} total events)")

    # Stage map completeness
    from collections import Counter
    STAGE_IDS = {7,8,9,10,11,12,13,14,15,16,17,25,26,27,28,29,30,31,32,
                 33,34,35,36,37,43}
    deal_stages = {d["stage_id"] for d in deals if d.get("stage_id")}
    unmapped = deal_stages - STAGE_IDS
    check(len(unmapped) == 0,
          f"All deal stage_ids mapped  (unmapped: {unmapped or 'none'})",
          warn_only=bool(unmapped))

    # Notes content
    empty_notes = sum(1 for n in notes if not n.get("content"))
    check(empty_notes == 0,
          f"Notes with content: {len(notes) - empty_notes}/{len(notes)}",
          warn_only=True)

    # Activities with type
    unknown_types = [a.get("type") for a in acts
                     if a.get("type") not in
                     {"call","meeting","email","unanswered_call","task",
                      "deadline","lunch","buukkaus","peruttu_palaveri"}]
    check(len(unknown_types) == 0,
          f"All activity types mapped  "
          f"(unknown: {set(unknown_types) or 'none'})",
          warn_only=bool(unknown_types))

    print(f"{INFO}")
    print(f"{INFO}  Coverage summary:")
    print(f"{INFO}    Persons with org:  "
          f"{sum(1 for p in persons if p.get('org_id'))}/{len(persons)}")
    print(f"{INFO}    Deals with org:    "
          f"{sum(1 for d in deals if d.get('org_id'))}/{len(deals)}")
    print(f"{INFO}    Deals with person: "
          f"{sum(1 for d in deals if d.get('person_id'))}/{len(deals)}")
    print(f"{INFO}    Notes with deal:   "
          f"{sum(1 for n in notes if n.get('deal_id'))}/{len(notes)}")

except FileNotFoundError as e:
    check(False, f"Could not load data files: {e}")
except Exception as e:
    check(False, f"Data integrity check error: {e}")


# ── 8. Migration scripts present ─────────────────────────────────────────────

section("8. Migration scripts")

scripts = [
    "setup_twenty_schema.py",
    "setup_webso_2_mini.py",
    "setup_webso_2.py",
    "fetch_and_export.py",
]
for script in scripts:
    path = Path(__file__).parent / script
    check(path.exists(), script)


# ── Summary ───────────────────────────────────────────────────────────────────

total  = len(results)
passed = sum(1 for ok, _ in results if ok)
failed = total - passed

print(f"\n{'='*58}")
print(f"  {'✓' if failed == 0 else '✗'}  {passed}/{total} checks passed", end="")
print(f"  ({failed} failed)" if failed else "  — ready to migrate!")
print(f"{'='*58}")

if failed:
    print("\n  Fix order:")
    if not API_TOKEN:
        print("   1. Add TWENTY_API_TOKEN to .env")
    if not fields_ok:
        print("   2. python setup_twenty_schema.py")
    print("   3. python preflight.py   ← re-run to confirm")
    print("   4. python setup_webso_2_mini.py   ← test run")
    print("   5. python setup_webso_2.py        ← full migration")
else:
    print("\n  Run order:")
    print("   1. python setup_webso_2_mini.py   ← test run (25 orgs)")
    print("   2. python setup_webso_2.py        ← full migration")

print()
sys.exit(0 if failed == 0 else 1)
