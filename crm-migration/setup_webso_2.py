#!/usr/bin/env python3
"""
Webso CRM Full Migration  (setup_webso_2.py)
Pipedrive → Twenty CRM  —  direct SQL via psycopg

Resets migrated records first, then inserts all data in order:
  A  Organizations → company
  B  Persons       → person
  C  Deals         → opportunity
  D  Leads         → opportunity  (stage=LEAD)
  E  Notes         → note + noteTarget
  F  Activities    → task + taskTarget
  I  Deal history  → timelineActivity

Usage:
  python setup_webso_2.py              # reset + full migration → Neon
  python setup_webso_2.py --local      # use local DB instead
  python setup_webso_2.py --no-reset   # skip reset
  python setup_webso_2.py --dry-run    # count only, no writes
  python setup_webso_2.py --phase A    # single phase (skips reset)

Custom fields (create in Twenty UI first, skipped gracefully if missing):
  Company:     ytunnus, virallinen_nimi, henkilokunta, liikevaihto,
               perustettu, paatoimiala_tol, paatoimiala_pf,
               markkinointinimi, pipedriveId
  Person:      title, pipedriveId
  Opportunity: pipelineName, pipelineStage, lostReason, probability,
               stageChangedAt, wonAt, lostAt, origin, drive, isLead,
               pipedriveId
  Task:        activityType (SELECT), duration, pipedriveId
"""

import argparse
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv()
DATA_DIR = Path(__file__).parent / "data"

# ── Deterministic UUIDs ───────────────────────────────────────────────────────

NAMESPACE = uuid.UUID("b7e5a3c1-2d4f-4e8a-9b1c-3f7d2e6a8b4c")

def pd_uuid(entity: str, pd_id) -> str:
    return str(uuid.uuid5(NAMESPACE, f"webso:{entity}:{pd_id}"))

# ── Pipedrive users ───────────────────────────────────────────────────────────

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

# ── Stage map ─────────────────────────────────────────────────────────────────

STAGE_MAP = {
    7:  ("UP-SELL",               "Keskustelu avattu",       "UPSELL_KESKUSTELU_AVATTU"),
    8:  ("UP-SELL",               "Tarjous",                 "UPSELL_TARJOUS"),
    26: ("UP-SELL",               "On Hold - Tarjous",       "UPSELL_ON_HOLD"),
    9:  ("UP-SELL",               "Neuvottelu",              "UPSELL_NEUVOTTELU"),
    10: ("Oma myynti",            "Palaveerattu (Icebox)",   "OMA_PALAVEERATTU_ICEBOX"),
    43: ("Oma myynti",            "Soittoon",                "OMA_SOITTOON"),
    11: ("Oma myynti",            "Uudet palaverit",         "OMA_UUDET_PALAVERIT"),
    36: ("Oma myynti",            "Jatkopalsut",             "OMA_JATKOPALSUT"),
    25: ("Oma myynti",            "On Hold",                 "OMA_ON_HOLD"),
    12: ("Oma myynti",            "Proposal Made",           "OMA_PROPOSAL_MADE"),
    13: ("Oma myynti",            "Negotiations Started",    "OMA_NEGOTIATIONS_STARTED"),
    14: ("Sellai",                "Prospect",                "SELLAI_PROSPECT"),
    15: ("Sellai",                "Tried to contact",        "SELLAI_TRIED_TO_CONTACT"),
    16: ("Sellai",                "Value communicated",      "SELLAI_VALUE_COMMUNICATED"),
    17: ("Sellai",                "Meeting arranged",        "SELLAI_MEETING_ARRANGED"),
    18: ("Sellai",                "Proposal sent",           "SELLAI_PROPOSAL_SENT"),
    19: ("Sellai",                "Green light",             "SELLAI_GREEN_LIGHT"),
    27: ("Alihankinta yritykset", "Pekka ollu yhteydessä.",  "ALI_PEKKA_YHTEYDESSA"),
    28: ("Alihankinta yritykset", "Value communicated",      "ALI_VALUE_COMMUNICATED"),
    29: ("Alihankinta yritykset", "Palaveerattu",            "ALI_PALAVEERATTU"),
    30: ("Alihankinta yritykset", "Tarjous lähetetty",       "ALI_TARJOUS_LAHETETTY"),
    31: ("Alihankinta yritykset", "Kauppaa tehty",           "ALI_KAUPPAA_TEHTY"),
    37: ("Alihankinta yritykset", "Epämiellyttävät",         "ALI_EPAMIELLYTTAVAT"),
    32: ("Alihankinta - Bodyshop","Potentiaali",             "BODYSHOP_POTENTIAALI"),
    33: ("Alihankinta - Bodyshop","CV Lähtetty",             "BODYSHOP_CV_LAHETETTY"),
    34: ("Alihankinta - Bodyshop","Haastattelu",             "BODYSHOP_HAASTATTELU"),
    35: ("Alihankinta - Bodyshop","Neuvottelu",              "BODYSHOP_NEUVOTTELU"),
}

ORG_CF = {
    "virallinen_nimi":  "a233077bb653400c6a6fcfebb3851cd4dd039915",
    "ytunnus":          "931425dd4a675487146add0d454d2927ce41f2fc",
    "henkilokunta":     "8e248eb04d03c62894bc34a39a7a395ae5a007fa",
    "liikevaihto":      "312b2fa7cef1b39558d40e2b64e659ccf8993680",
    "perustettu":       "af0ff61c2117c518fd67862bca60dc006cf24eb5",
    "www":              "8c93d48db9e4713a692d2193a3041ceeaeb79aee",
    "paatoimiala_tol":  "54fb878d1bed7f4ece48ca37be3d9102672e0c4e",
    "paatoimiala_pf":   "d0ddd72ec2c009bd6d74ff88f3fbb1831bcf6125",
    "markkinointinimi": "19396b4979bfbc4d1dff20bd4e18934709d069ea",
}
PERSON_CF = {
    "title_en": "4c9293737b1fa9399cb4eeb5c36c5391bc10bddd",
    "title_fi": "e629f88dd960275ca6aadfe10ff8608578433f5c",
}
DEAL_CF = {"drive": "27d4af5421c600368b825b433bae74c2691e19a9"}
ACTIVITY_TYPE_MAP = {
    "call": "CALL", "meeting": "MEETING", "email": "EMAIL",
    "unanswered_call": "UNANSWERED_CALL", "task": "TASK",
    "deadline": "DEADLINE", "lunch": "LUNCH",
    "buukkaus": "BUUKKAUS", "peruttu_palaveri": "PERUTTU_PALAVERI",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

class _HTMLStripper(HTMLParser):
    BLOCK = {"p", "br", "li", "div", "h1", "h2", "h3", "h4", "tr", "td"}
    def __init__(self): super().__init__(); self._parts: list[str] = []
    def handle_data(self, d): self._parts.append(d)
    def handle_starttag(self, tag, attrs):
        if tag in self.BLOCK: self._parts.append("\n")
    def result(self): return re.sub(r"\n{3,}", "\n\n", "".join(self._parts)).strip()

def html_to_text(html: str | None) -> str:
    if not html: return ""
    if "<" not in html: return html.strip()
    s = _HTMLStripper(); s.feed(html); return s.result()

def j(obj) -> str | None:
    return None if obj is None else json.dumps(obj, ensure_ascii=False)

def to_iso(ts: str | None) -> str | None:
    if not ts: return None
    ts = str(ts)
    if "T" in ts: return ts if ts.endswith("Z") else ts + "Z"
    return ts.replace(" ", "T") + "Z"

def map_stage(deal: dict) -> tuple[str, str, str]:
    if deal.get("status") == "won":  return "WON",  "Won",  "–"
    if deal.get("status") == "lost": return "LOST", "Lost", "–"
    e = STAGE_MAP.get(deal.get("stage_id"))
    return (e[2], e[1], e[0]) if e else ("OMA_PALAVEERATTU_ICEBOX", "Palaveerattu (Icebox)", "Oma myynti")

def normalize_phones(phones: list) -> dict:
    if not phones:
        return {"primaryPhoneNumber": "", "primaryPhoneCountryCode": "FI",
                "primaryPhoneCallingCode": "+358", "additionalPhones": []}
    def parse(e):
        n = (e.get("value") or "").strip()
        if n.startswith("+358"): return n, "FI", "+358"
        if n.startswith("+46"):  return n, "SE", "+46"
        if n.startswith("+44"):  return n, "GB", "+44"
        if n.startswith("+1"):   return n, "US", "+1"
        if n.startswith("+"):    return n, "",   n[:4]
        return n, "FI", "+358"
    primary = next((p for p in phones if p.get("primary")), phones[0])
    others  = [p for p in phones if p is not primary and (p.get("value") or "").strip()]
    pn, pcc, pca = parse(primary)
    return {"primaryPhoneNumber": pn, "primaryPhoneCountryCode": pcc,
            "primaryPhoneCallingCode": pca,
            "additionalPhones": [{"number": n, "countryCode": cc, "callingCode": ca}
                                  for n, cc, ca in (parse(p) for p in others) if n]}

def normalize_emails(emails: list) -> dict:
    if not emails: return {"primaryEmail": "", "additionalEmails": []}
    primary = next((e for e in emails if e.get("primary")), emails[0])
    others  = [e["value"] for e in emails if e is not primary and e.get("value")]
    return {"primaryEmail": primary.get("value", ""), "additionalEmails": others}

def normalize_address(addr) -> dict | None:
    if not addr or not isinstance(addr, dict): return None
    street = " ".join(filter(None, [addr.get("route"), addr.get("street_number")])).strip()
    if not street: street = (addr.get("value") or "").split(",")[0].strip()
    city = addr.get("locality") or addr.get("admin_area_level_2")
    if not any([street, city, addr.get("country")]): return None
    return {k: v for k, v in {
        "addressStreet1": street or None, "addressStreet2": addr.get("subpremise") or None,
        "addressCity": city or None, "addressState": addr.get("admin_area_level_1") or None,
        "addressZipCode": addr.get("postal_code") or None, "addressCountry": addr.get("country") or None,
        "addressLat": addr.get("lat"), "addressLng": addr.get("lng"),
    }.items() if v is not None}

def note_title(content: str | None) -> str:
    text = html_to_text(content or "")
    first = text.split("\n")[0].strip()
    return (first[:80] + "…" if len(first) > 80 else first) or "Note"

def parse_due(date_str, time_str) -> str | None:
    if not date_str: return None
    hhmm = (time_str or "00:00").replace(":", "")
    h = hhmm[:2] if len(hhmm) >= 2 else "00"
    m = hhmm[2:4] if len(hhmm) >= 4 else "00"
    return f"{date_str}T{h}:{m}:00Z"

def make_actor(pd_user_id, member_map: dict) -> dict:
    user = PD_USERS.get(pd_user_id, {})
    return {"source": "IMPORT",
            "workspaceMemberId": member_map.get(user.get("email", "")),
            "name": user.get("name", "Pipedrive Migration"), "context": {}}

def load_json(name: str) -> list:
    with open(DATA_DIR / "raw" / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)

# ── DB helpers ────────────────────────────────────────────────────────────────

def get_schema(conn) -> str:
    row = conn.execute("""
        SELECT schema_name FROM information_schema.schemata
        WHERE schema_name LIKE 'workspace_%'
        ORDER BY schema_name LIMIT 1
    """).fetchone()
    if not row:
        raise RuntimeError("No workspace schema found. Run: npx nx database:reset twenty-server")
    return row[0]

def get_columns(conn, schema: str, table: str) -> set[str]:
    rows = conn.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
    """, (schema, table)).fetchall()
    return {r[0] for r in rows}

def get_member_map(conn, schema: str) -> dict[str, str]:
    try:
        rows = conn.execute(
            f'SELECT id, "userEmail" FROM {schema}."workspaceMember"'
        ).fetchall()
        return {r[1]: str(r[0]) for r in rows if r[1]}
    except Exception:
        return {}

def insert(conn, schema: str, table: str, vals: dict, dry_run: bool):
    if dry_run: return
    cols = list(vals.keys())
    col_sql = ", ".join(f'"{c}"' for c in cols)
    ph      = ", ".join(["%s"] * len(cols))
    conn.execute(
        f'INSERT INTO {schema}."{table}" ({col_sql}) VALUES ({ph}) ON CONFLICT (id) DO NOTHING',
        list(vals.values()),
    )

# ── Reset ─────────────────────────────────────────────────────────────────────

def reset(conn, schema: str, dry_run: bool):
    print("  Resetting migrated records (createdBy.source = IMPORT)...")
    tables = ["timelineActivity", "taskTarget", "task",
              "noteTarget", "note", "opportunity", "person", "company"]
    for tbl in tables:
        try:
            if dry_run:
                n = conn.execute(
                    f'SELECT COUNT(*) FROM {schema}."{tbl}" '
                    f'WHERE "createdBy"->>\'source\' = \'IMPORT\''
                ).fetchone()[0]
                print(f"    [dry] would delete {n} from {tbl}")
            else:
                conn.execute(
                    f'DELETE FROM {schema}."{tbl}" '
                    f'WHERE "createdBy"->>\'source\' = \'IMPORT\''
                )
                print(f"    ✓ cleared {tbl}")
        except Exception as e:
            print(f"    ! skipped {tbl}: {e}")
    print()

# ── Phase A — Organizations → company ────────────────────────────────────────

def phase_a(conn, schema, orgs, member_map, dry_run):
    existing = get_columns(conn, schema, "company")
    cf_map = {col: key for col, key in {
        "ytunnus": ORG_CF["ytunnus"], "virallinen_nimi": ORG_CF["virallinen_nimi"],
        "henkilokunta": ORG_CF["henkilokunta"], "liikevaihto": ORG_CF["liikevaihto"],
        "perustettu": ORG_CF["perustettu"], "paatoimiala_tol": ORG_CF["paatoimiala_tol"],
        "paatoimiala_pf": ORG_CF["paatoimiala_pf"],
        "markkinointinimi": ORG_CF["markkinointinimi"],
    }.items() if col in existing}
    has_pd = "pipedriveId" in existing

    n = 0
    for i, org in enumerate(orgs):
        cf    = org.get("custom_fields") or {}
        actor = j(make_actor(org.get("owner_id"), member_map))
        www   = cf.get(ORG_CF["www"]) or org.get("website")
        vals  = {
            "id":        pd_uuid("org", org["id"]),
            "name":      org["name"],
            "domainName": j({"primaryLinkLabel": "", "primaryLinkUrl": www, "secondaryLinks": []}) if www else None,
            "address":   j(normalize_address(org.get("address"))),
            "annualRecurringRevenue": j({"amountMicros": int(float(org["annual_revenue"])) * 1_000_000, "currencyCode": "EUR"}) if org.get("annual_revenue") else None,
            "createdAt": to_iso(org["add_time"]),
            "updatedAt": to_iso(org["update_time"]),
            "deletedAt": to_iso(org["update_time"]) if org.get("is_deleted") else None,
            "position":  float(i + 1),
            "createdBy": actor, "updatedBy": actor,
        }
        for col, key in cf_map.items():
            vals[col] = cf.get(key)
        if has_pd: vals["pipedriveId"] = org["id"]
        insert(conn, schema, "company", vals, dry_run)
        n += 1
    print(f"    {'[dry]' if dry_run else '✓'} {n} companies")
    return n

# ── Phase B — Persons → person ────────────────────────────────────────────────

def phase_b(conn, schema, persons, member_map, dry_run):
    existing  = get_columns(conn, schema, "person")
    has_title = "title"       in existing
    has_pd    = "pipedriveId" in existing
    n = 0
    for i, p in enumerate(persons):
        cf    = p.get("custom_fields") or {}
        actor = j(make_actor(p.get("owner_id"), member_map))
        first = p.get("first_name") or (p.get("name") or "").split()[0]
        last  = p.get("last_name")  or " ".join((p.get("name") or "").split()[1:]) or None
        title = cf.get(PERSON_CF["title_en"]) or cf.get(PERSON_CF["title_fi"])
        vals  = {
            "id":        pd_uuid("person", p["id"]),
            "name":      j({"firstName": first, "lastName": last}),
            "emails":    j(normalize_emails(p.get("emails") or [])),
            "phones":    j(normalize_phones(p.get("phones") or [])),
            "jobTitle":  title,
            "companyId": pd_uuid("org", p["org_id"]) if p.get("org_id") else None,
            "createdAt": to_iso(p["add_time"]), "updatedAt": to_iso(p["update_time"]),
            "deletedAt": to_iso(p["update_time"]) if p.get("is_deleted") else None,
            "position":  float(i + 1),
            "createdBy": actor, "updatedBy": actor,
        }
        if has_title: vals["title"]       = title
        if has_pd:    vals["pipedriveId"] = p["id"]
        insert(conn, schema, "person", vals, dry_run)
        n += 1
    print(f"    {'[dry]' if dry_run else '✓'} {n} people")
    return n

# ── Phase C — Deals → opportunity ────────────────────────────────────────────

def phase_c(conn, schema, deals, member_map, dry_run):
    existing  = get_columns(conn, schema, "opportunity")
    opp_cf    = {col for col in [
        "pipelineName","pipelineStage","lostReason","probability","stageChangedAt",
        "wonAt","lostAt","origin","drive","isLead","pipedriveId",
    ] if col in existing}
    n = 0
    for i, d in enumerate(deals):
        cf    = d.get("custom_fields") or {}
        actor = j(make_actor(d.get("creator_user_id"), member_map))
        sv, sl, pn = map_stage(d)
        owner_id = member_map.get(PD_USERS.get(d.get("owner_id"), {}).get("email", ""))
        close = d.get("expected_close_date") or (to_iso(d["close_time"])[:10] if d.get("close_time") else None)
        vals  = {
            "id":               pd_uuid("deal", d["id"]),
            "name":             d["title"],
            "stage":            sv,
            "closeDate":        close,
            "amount":           j({"amountMicros": int(float(d.get("value") or 0)) * 1_000_000, "currencyCode": d.get("currency", "EUR")}),
            "companyId":        pd_uuid("org",    d["org_id"])    if d.get("org_id")    else None,
            "pointOfContactId": pd_uuid("person", d["person_id"]) if d.get("person_id") else None,
            "ownerId":          owner_id,
            "createdAt":        to_iso(d["add_time"]), "updatedAt": to_iso(d["update_time"]),
            "deletedAt":        to_iso(d["update_time"]) if d.get("is_deleted") else None,
            "position":         float(i + 1),
            "createdBy":        actor, "updatedBy": actor,
        }
        cf_data = {
            "pipelineName": pn, "pipelineStage": sl, "lostReason": d.get("lost_reason"),
            "probability": d.get("probability"), "stageChangedAt": to_iso(d.get("stage_change_time")),
            "wonAt": to_iso(d.get("won_time")), "lostAt": to_iso(d.get("lost_time")),
            "origin": d.get("origin"), "drive": cf.get(DEAL_CF["drive"]),
            "isLead": False, "pipedriveId": str(d["id"]),
        }
        for col in opp_cf: vals[col] = cf_data[col]
        insert(conn, schema, "opportunity", vals, dry_run)
        n += 1
    print(f"    {'[dry]' if dry_run else '✓'} {n} opportunities (deals)")
    return n

# ── Phase D — Leads → opportunity ────────────────────────────────────────────

def phase_d(conn, schema, leads, member_map, dry_run):
    existing  = get_columns(conn, schema, "opportunity")
    opp_cf    = {col for col in ["pipelineName","pipelineStage","isLead","origin","pipedriveId"] if col in existing}
    n = 0
    for i, lead in enumerate(leads):
        actor = j(make_actor(lead.get("creator_id"), member_map))
        owner_id = member_map.get(PD_USERS.get(lead.get("owner_id"), {}).get("email", ""))
        vo = lead.get("value")
        amount = j({"amountMicros": int(vo["amount"]) * 1_000_000, "currencyCode": vo.get("currency","EUR")}) if isinstance(vo, dict) and vo.get("amount") else None
        vals = {
            "id":               pd_uuid("lead", lead["id"]),
            "name":             lead["title"],
            "stage":            "LEAD",
            "closeDate":        lead.get("expected_close_date"),
            "amount":           amount,
            "companyId":        pd_uuid("org",    lead["organization_id"]) if lead.get("organization_id") else None,
            "pointOfContactId": pd_uuid("person", lead["person_id"])       if lead.get("person_id")       else None,
            "ownerId":          owner_id,
            "createdAt":        to_iso(lead["add_time"]), "updatedAt": to_iso(lead["update_time"]),
            "deletedAt":        to_iso(lead.get("archive_time")) if lead.get("is_archived") else None,
            "position":         float(i + 1),
            "createdBy":        actor, "updatedBy": actor,
        }
        cf_data = {"pipelineName": "Leads", "pipelineStage": "Lead", "isLead": True,
                   "origin": lead.get("source_name"), "pipedriveId": str(lead["id"])}
        for col in opp_cf: vals[col] = cf_data[col]
        insert(conn, schema, "opportunity", vals, dry_run)
        n += 1
    print(f"    {'[dry]' if dry_run else '✓'} {n} opportunities (leads)")
    return n

# ── Phase E — Notes ───────────────────────────────────────────────────────────

def phase_e(conn, schema, notes, member_map, dry_run):
    n_n = n_t = 0
    for i, note in enumerate(notes):
        uid   = pd_uuid("note", note["id"])
        actor = j(make_actor(note.get("user_id"), member_map))
        text  = html_to_text(note.get("content"))
        insert(conn, schema, "note", {
            "id": uid, "title": note_title(note.get("content")),
            "bodyV2": j({"blocknote": None, "markdown": text}),
            "position": float(i + 1),
            "createdAt": to_iso(note["add_time"]), "updatedAt": to_iso(note["update_time"]),
            "createdBy": actor, "updatedBy": actor,
        }, dry_run)
        n_n += 1
        targets = []
        if note.get("org_id"):    targets.append(("targetCompanyId",    pd_uuid("org",    note["org_id"])))
        if note.get("person_id"): targets.append(("targetPersonId",     pd_uuid("person", note["person_id"])))
        if note.get("deal_id"):   targets.append(("targetOpportunityId", pd_uuid("deal",  note["deal_id"])))
        elif note.get("lead_id"): targets.append(("targetOpportunityId", pd_uuid("lead",  note["lead_id"])))
        for col, fk in targets:
            insert(conn, schema, "noteTarget", {
                "id": pd_uuid("note_target", f"{note['id']}_{col}"),
                "noteId": uid, col: fk,
                "createdAt": to_iso(note["add_time"]), "updatedAt": to_iso(note["update_time"]),
            }, dry_run)
            n_t += 1
    print(f"    {'[dry]' if dry_run else '✓'} {n_n} notes, {n_t} noteTargets")
    return n_n, n_t

# ── Phase F — Activities → task ───────────────────────────────────────────────

def phase_f(conn, schema, activities, member_map, dry_run):
    existing     = get_columns(conn, schema, "task")
    has_act_type = "activityType" in existing
    has_duration = "duration"     in existing
    has_pd       = "pipedriveId"  in existing
    n_t = n_tg = 0
    for i, act in enumerate(activities):
        uid   = pd_uuid("activity", act["id"])
        actor = j(make_actor(act.get("creator_user_id"), member_map))
        text  = html_to_text(act.get("note"))
        assignee_id = member_map.get(PD_USERS.get(act.get("owner_id"), {}).get("email", ""))
        vals = {
            "id": uid, "title": act.get("subject") or "Activity",
            "status": "DONE" if act.get("done") else "TODO",
            "dueAt": parse_due(act.get("due_date"), act.get("due_time")),
            "bodyV2": j({"blocknote": None, "markdown": text}) if text else None,
            "assigneeId": assignee_id, "position": float(i + 1),
            "createdAt": to_iso(act["add_time"]), "updatedAt": to_iso(act["update_time"]),
            "createdBy": actor, "updatedBy": actor,
        }
        if has_act_type: vals["activityType"] = ACTIVITY_TYPE_MAP.get(act.get("type",""), "TASK")
        if has_duration: vals["duration"]     = act.get("duration")
        if has_pd:       vals["pipedriveId"]  = act["id"]
        insert(conn, schema, "task", vals, dry_run)
        n_t += 1
        targets = []
        if act.get("org_id"):    targets.append(("targetCompanyId",    pd_uuid("org",    act["org_id"])))
        if act.get("person_id"): targets.append(("targetPersonId",     pd_uuid("person", act["person_id"])))
        if act.get("deal_id"):   targets.append(("targetOpportunityId", pd_uuid("deal",  act["deal_id"])))
        elif act.get("lead_id"): targets.append(("targetOpportunityId", pd_uuid("lead",  act["lead_id"])))
        for col, fk in targets:
            insert(conn, schema, "taskTarget", {
                "id": pd_uuid("task_target", f"{act['id']}_{col}"),
                "taskId": uid, col: fk,
                "createdAt": to_iso(act["add_time"]), "updatedAt": to_iso(act["update_time"]),
            }, dry_run)
            n_tg += 1
    print(f"    {'[dry]' if dry_run else '✓'} {n_t} tasks, {n_tg} taskTargets")
    return n_t, n_tg

# ── Phase I — Deal history → timelineActivity ─────────────────────────────────

def phase_i(conn, schema, deal_flows, deals, notes, activities, member_map, dry_run):
    deal_by_id   = {str(d["id"]): d for d in deals}
    note_titles  = {str(n["id"]): note_title(n.get("content")) for n in notes}
    act_subjects = {str(a["id"]): a.get("subject") or "Activity" for a in activities}
    n = 0

    for deal_id_str, events in deal_flows.items():
        deal = deal_by_id.get(deal_id_str)
        if not deal: continue
        opp_uuid   = pd_uuid("deal", int(deal_id_str))
        deal_title = deal["title"]
        last_stage = None

        for event in sorted(events, key=lambda e: e.get("timestamp", "")):
            obj  = event.get("object")
            data = event.get("data") or {}
            ts   = to_iso(event.get("timestamp") or deal["add_time"])
            uid_key = (event.get("timestamp", "") + deal_id_str).replace(" ", "")
            additional = data.get("additional_data") or {}
            member_id  = member_map.get(PD_USERS.get(data.get("user_id"), {}).get("email", ""))

            tl_id = tl_name = properties = None
            linked_rec_id = opp_uuid
            linked_name   = deal_title
            target_note   = target_task = None

            if obj == "dealChange":
                fk, ov, nv = data.get("field_key"), data.get("old_value"), data.get("new_value")
                if fk == "add_time":
                    sv, _, _ = map_stage(deal); last_stage = sv
                    tl_id, tl_name = pd_uuid("tl_created", deal_id_str), "opportunity.created"
                    properties = {"after": {"name": deal_title, "stage": sv,
                        "amount": {"amountMicros": int(float(deal.get("value") or 0)) * 1_000_000,
                                   "currencyCode": deal.get("currency", "EUR")}}}
                elif fk == "stage_id":
                    old_e = STAGE_MAP.get(int(ov)) if ov else None
                    new_e = STAGE_MAP.get(int(nv)) if nv else None
                    old_v = old_e[2] if old_e else last_stage
                    new_v = new_e[2] if new_e else additional.get("new_value_formatted") or str(nv or "")
                    last_stage = new_v
                    tl_id, tl_name = pd_uuid("tl_stage", uid_key), "opportunity.updated"
                    properties = {"diff": {"stage": {"before": old_v, "after": new_v}}}
                elif fk == "status" and nv in ("won", "lost"):
                    new_v = "WON" if nv == "won" else "LOST"; last_stage = new_v
                    tl_id, tl_name = pd_uuid("tl_status", uid_key), "opportunity.updated"
                    properties = {"diff": {"stage": {"before": last_stage, "after": new_v}}}
                elif fk == "user_id":
                    tl_id, tl_name = pd_uuid("tl_owner", uid_key), "opportunity.updated"
                    properties = {"diff": {"owner": {
                        "before": additional.get("old_value_formatted") or str(ov or ""),
                        "after":  additional.get("new_value_formatted") or str(nv or "")}}}
                elif fk == "value":
                    cur = deal.get("currency", "EUR")
                    tl_id, tl_name = pd_uuid("tl_value", uid_key), "opportunity.updated"
                    properties = {"diff": {"amount": {
                        "before": {"amountMicros": int(float(ov or 0)) * 1_000_000, "currencyCode": cur},
                        "after":  {"amountMicros": int(float(nv or 0)) * 1_000_000, "currencyCode": cur}}}}
                elif fk == "person_id":
                    tl_id, tl_name = pd_uuid("tl_person", uid_key), "opportunity.updated"
                    properties = {"diff": {"pointOfContact": {
                        "before": additional.get("old_value_formatted"),
                        "after":  additional.get("new_value_formatted") or str(nv or "")}}}
                elif fk == "expected_close_date":
                    tl_id, tl_name = pd_uuid("tl_closedate", uid_key), "opportunity.updated"
                    properties = {"diff": {"closeDate": {"before": ov, "after": nv}}}
            elif obj == "note":
                note_pd = str(data.get("id", ""))
                title_t = note_titles.get(note_pd, "Note")
                tl_id, tl_name = pd_uuid("tl_note_link", f"{deal_id_str}_{note_pd}"), "linked-note.created"
                properties    = {"diff": {"title": {"before": None, "after": title_t}}}
                linked_rec_id = pd_uuid("note", note_pd) if note_pd else opp_uuid
                linked_name   = title_t
                target_note   = pd_uuid("note", note_pd) if note_pd else None
            elif obj == "activity":
                act_pd = str(data.get("id", ""))
                subj   = act_subjects.get(act_pd, "Activity")
                tl_id, tl_name = pd_uuid("tl_act_link", f"{deal_id_str}_{act_pd}"), "linked-task.created"
                properties    = {"diff": {"title": {"before": None, "after": subj}}}
                linked_rec_id = pd_uuid("activity", act_pd) if act_pd else opp_uuid
                linked_name   = subj
                target_task   = pd_uuid("activity", act_pd) if act_pd else None

            if not (tl_id and tl_name and properties): continue
            tl_vals = {
                "id": tl_id, "name": tl_name, "happensAt": ts,
                "properties": j(properties),
                "linkedRecordId": str(linked_rec_id), "linkedRecordCachedName": linked_name,
                "workspaceMemberId": member_id, "targetOpportunityId": opp_uuid,
                "createdAt": ts, "updatedAt": ts,
            }
            if target_note: tl_vals["targetNoteId"] = target_note
            if target_task: tl_vals["targetTaskId"] = target_task
            insert(conn, schema, "timelineActivity", tl_vals, dry_run)
            n += 1

    print(f"    {'[dry]' if dry_run else '✓'} {n} timeline activities")
    return n

# ── Validation ────────────────────────────────────────────────────────────────

def validate(conn, schema):
    tables = [("company","companies"),("person","people"),("opportunity","opportunities"),
              ("note","notes"),("noteTarget","noteTargets"),("task","tasks"),
              ("taskTarget","taskTargets"),("timelineActivity","timeline events")]
    print("\n  Counts:")
    for tbl, label in tables:
        try:
            total    = conn.execute(f'SELECT COUNT(*) FROM {schema}."{tbl}"').fetchone()[0]
            migrated = conn.execute(
                f'SELECT COUNT(*) FROM {schema}."{tbl}" WHERE "createdBy"->>\'source\' = \'IMPORT\''
            ).fetchone()[0] if tbl not in ("noteTarget","taskTarget","timelineActivity") else "–"
            print(f"    {label:<22} total={total:<6} migrated={migrated}")
        except Exception as e:
            print(f"    {label:<22} ERROR: {e}")

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local",    action="store_true", help="Use local DB (default: Neon)")
    parser.add_argument("--no-reset", action="store_true", help="Skip reset")
    parser.add_argument("--dry-run",  action="store_true")
    parser.add_argument("--phase",    choices=["A","B","C","D","E","F","I","all"], default="all")
    args = parser.parse_args()

    db_url = os.getenv("DATABASE_URL" if args.local else "PG_DATABASE_URL")
    if not db_url:
        sys.exit("ERROR: PG_DATABASE_URL not set in .env")

    single_phase = args.phase != "all"
    do_reset     = not args.no_reset and not single_phase

    print(f"\n{'='*60}")
    print(f"  Webso CRM Migration v2  phase={args.phase}")
    print(f"  DB: {'Local' if args.local else 'Neon'}  |  Reset: {'yes' if do_reset else 'no'}  |  Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"{'='*60}\n")

    orgs       = load_json("organizations")
    persons    = load_json("persons")
    deals      = load_json("deals")
    leads      = load_json("leads")
    notes      = load_json("notes")
    activities = load_json("activities")
    flows_path = DATA_DIR / "raw" / "deal_flows.json"
    deal_flows = json.loads(flows_path.read_text(encoding="utf-8")) if flows_path.exists() else {}
    print(f"  {len(orgs)} orgs  {len(persons)} persons  {len(deals)} deals  {len(leads)} leads  {len(notes)} notes  {len(activities)} activities  {len(deal_flows)} flows\n")

    with psycopg.connect(db_url) as conn:
        schema     = get_schema(conn)
        member_map = get_member_map(conn, schema)
        print(f"  Schema: {schema}")
        print(f"  Members: {list(member_map.keys()) or 'none (workspace members not found)'}\n")

        if do_reset:
            reset(conn, schema, args.dry_run)

        p = args.phase
        if p in ("A","all"): phase_a(conn, schema, orgs,       member_map, args.dry_run)
        if p in ("B","all"): phase_b(conn, schema, persons,    member_map, args.dry_run)
        if p in ("C","all"): phase_c(conn, schema, deals,      member_map, args.dry_run)
        if p in ("D","all"): phase_d(conn, schema, leads,      member_map, args.dry_run)
        if p in ("E","all"): phase_e(conn, schema, notes,      member_map, args.dry_run)
        if p in ("F","all"): phase_f(conn, schema, activities, member_map, args.dry_run)
        if p in ("I","all"): phase_i(conn, schema, deal_flows, deals, notes, activities, member_map, args.dry_run)

        validate(conn, schema)
        print("\nDone.")

if __name__ == "__main__":
    main()
