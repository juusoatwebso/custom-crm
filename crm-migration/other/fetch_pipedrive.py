#!/usr/bin/env python3
"""
Pipedrive Data Fetch Script - Phase 1 of CRM Migration

Authenticates with Pipedrive API and fetches all available data,
printing a categorized summary to verify data before wiring up Neon inserts.
"""

import os
import sys
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax

# Load environment variables
load_dotenv()

API_TOKEN = os.getenv("PIPEDRIVE_API_TOKEN")
BASE_URL = "https://api.pipedrive.com"
console = Console()

# Endpoint configuration
ENDPOINTS = {
    "CORE CRM": [
        ("Deals", "/api/v2/deals", "v2"),
        ("Persons", "/api/v2/persons", "v2"),
        ("Organizations", "/api/v2/organizations", "v2"),
        ("Leads", "/v1/leads", "v1"),
    ],
    "SALES PIPELINE": [
        ("Pipelines", "/api/v2/pipelines", "v2"),
        ("Stages", "/api/v2/stages", "v2"),
    ],
    "ACTIVITIES & NOTES": [
        ("Activities", "/api/v2/activities", "v2"),
        ("Notes", "/v1/notes", "v1"),
    ],
    "PRODUCTS": [
        ("Products", "/api/v2/products", "v2"),
    ],
    "USERS & CONFIG": [
        ("Users", "/v1/users", "v1"),
        ("Currencies", "/v1/currencies", "v1"),
        ("Filters", "/v1/filters", "v1"),
    ],
    "CUSTOM FIELDS (schema)": [
        ("Deal Fields", "/v1/dealFields", "v1"),
        ("Person Fields", "/v1/personFields", "v1"),
        ("Organization Fields", "/v1/organizationFields", "v1"),
        ("Lead Fields", "/v1/leadFields", "v1"),
        ("Product Fields", "/v1/productFields", "v1"),
    ],
}


def validate_token():
    """Validate that API token is set."""
    if not API_TOKEN:
        console.print(
            "[red]✗ PIPEDRIVE_API_TOKEN not found in environment or .env file[/red]"
        )
        sys.exit(1)


def fetch_v2(endpoint: str) -> tuple[List[Dict[str, Any]], bool, Optional[str]]:
    """
    Fetch data from v2 endpoint with cursor-based pagination.
    Returns (records, success, error_message).
    """
    records = []
    next_cursor = None
    success = True
    error_msg = None

    while True:
        try:
            url = urljoin(BASE_URL, endpoint)
            params = {"api_token": API_TOKEN}
            if next_cursor:
                params["cursor"] = next_cursor

            resp = requests.get(url, params=params, timeout=10)

            if resp.status_code == 403:
                return records, False, f"HTTP 403 (missing scope)"
            elif resp.status_code == 401:
                return records, False, "HTTP 401 (invalid token)"
            elif resp.status_code >= 400:
                return records, False, f"HTTP {resp.status_code}"

            data = resp.json()
            if not data.get("success"):
                return records, False, f"API error: {data.get('error', 'unknown')}"

            records.extend(data.get("data", []))

            # Check for next cursor
            additional_data = data.get("additional_data") or {}
            next_cursor = additional_data.get("next_cursor")
            if not next_cursor:
                break

        except requests.exceptions.Timeout:
            if records:
                return records, True, None  # Partial success
            return records, False, "Request timeout"
        except requests.exceptions.RequestException as e:
            if records:
                return records, True, None  # Partial success
            return records, False, f"Connection error: {str(e)[:50]}"

    return records, success, error_msg


def fetch_v1(endpoint: str) -> tuple[List[Dict[str, Any]], bool, Optional[str]]:
    """
    Fetch data from v1 endpoint with offset-based pagination.
    Returns (records, success, error_message).
    """
    records = []
    start = 0
    limit = 500
    success = True
    error_msg = None

    while True:
        try:
            url = urljoin(BASE_URL, endpoint)
            params = {"api_token": API_TOKEN, "start": start, "limit": limit}

            resp = requests.get(url, params=params, timeout=10)

            if resp.status_code == 403:
                return records, False, f"HTTP 403 (missing scope)"
            elif resp.status_code == 401:
                return records, False, "HTTP 401 (invalid token)"
            elif resp.status_code >= 400:
                return records, False, f"HTTP {resp.status_code}"

            data = resp.json()
            if not data.get("success"):
                return records, False, f"API error: {data.get('error', 'unknown')}"

            page_data = data.get("data", [])
            if not page_data:
                break

            records.extend(page_data)

            # Check pagination
            additional_data = data.get("additional_data") or {}
            pagination = additional_data.get("pagination", {})
            if not pagination.get("more_items_in_collection"):
                break

            start += limit

        except requests.exceptions.Timeout:
            if records:
                return records, True, None  # Partial success
            return records, False, "Request timeout"
        except requests.exceptions.RequestException as e:
            if records:
                return records, True, None  # Partial success
            return records, False, f"Connection error: {str(e)[:50]}"

    return records, success, error_msg


def format_preview(record: Dict[str, Any]) -> str:
    """Format a record preview with key fields."""
    if not record:
        return "(empty)"

    # Common key fields to display
    preview_parts = []

    if "id" in record:
        preview_parts.append(f"id={record['id']}")

    # Resource-specific fields
    if "title" in record:
        preview_parts.append(f'title="{record["title"][:30]}"')
    elif "name" in record:
        preview_parts.append(f'name="{record["name"][:30]}"')

    if "value" in record and isinstance(record["value"], (int, float)):
        preview_parts.append(f"value={record['value']}")

    if "currency" in record:
        preview_parts.append(f"currency={record['currency']}")

    if "stage" in record:
        preview_parts.append(f'stage="{record["stage"][:15]}"')

    if "status" in record:
        preview_parts.append(f"status={record['status']}")

    if "email" in record:
        preview_parts.append(f"email={record['email'][:30]}")

    if "organization" in record and isinstance(record["organization"], dict):
        org_name = record["organization"].get("name", "")[:20]
        if org_name:
            preview_parts.append(f'org="{org_name}"')

    if "add_time" in record:
        preview_parts.append(f"add_time={record['add_time'][:10]}")

    return " | ".join(preview_parts[:6])  # Limit to 6 fields


def main():
    """Fetch all Pipedrive data and display categorized summary."""
    validate_token()

    console.print()
    console.print("[bold cyan]Fetching Pipedrive data...[/bold cyan]")
    console.print()

    for category, endpoints_list in ENDPOINTS.items():
        console.print(f"[bold]{category}[/bold]")
        console.print("─" * 80)

        for resource_name, endpoint, version in endpoints_list:
            # Fetch data
            if version == "v2":
                records, success, error_msg = fetch_v2(endpoint)
            else:
                records, success, error_msg = fetch_v1(endpoint)

            # Format output
            if not success:
                console.print(
                    f"[red]✗ {resource_name:<20}[/red] — {error_msg}"
                )
            elif not records:
                console.print(
                    f"[yellow]○ {resource_name:<20}[/yellow] 0 records"
                )
            else:
                preview = format_preview(records[0])
                count_str = f"{len(records)} record{'s' if len(records) != 1 else ''}"
                console.print(
                    f"[green]✓ {resource_name:<20}[/green] {count_str:<15} {preview}"
                )

        console.print()


if __name__ == "__main__":
    main()
