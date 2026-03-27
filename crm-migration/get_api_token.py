#!/usr/bin/env python3
"""
get_api_token.py — Get a Twenty API token without using the UI

Flow (all GraphQL against /graphql):
  1. getLoginTokenFromCredentials  →  short-lived loginToken
  2. getAuthTokensFromLoginToken   →  accessToken
  3. createOneApiKey               →  permanent API key token

Uses Twenty's default prefilled dev credentials (SIGN_IN_PREFILLED=true).

Usage:
  python get_api_token.py
"""

import os
import sys
import requests
from dotenv import load_dotenv

load_dotenv()

API_URL   = os.getenv("TWENTY_API_URL", "http://localhost:3000")
ENDPOINT  = f"{API_URL}/metadata"   # auth mutations live on /metadata
GQL_URL   = f"{API_URL}/graphql"    # workspace data (createOneApiKey) lives here
ORIGIN    = API_URL

# Default prefilled credentials (seed-users.util.ts + SIGN_IN_PREFILLED=true)
EMAIL    = "tim@apple.dev"
PASSWORD = "tim@apple.dev"


def gql(query: str, variables: dict | None = None,
        token: str | None = None, endpoint: str = ENDPOINT) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = requests.post(endpoint, headers=headers,
                         json={"query": query, "variables": variables or {}},
                         timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(data["errors"][0]["message"])
    return data["data"]


# ── Step 1: credentials → loginToken ─────────────────────────────────────────

print(f"Connecting to {ENDPOINT}")
print(f"Signing in as {EMAIL}...")

try:
    data = gql("""
        mutation($email: String!, $password: String!, $origin: String!) {
          getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) {
            loginToken { token }
          }
        }
    """, {"email": EMAIL, "password": PASSWORD, "origin": ORIGIN})
except RuntimeError as e:
    print(f"✗ getLoginTokenFromCredentials failed: {e}")
    sys.exit(1)

login_token = data["getLoginTokenFromCredentials"]["loginToken"]["token"]
print("✓ Got login token")

# ── Step 2: loginToken → accessToken ─────────────────────────────────────────

try:
    data = gql("""
        mutation($loginToken: String!, $origin: String!) {
          getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
            tokens {
              accessOrWorkspaceAgnosticToken { token }
            }
          }
        }
    """, {"loginToken": login_token, "origin": ORIGIN})
except RuntimeError as e:
    print(f"✗ getAuthTokensFromLoginToken failed: {e}")
    sys.exit(1)

access_token = data["getAuthTokensFromLoginToken"]["tokens"]["accessOrWorkspaceAgnosticToken"]["token"]
print("✓ Got access token")

# ── Step 3: accessToken → API key ─────────────────────────────────────────────

print("Creating permanent API key...")

try:
    data = gql("""
        mutation {
          createOneApiKey(data: { name: "CRM Migration" }) {
            id
            token
          }
        }
    """, token=access_token, endpoint=GQL_URL)
except RuntimeError as e:
    print(f"✗ createOneApiKey failed: {e}")
    sys.exit(1)

api_token = data["createOneApiKey"]["token"]

# ── Step 4: Save to .env ──────────────────────────────────────────────────────

env_path = os.path.join(os.path.dirname(__file__), ".env")
with open(env_path) as f:
    content = f.read()

if "TWENTY_API_TOKEN=" in content:
    lines = [f"TWENTY_API_TOKEN={api_token}"
             if l.startswith("TWENTY_API_TOKEN=") else l
             for l in content.splitlines()]
    content = "\n".join(lines) + "\n"
else:
    content = content.rstrip("\n") + f"\nTWENTY_API_TOKEN={api_token}\n"

with open(env_path, "w") as f:
    f.write(content)

print(f"\n✓ API token saved to crm-migration/.env")
print(f"\n  TWENTY_API_TOKEN={api_token}")
print(f"\n  Run: python preflight.py")
