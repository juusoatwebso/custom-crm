#!/bin/bash
# Fetch ALL data from Pipedrive API and save to crm-migration/data/raw/
#
# Usage:
#   PIPEDRIVE_API_TOKEN=your_token ./fetch-pipedrive.sh
#
# Or set PIPEDRIVE_API_TOKEN in crm/.env.local

set -euo pipefail

# Load token from env or crm/.env.local
if [ -z "${PIPEDRIVE_API_TOKEN:-}" ]; then
  if [ -f "crm/.env.local" ]; then
    PIPEDRIVE_API_TOKEN=$(grep PIPEDRIVE_API_TOKEN crm/.env.local | cut -d= -f2 | tr -d '"' | tr -d "'")
  fi
fi

if [ -z "${PIPEDRIVE_API_TOKEN:-}" ]; then
  echo "Error: PIPEDRIVE_API_TOKEN not set."
  echo "Usage: PIPEDRIVE_API_TOKEN=your_token ./fetch-pipedrive.sh"
  exit 1
fi

COMPANY_DOMAIN="${PIPEDRIVE_DOMAIN:-api}"
BASE_URL="https://${COMPANY_DOMAIN}.pipedrive.com/api/v1"
OUT_DIR="crm-migration/data/raw"

mkdir -p "$OUT_DIR"

# Fetch a paginated Pipedrive endpoint, collecting all items
fetch_all() {
  local endpoint="$1"
  local filename="$2"
  local start=0
  local limit=500
  local all_items="[]"
  local page=1

  echo -n "  Fetching $endpoint..."

  while true; do
    local url="${BASE_URL}/${endpoint}?api_token=${PIPEDRIVE_API_TOKEN}&start=${start}&limit=${limit}"
    local response
    response=$(curl -s "$url")

    local success
    success=$(echo "$response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success','false'))" 2>/dev/null || echo "false")

    if [ "$success" != "True" ] && [ "$success" != "true" ]; then
      echo " Error on page $page"
      echo "$response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error','unknown error'))" 2>/dev/null || true
      break
    fi

    local items
    items=$(echo "$response" | python3 -c "
import json, sys
d = json.load(sys.stdin)
data = d.get('data') or []
print(json.dumps(data))
" 2>/dev/null)

    # Merge into all_items
    all_items=$(python3 -c "
import json, sys
a = json.loads('$all_items' if len('$all_items') < 100000 else sys.stdin.read())
b = json.loads('''$items''')
a.extend(b)
print(json.dumps(a))
" 2>/dev/null <<< "$all_items")

    local has_more
    has_more=$(echo "$response" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ai = d.get('additional_data', {}).get('pagination', {})
print(ai.get('more_items_in_collection', False))
" 2>/dev/null)

    if [ "$has_more" = "True" ] || [ "$has_more" = "true" ]; then
      start=$((start + limit))
      page=$((page + 1))
      echo -n " p${page}"
    else
      break
    fi
  done

  local count
  count=$(echo "$all_items" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null)
  echo " -> $count items"

  echo "$all_items" | python3 -m json.tool > "$OUT_DIR/$filename"
}

# Fetch deal flows (special: keyed by deal ID)
fetch_deal_flows() {
  echo -n "  Fetching deal flows..."

  # Get all deal IDs first
  local deal_ids
  deal_ids=$(python3 -c "
import json
with open('$OUT_DIR/deals.json') as f:
    deals = json.load(f)
for d in deals:
    print(d['id'])
")

  local all_flows="{}"
  local count=0
  local total=$(echo "$deal_ids" | wc -l | tr -d ' ')

  for deal_id in $deal_ids; do
    count=$((count + 1))
    if [ $((count % 50)) -eq 0 ]; then
      echo -n " ${count}/${total}"
    fi

    local url="${BASE_URL}/deals/${deal_id}/flow?api_token=${PIPEDRIVE_API_TOKEN}&items_per_page=100"
    local response
    response=$(curl -s "$url")

    local items
    items=$(echo "$response" | python3 -c "
import json, sys
d = json.load(sys.stdin)
data = d.get('data', []) or []
print(json.dumps(data))
" 2>/dev/null)

    all_flows=$(python3 -c "
import json, sys
flows = json.loads(sys.stdin.read())
items = json.loads('''${items}''')
if items:
    flows['${deal_id}'] = items
print(json.dumps(flows))
" <<< "$all_flows")

    # Rate limit: ~10 req/sec
    sleep 0.1
  done

  echo " -> $count deals processed"
  echo "$all_flows" | python3 -m json.tool > "$OUT_DIR/deal_flows.json"
}

echo "=== Pipedrive Full Data Fetch ==="
echo "Output: $OUT_DIR/"
echo ""

fetch_all "users" "users.json"
fetch_all "pipelines" "pipelines.json"
fetch_all "stages" "stages.json"
fetch_all "organizations" "organizations.json"
fetch_all "persons" "persons.json"
fetch_all "deals" "deals.json"
fetch_all "leads" "leads.json"
fetch_all "activities" "activities.json"
fetch_all "notes" "notes.json"
fetch_all "products" "products.json"
fetch_all "organizationFields" "organization_fields.json"
fetch_all "personFields" "person_fields.json"
fetch_all "dealFields" "deal_fields.json"
fetch_all "activityFields" "activity_fields.json"
fetch_all "noteFields" "note_fields.json"
fetch_all "leadFields" "lead_fields.json"
fetch_all "productFields" "product_fields.json"
fetch_all "currencies" "currencies.json"

echo ""
echo "Fetching deal flows (this takes a while)..."
fetch_deal_flows

echo ""
echo "=== Done! ==="
echo "Data saved to $OUT_DIR/"
echo ""
echo "Next steps:"
echo "  cd crm && pnpm tsx scripts/import-pipedrive.ts"
echo "  cd crm && pnpm tsx scripts/import-deal-flows.ts"
