#!/usr/bin/env python3
"""
setup_twenty_schema.py  —  Programmatic Twenty CRM schema setup

Creates all custom fields and SELECT options required before running
setup_webso_2_mini.py / setup_webso_2.py.

Talks to Twenty's GraphQL metadata API. Requires a Twenty API token:
  1. Open Twenty → Settings → API & Webhooks → Generate a token
  2. Add to .env:  TWENTY_API_TOKEN=<token>
  3. Optionally:   TWENTY_API_URL=http://localhost:3000  (default)

Usage:
  python setup_twenty_schema.py               # create everything
  python setup_twenty_schema.py --dry-run     # show what would be created
  python setup_twenty_schema.py --check       # verify fields exist, no writes

The script is idempotent — if a field already exists it is skipped, not
duplicated. Safe to run multiple times.
"""

import argparse
import json
import os
import sys
import uuid
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

API_TOKEN = os.getenv("TWENTY_API_TOKEN")
API_URL   = os.getenv("TWENTY_API_URL", "http://localhost:3000")

METADATA_ENDPOINT = f"{API_URL}/metadata"
HEADERS = lambda: {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def gql(query: str, variables: dict | None = None) -> dict:
    resp = requests.post(
        METADATA_ENDPOINT,
        headers=HEADERS(),
        json={"query": query, "variables": variables or {}},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(f"GraphQL error: {data['errors']}")
    return data["data"]


def new_id() -> str:
    return str(uuid.uuid4())


def color_cycle(i: int) -> str:
    colors = ["blue", "purple", "sky", "green", "turquoise",
              "pink", "red", "orange", "yellow", "gray"]
    return colors[i % len(colors)]


# ── Step 1: Discover object metadata IDs ─────────────────────────────────────

OBJECTS_QUERY = """
query {
  objects(filter: { isSystem: { is: NOT_NULL } }) {
    edges {
      node {
        id
        nameSingular
        namePlural
        fields(filter: { isSystem: { is: NOT_NULL } }) {
          edges {
            node {
              id
              name
              type
              isCustom
            }
          }
        }
      }
    }
  }
}
"""


def get_objects() -> dict[str, dict]:
    """Returns { nameSingular: { id, existing_field_names: set } }"""
    data = gql(OBJECTS_QUERY)
    result = {}
    for edge in data["objects"]["edges"]:
        node = edge["node"]
        fields = {f["node"]["name"] for f in node["fields"]["edges"]}
        result[node["nameSingular"]] = {
            "id": node["id"],
            "fields": fields,
        }
    return result


# ── Step 2: Field definitions ─────────────────────────────────────────────────

# Each entry: (object_name, field_name, field_type, label, icon, extra_kwargs)
# extra_kwargs can include: options, defaultValue, description

STAGE_OPTIONS = [
    # System stages
    {"id": new_id(), "position": 0,  "label": "Lead",                        "value": "LEAD",                         "color": "gray"},
    {"id": new_id(), "position": 1,  "label": "Won",                         "value": "WON",                          "color": "green"},
    {"id": new_id(), "position": 2,  "label": "Lost",                        "value": "LOST",                         "color": "red"},
    # UP-SELL pipeline
    {"id": new_id(), "position": 3,  "label": "UP-SELL / Keskustelu avattu", "value": "UPSELL_KESKUSTELU_AVATTU",     "color": "sky"},
    {"id": new_id(), "position": 4,  "label": "UP-SELL / Tarjous",           "value": "UPSELL_TARJOUS",               "color": "sky"},
    {"id": new_id(), "position": 5,  "label": "UP-SELL / On Hold",           "value": "UPSELL_ON_HOLD",               "color": "yellow"},
    {"id": new_id(), "position": 6,  "label": "UP-SELL / Neuvottelu",        "value": "UPSELL_NEUVOTTELU",            "color": "sky"},
    # Oma myynti pipeline
    {"id": new_id(), "position": 7,  "label": "Oma / Palaveerattu (Icebox)", "value": "OMA_PALAVEERATTU_ICEBOX",      "color": "blue"},
    {"id": new_id(), "position": 8,  "label": "Oma / Soittoon",              "value": "OMA_SOITTOON",                 "color": "blue"},
    {"id": new_id(), "position": 9,  "label": "Oma / Uudet palaverit",       "value": "OMA_UUDET_PALAVERIT",          "color": "blue"},
    {"id": new_id(), "position": 10, "label": "Oma / Jatkopalsut",           "value": "OMA_JATKOPALSUT",              "color": "blue"},
    {"id": new_id(), "position": 11, "label": "Oma / On Hold",               "value": "OMA_ON_HOLD",                  "color": "yellow"},
    {"id": new_id(), "position": 12, "label": "Oma / Proposal Made",         "value": "OMA_PROPOSAL_MADE",            "color": "purple"},
    {"id": new_id(), "position": 13, "label": "Oma / Negotiations Started",  "value": "OMA_NEGOTIATIONS_STARTED",     "color": "purple"},
    # Sellai pipeline
    {"id": new_id(), "position": 14, "label": "Sellai / Prospect",           "value": "SELLAI_PROSPECT",              "color": "turquoise"},
    {"id": new_id(), "position": 15, "label": "Sellai / Tried to contact",   "value": "SELLAI_TRIED_TO_CONTACT",      "color": "turquoise"},
    {"id": new_id(), "position": 16, "label": "Sellai / Value communicated", "value": "SELLAI_VALUE_COMMUNICATED",    "color": "turquoise"},
    {"id": new_id(), "position": 17, "label": "Sellai / Meeting arranged",   "value": "SELLAI_MEETING_ARRANGED",      "color": "turquoise"},
    {"id": new_id(), "position": 18, "label": "Sellai / Proposal sent",      "value": "SELLAI_PROPOSAL_SENT",         "color": "turquoise"},
    {"id": new_id(), "position": 19, "label": "Sellai / Green light",        "value": "SELLAI_GREEN_LIGHT",           "color": "green"},
    # Alihankinta yritykset pipeline
    {"id": new_id(), "position": 20, "label": "Ali / Pekka yhteydessä",      "value": "ALI_PEKKA_YHTEYDESSA",         "color": "orange"},
    {"id": new_id(), "position": 21, "label": "Ali / Value communicated",    "value": "ALI_VALUE_COMMUNICATED",       "color": "orange"},
    {"id": new_id(), "position": 22, "label": "Ali / Palaveerattu",          "value": "ALI_PALAVEERATTU",             "color": "orange"},
    {"id": new_id(), "position": 23, "label": "Ali / Tarjous lähetetty",     "value": "ALI_TARJOUS_LAHETETTY",        "color": "orange"},
    {"id": new_id(), "position": 24, "label": "Ali / Kauppaa tehty",         "value": "ALI_KAUPPAA_TEHTY",            "color": "green"},
    {"id": new_id(), "position": 25, "label": "Ali / Epämiellyttävät",       "value": "ALI_EPAMIELLYTTAVAT",          "color": "gray"},
    # Alihankinta Bodyshop pipeline
    {"id": new_id(), "position": 26, "label": "Bodyshop / Potentiaali",      "value": "BODYSHOP_POTENTIAALI",         "color": "pink"},
    {"id": new_id(), "position": 27, "label": "Bodyshop / CV Lähtetty",      "value": "BODYSHOP_CV_LAHETETTY",        "color": "pink"},
    {"id": new_id(), "position": 28, "label": "Bodyshop / Haastattelu",      "value": "BODYSHOP_HAASTATTELU",         "color": "pink"},
    {"id": new_id(), "position": 29, "label": "Bodyshop / Neuvottelu",       "value": "BODYSHOP_NEUVOTTELU",          "color": "pink"},
]

ACTIVITY_TYPE_OPTIONS = [
    {"id": new_id(), "position": 0, "label": "Call",              "value": "CALL",             "color": "sky"},
    {"id": new_id(), "position": 1, "label": "Meeting",           "value": "MEETING",          "color": "blue"},
    {"id": new_id(), "position": 2, "label": "Email",             "value": "EMAIL",            "color": "purple"},
    {"id": new_id(), "position": 3, "label": "Unanswered call",   "value": "UNANSWERED_CALL",  "color": "red"},
    {"id": new_id(), "position": 4, "label": "Task",              "value": "TASK",             "color": "turquoise"},
    {"id": new_id(), "position": 5, "label": "Deadline",          "value": "DEADLINE",         "color": "orange"},
    {"id": new_id(), "position": 6, "label": "Lunch",             "value": "LUNCH",            "color": "yellow"},
    {"id": new_id(), "position": 7, "label": "Buukkaus",          "value": "BUUKKAUS",         "color": "green"},
    {"id": new_id(), "position": 8, "label": "Peruttu palaveri",  "value": "PERUTTU_PALAVERI", "color": "gray"},
]

# (object, name, type, label, icon, options, description)
FIELD_DEFINITIONS: list[dict] = [
    # ── Company ──────────────────────────────────────────────────────────────
    {"object": "company", "name": "ytunnus",          "type": "TEXT",    "label": "Y-tunnus",              "icon": "IconId"},
    {"object": "company", "name": "virallinen_nimi",  "type": "TEXT",    "label": "Virallinen nimi",        "icon": "IconBuilding"},
    {"object": "company", "name": "henkilokunta",     "type": "TEXT",    "label": "Henkilökuntaluokka",     "icon": "IconUsers"},
    {"object": "company", "name": "liikevaihto",      "type": "TEXT",    "label": "Liikevaihtoluokka",      "icon": "IconCurrencyEuro"},
    {"object": "company", "name": "perustettu",       "type": "DATE",    "label": "Perustettu",             "icon": "IconCalendar"},
    {"object": "company", "name": "paatoimiala_tol",  "type": "TEXT",    "label": "Päätoimiala (TOL 2008)", "icon": "IconBriefcase"},
    {"object": "company", "name": "paatoimiala_pf",   "type": "TEXT",    "label": "Päätoimiala (Profinder)","icon": "IconBriefcase"},
    {"object": "company", "name": "markkinointinimi", "type": "TEXT",    "label": "Markkinointinimi",       "icon": "IconStar"},
    {"object": "company", "name": "pipedriveId",      "type": "NUMBER",  "label": "Pipedrive ID",           "icon": "IconDatabase"},

    # ── Person ───────────────────────────────────────────────────────────────
    {"object": "person",  "name": "title",            "type": "TEXT",    "label": "Title",                  "icon": "IconId"},
    {"object": "person",  "name": "pipedriveId",      "type": "NUMBER",  "label": "Pipedrive ID",           "icon": "IconDatabase"},

    # ── Opportunity ──────────────────────────────────────────────────────────
    {"object": "opportunity", "name": "pipelineName",   "type": "TEXT",      "label": "Pipeline",           "icon": "IconLayoutKanban"},
    {"object": "opportunity", "name": "pipelineStage",  "type": "TEXT",      "label": "Pipeline Stage",     "icon": "IconFlag"},
    {"object": "opportunity", "name": "lostReason",     "type": "TEXT",      "label": "Lost Reason",        "icon": "IconX"},
    {"object": "opportunity", "name": "probability",    "type": "NUMBER",    "label": "Probability (%)",    "icon": "IconPercentage"},
    {"object": "opportunity", "name": "stageChangedAt", "type": "DATE_TIME", "label": "Stage Changed At",   "icon": "IconClock"},
    {"object": "opportunity", "name": "wonAt",          "type": "DATE_TIME", "label": "Won At",             "icon": "IconTrophy"},
    {"object": "opportunity", "name": "lostAt",         "type": "DATE_TIME", "label": "Lost At",            "icon": "IconMoodSad"},
    {"object": "opportunity", "name": "origin",         "type": "TEXT",      "label": "Origin",             "icon": "IconRoute"},
    {"object": "opportunity", "name": "drive",          "type": "TEXT",      "label": "Drive",              "icon": "IconLink"},
    {"object": "opportunity", "name": "isLead",         "type": "BOOLEAN",   "label": "Is Lead",            "icon": "IconUser",
     "defaultValue": False},
    {"object": "opportunity", "name": "pipedriveId",    "type": "TEXT",      "label": "Pipedrive ID",       "icon": "IconDatabase"},

    # ── Task ─────────────────────────────────────────────────────────────────
    {"object": "task", "name": "activityType", "type": "SELECT", "label": "Activity Type", "icon": "IconTag",
     "options": ACTIVITY_TYPE_OPTIONS, "defaultValue": "'TASK'"},
    {"object": "task", "name": "duration",    "type": "TEXT",   "label": "Duration",      "icon": "IconClock"},
    {"object": "task", "name": "pipedriveId", "type": "NUMBER", "label": "Pipedrive ID",  "icon": "IconDatabase"},
]

# The built-in `stage` field on Opportunity is already a SELECT — we need to
# ADD options to it (or replace them) rather than create a new field.
# This is handled separately in step 3 below.


# ── Step 3: Create / update the Opportunity stage field options ───────────────

UPDATE_FIELD_MUTATION = """
mutation UpdateField($id: UUID!, $input: UpdateFieldInput!) {
  updateOneField(input: { id: $id, update: $input }) {
    id
    name
    type
    options
  }
}
"""

GET_STAGE_FIELD_QUERY = """
query GetStageField($objectId: UUID!) {
  fields(filter: {
    objectMetadataId: { eq: $objectId }
    name: { eq: "stage" }
  }) {
    edges {
      node {
        id
        name
        type
        options
      }
    }
  }
}
"""


# ── Step 4: Create custom fields ─────────────────────────────────────────────

CREATE_FIELD_MUTATION = """
mutation CreateField($input: CreateOneFieldMetadataInput!) {
  createOneField(input: $input) {
    id
    name
    type
    label
    options
  }
}
"""


def build_create_input(obj_id: str, defn: dict) -> dict:
    field_input: dict[str, Any] = {
        "objectMetadataId": obj_id,
        "type":             defn["type"],
        "name":             defn["name"],
        "label":            defn["label"],
        "icon":             defn.get("icon", "IconBox"),
        "isCustom":         True,
        "isNullable":       True,
    }
    if "options" in defn:
        field_input["options"] = defn["options"]
    if "defaultValue" in defn:
        field_input["defaultValue"] = defn["defaultValue"]
    if "description" in defn:
        field_input["description"] = defn["description"]
    return {"input": {"field": field_input}}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Setup Twenty schema for Webso CRM migration")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be created, no writes")
    parser.add_argument("--check",   action="store_true", help="Verify all fields exist, exit with error if missing")
    args = parser.parse_args()

    if not API_TOKEN:
        print("ERROR: TWENTY_API_TOKEN not set in .env")
        print("  → Twenty UI → Settings → API & Webhooks → Generate token")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  Twenty Schema Setup")
    print(f"  API: {METADATA_ENDPOINT}")
    print(f"  Mode: {'CHECK' if args.check else ('DRY RUN' if args.dry_run else 'LIVE')}")
    print(f"{'='*60}\n")

    # ── Discover objects ──────────────────────────────────────────────────────
    print("Fetching object metadata...")
    try:
        objects = get_objects()
    except Exception as e:
        print(f"ERROR: Could not reach Twenty API — {e}")
        print(f"  Is Twenty running at {API_URL}?")
        sys.exit(1)

    for name, info in sorted(objects.items()):
        print(f"  {name:<20} id={info['id']}")
    print()

    needed_objects = {"company", "person", "opportunity", "task"}
    missing_objects = needed_objects - set(objects.keys())
    if missing_objects:
        print(f"ERROR: Objects not found: {missing_objects}")
        print("  Make sure the Twenty workspace is fully initialized.")
        sys.exit(1)

    # ── Custom fields ─────────────────────────────────────────────────────────
    created = skipped = errors = 0

    print("Custom fields:")
    for defn in FIELD_DEFINITIONS:
        obj_name = defn["object"]
        obj      = objects[obj_name]
        field_name = defn["name"]
        exists   = field_name in obj["fields"]

        status = "exists" if exists else ("would create" if args.dry_run else "creating")
        print(f"  {obj_name:<15} {field_name:<20} {defn['type']:<12} [{status}]")

        if args.check:
            if not exists:
                print(f"    MISSING — run without --check to create it")
                errors += 1
            continue

        if exists:
            skipped += 1
            continue

        if args.dry_run:
            created += 1
            continue

        try:
            variables = build_create_input(obj["id"], defn)
            result = gql(CREATE_FIELD_MUTATION, variables)
            created += 1
        except Exception as e:
            print(f"    ERROR: {e}")
            errors += 1

    print(f"\n  Custom fields: {created} created, {skipped} skipped, {errors} errors\n")

    # ── Opportunity stage options ─────────────────────────────────────────────
    print("Opportunity stage field (setting pipeline options)...")
    opp = objects.get("opportunity")
    if not opp:
        print("  ERROR: opportunity object not found")
        sys.exit(1)

    # Find the stage field
    stage_field_id = None
    try:
        data = gql(GET_STAGE_FIELD_QUERY, {"objectId": opp["id"]})
        edges = data["fields"]["edges"]
        if edges:
            stage_field = edges[0]["node"]
            stage_field_id = stage_field["id"]
            current_options = stage_field.get("options") or []
            current_values  = {o.get("value") for o in current_options}
            print(f"  Stage field id: {stage_field_id}")
            print(f"  Existing options: {sorted(current_values) or 'none'}")
        else:
            print("  WARNING: stage field not found on opportunity object")
    except Exception as e:
        print(f"  ERROR fetching stage field: {e}")

    if stage_field_id:
        target_values = {o["value"] for o in STAGE_OPTIONS}
        missing_stage = target_values - current_values if 'current_values' in dir() else target_values

        if not missing_stage:
            print("  Stage options already complete — skipping")
        elif args.check:
            if missing_stage:
                print(f"  MISSING stage options: {sorted(missing_stage)}")
                errors += len(missing_stage)
        elif args.dry_run:
            print(f"  Would add {len(missing_stage)} stage options: {sorted(missing_stage)}")
        else:
            # Merge existing + new options, deduped by value
            existing = current_options if 'current_options' in dir() else []
            existing_vals = {o["value"]: o for o in existing}
            merged = list(existing_vals.values())
            pos = len(merged)
            for opt in STAGE_OPTIONS:
                if opt["value"] not in existing_vals:
                    opt_copy = dict(opt)
                    opt_copy["position"] = pos
                    opt_copy["id"] = new_id()
                    merged.append(opt_copy)
                    pos += 1

            try:
                gql(UPDATE_FIELD_MUTATION, {
                    "id": stage_field_id,
                    "input": {"options": merged}
                })
                print(f"  ✓ Stage field updated — {len(merged)} options total")
            except Exception as e:
                print(f"  ERROR updating stage field: {e}")
                errors += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    if args.check:
        if errors:
            print(f"  CHECK FAILED — {errors} missing fields/options")
            print(f"  Run without --check to create them.")
            sys.exit(1)
        else:
            print("  CHECK PASSED — all fields and options exist")
    else:
        print(f"  Done.  {'[DRY RUN — no writes made]' if args.dry_run else 'Schema ready for migration.'}")
        if not args.dry_run:
            print(f"\n  Next steps:")
            print(f"    python setup_webso_2_mini.py --neon   # test run (25 orgs)")
            print(f"    python setup_webso_2.py --neon        # full migration")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
