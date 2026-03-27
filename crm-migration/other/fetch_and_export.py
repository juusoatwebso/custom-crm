#!/usr/bin/env python3
"""
Pipedrive Data Fetch & Export Script

Fetches all data from Pipedrive, saves raw JSON, and exports
data model schemas showing actual fields in use.
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from dotenv import load_dotenv

load_dotenv()

API_TOKEN = os.getenv("PIPEDRIVE_API_TOKEN")
BASE_URL = "https://api.pipedrive.com"

DATA_DIR = Path(__file__).parent / "data"
RAW_DIR = DATA_DIR / "raw"
SCHEMA_DIR = DATA_DIR / "schemas"

RAW_DIR.mkdir(parents=True, exist_ok=True)
SCHEMA_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# API fetch helpers
# ---------------------------------------------------------------------------

def fetch_v2(endpoint: str) -> list[dict]:
    records = []
    next_cursor = None
    while True:
        url = urljoin(BASE_URL, endpoint)
        params: dict[str, Any] = {"api_token": API_TOKEN}
        if next_cursor:
            params["cursor"] = next_cursor
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"API error on {endpoint}: {data.get('error')}")
        records.extend(data.get("data") or [])
        next_cursor = (data.get("additional_data") or {}).get("next_cursor")
        if not next_cursor:
            break
    return records


def fetch_v1(endpoint: str, extra_params: dict | None = None) -> list[dict]:
    records = []
    start = 0
    limit = 500
    while True:
        url = urljoin(BASE_URL, endpoint)
        params: dict[str, Any] = {"api_token": API_TOKEN, "start": start, "limit": limit}
        if extra_params:
            params.update(extra_params)
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"API error on {endpoint}: {data.get('error')}")
        page = data.get("data") or []
        if not page:
            break
        records.extend(page)
        pagination = (data.get("additional_data") or {}).get("pagination", {})
        if not pagination.get("more_items_in_collection"):
            break
        start += limit
    return records


def fetch_resource(name: str, endpoint: str, version: str) -> list[dict]:
    print(f"  Fetching {name}...", end=" ", flush=True)
    try:
        records = fetch_v2(endpoint) if version == "v2" else fetch_v1(endpoint)
        print(f"{len(records)} records")
        return records
    except Exception as exc:
        print(f"ERROR — {exc}")
        return []


# ---------------------------------------------------------------------------
# Schema analysis
# ---------------------------------------------------------------------------

def infer_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        if len(value) == 10 and value[4] == "-" and value[7] == "-":
            return "date"
        if "T" in value and ":" in value:
            return "datetime"
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def analyze_schema(records: list[dict]) -> dict:
    """Collect all keys seen, their types, non-null rate, and a sample value."""
    if not records:
        return {}

    field_info: dict[str, dict] = defaultdict(lambda: {
        "types": defaultdict(int),
        "non_null_count": 0,
        "sample": None,
    })

    for record in records:
        for key, val in record.items():
            info = field_info[key]
            t = infer_type(val)
            info["types"][t] += 1
            if val is not None and val != "" and val != [] and val != {}:
                info["non_null_count"] += 1
                if info["sample"] is None:
                    # Store a concise sample
                    if isinstance(val, dict):
                        info["sample"] = {k: v for k, v in list(val.items())[:4]}
                    elif isinstance(val, list) and val:
                        info["sample"] = val[0] if not isinstance(val[0], dict) else {k: v for k, v in list(val[0].items())[:4]}
                    else:
                        info["sample"] = val

    total = len(records)
    schema = {}
    for key, info in sorted(field_info.items()):
        dominant_type = max(info["types"], key=lambda t: info["types"][t])
        schema[key] = {
            "type": dominant_type,
            "fill_rate": round(info["non_null_count"] / total, 3),
            "sample": info["sample"],
        }
    return schema


# ---------------------------------------------------------------------------
# Custom field extraction
# ---------------------------------------------------------------------------

def extract_custom_fields(fields_list: list[dict]) -> list[dict]:
    """Return only non-standard (custom) fields from a field definition list."""
    return [
        {
            "key": f.get("key"),
            "name": f.get("name"),
            "field_type": f.get("field_type"),
            "mandatory_flag": f.get("mandatory_flag", False),
            "options": f.get("options"),
        }
        for f in fields_list
        if f.get("edit_flag", True) and not f.get("bulk_edit_allowed") is False
        # Keep all fields — filter nothing so we capture the full picture
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not API_TOKEN:
        print("ERROR: PIPEDRIVE_API_TOKEN not set in .env")
        sys.exit(1)

    print("=" * 60)
    print("Pipedrive Data Fetch & Export")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # ------------------------------------------------------------------
    # 1. Fetch all resources
    # ------------------------------------------------------------------
    print("\n[1/3] Fetching data from Pipedrive API...")

    resources = {
        # Core CRM
        "organizations": fetch_resource("Organizations", "/api/v2/organizations", "v2"),
        "persons":       fetch_resource("Persons",       "/api/v2/persons",       "v2"),
        "deals":         fetch_resource("Deals",         "/api/v2/deals",         "v2"),
        "leads":         fetch_resource("Leads",         "/v1/leads",             "v1"),

        # Pipeline config
        "pipelines":     fetch_resource("Pipelines",     "/api/v2/pipelines",     "v2"),
        "stages":        fetch_resource("Stages",        "/api/v2/stages",        "v2"),

        # Activities & notes
        "activities":    fetch_resource("Activities",    "/api/v2/activities",    "v2"),
        "notes":         fetch_resource("Notes",         "/v1/notes",             "v1"),

        # Products
        "products":      fetch_resource("Products",      "/api/v2/products",      "v2"),

        # Users & config
        "users":         fetch_resource("Users",         "/v1/users",             "v1"),
        "currencies":    fetch_resource("Currencies",    "/v1/currencies",        "v1"),

        # Custom field definitions (schema)
        "deal_fields":         fetch_resource("Deal Fields",         "/v1/dealFields",         "v1"),
        "person_fields":       fetch_resource("Person Fields",       "/v1/personFields",       "v1"),
        "organization_fields": fetch_resource("Organization Fields", "/v1/organizationFields", "v1"),
        "lead_fields":         fetch_resource("Lead Fields",         "/v1/leadFields",         "v1"),
        "product_fields":      fetch_resource("Product Fields",      "/v1/productFields",      "v1"),
        "activity_fields":     fetch_resource("Activity Fields",     "/v1/activityFields",     "v1"),
        "note_fields":         fetch_resource("Note Fields",         "/v1/noteFields",         "v1"),
    }

    # ------------------------------------------------------------------
    # 2. Save raw JSON
    # ------------------------------------------------------------------
    print("\n[2/3] Saving raw data...")
    for name, records in resources.items():
        path = RAW_DIR / f"{name}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(records, f, indent=2, ensure_ascii=False, default=str)
        print(f"  Saved {name}.json  ({len(records)} records)")

    # ------------------------------------------------------------------
    # 3. Analyze schemas and save
    # ------------------------------------------------------------------
    print("\n[3/3] Analyzing data models...")

    # Core objects to schema-analyze (not field definition lists themselves)
    core_objects = [
        "organizations", "persons", "deals", "leads",
        "activities", "notes", "products", "pipelines", "stages",
    ]

    all_schemas = {}
    for name in core_objects:
        records = resources[name]
        if records:
            schema = analyze_schema(records)
            all_schemas[name] = schema
            path = SCHEMA_DIR / f"{name}_schema.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(schema, f, indent=2, ensure_ascii=False, default=str)
            print(f"  Analyzed {name}: {len(schema)} fields")
        else:
            print(f"  Skipped {name} (no records)")

    # Save combined schema
    combined_path = SCHEMA_DIR / "all_schemas.json"
    with open(combined_path, "w", encoding="utf-8") as f:
        json.dump(all_schemas, f, indent=2, ensure_ascii=False, default=str)

    # ------------------------------------------------------------------
    # 4. Export custom fields per object
    # ------------------------------------------------------------------
    custom_fields_export = {
        "deals":         extract_custom_fields(resources["deal_fields"]),
        "persons":       extract_custom_fields(resources["person_fields"]),
        "organizations": extract_custom_fields(resources["organization_fields"]),
        "leads":         extract_custom_fields(resources["lead_fields"]),
        "products":      extract_custom_fields(resources["product_fields"]),
        "activities":    extract_custom_fields(resources["activity_fields"]),
        "notes":         extract_custom_fields(resources["note_fields"]),
    }
    custom_fields_path = SCHEMA_DIR / "custom_fields.json"
    with open(custom_fields_path, "w", encoding="utf-8") as f:
        json.dump(custom_fields_export, f, indent=2, ensure_ascii=False, default=str)

    # ------------------------------------------------------------------
    # 5. Print summary stats
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    total_records = 0
    for name in core_objects:
        count = len(resources[name])
        total_records += count
        print(f"  {name:<25} {count:>5} records")

    print(f"\n  {'TOTAL':<25} {total_records:>5} records")
    print(f"\n  Pipelines: {len(resources['pipelines'])}")
    print(f"  Stages:    {len(resources['stages'])}")
    print(f"  Users:     {len(resources['users'])}")

    # Relationship stats
    print("\nRelationship coverage:")
    if resources["persons"]:
        with_org = sum(1 for p in resources["persons"] if p.get("org_id") or (isinstance(p.get("org_id"), dict) and p["org_id"].get("value")))
        print(f"  Persons with org:       {with_org}/{len(resources['persons'])}")
    if resources["deals"]:
        with_org = sum(1 for d in resources["deals"] if d.get("org_id"))
        with_person = sum(1 for d in resources["deals"] if d.get("person_id"))
        print(f"  Deals with org:         {with_org}/{len(resources['deals'])}")
        print(f"  Deals with person:      {with_person}/{len(resources['deals'])}")
    if resources["notes"]:
        with_deal = sum(1 for n in resources["notes"] if n.get("deal_id"))
        with_person = sum(1 for n in resources["notes"] if n.get("person_id"))
        with_org = sum(1 for n in resources["notes"] if n.get("org_id"))
        print(f"  Notes linked to deal:   {with_deal}/{len(resources['notes'])}")
        print(f"  Notes linked to person: {with_person}/{len(resources['notes'])}")
        print(f"  Notes linked to org:    {with_org}/{len(resources['notes'])}")
    if resources["activities"]:
        with_deal = sum(1 for a in resources["activities"] if a.get("deal_id"))
        with_person = sum(1 for a in resources["activities"] if a.get("person_id"))
        done = sum(1 for a in resources["activities"] if a.get("done"))
        types = defaultdict(int)
        for a in resources["activities"]:
            types[a.get("type", "unknown")] += 1
        print(f"  Activities with deal:   {with_deal}/{len(resources['activities'])}")
        print(f"  Activities with person: {with_person}/{len(resources['activities'])}")
        print(f"  Activities done:        {done}/{len(resources['activities'])}")
        print(f"  Activity types:         {dict(types)}")

    print(f"\nOutput written to: {DATA_DIR}")
    print(f"  Raw data:    {RAW_DIR}")
    print(f"  Schemas:     {SCHEMA_DIR}")


if __name__ == "__main__":
    main()
