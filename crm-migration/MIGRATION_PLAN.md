# Pipedrive → Twenty CRM Migration Plan

Generated: 2026-03-16
Based on: live Pipedrive data export (see `data/raw/`)

---

## Table of Contents

1. [Data Inventory](#1-data-inventory)
2. [Architecture Decisions](#2-architecture-decisions)
3. [Stage & Pipeline Mapping](#3-stage--pipeline-mapping)
4. [User Mapping](#4-user-mapping)
5. [Custom Fields to Create in Twenty](#5-custom-fields-to-create-in-twenty)
6. [Migration Order (dependency chain)](#6-migration-order-dependency-chain)
7. [Phase A — Organizations → Companies](#phase-a--organizations--companies)
8. [Phase B — Persons → People](#phase-b--persons--people)
9. [Phase C — Deals → Opportunities](#phase-c--deals--opportunities)
10. [Phase D — Leads → Opportunities (lead pool)](#phase-d--leads--opportunities-lead-pool)
11. [Phase E — Notes](#phase-e--notes)
12. [Phase F — Activities → Tasks + Timeline](#phase-f--activities--tasks--timeline)
13. [Phase G — Products (custom object)](#phase-g--products-custom-object)
14. [Phase H — Timeline History synthesis](#phase-h--timeline-history-synthesis)
15. [Phase I — Deal History (dealChange feed)](#phase-i--deal-history-dealchange-feed)
16. [Validation Checklist](#16-validation-checklist)
17. [ID Mapping File Strategy](#17-id-mapping-file-strategy)
17. [Script Execution Order](#17-script-execution-order)

---

## 1. Data Inventory

| Object          | Records | Notes |
|-----------------|--------:|-------|
| Organizations   | 2,067   | 39% have address data |
| Persons         | 2,864   | 81% linked to org, 67% have email, 91% have phone |
| Deals           | 483     | 328 open, 30 won, 125 lost |
| Leads           | 260     | 99% linked to org, 97% linked to person |
| Activities      | 6,081   | 94% done; 9 types (call, meeting, email, unanswered_call, buukkaus, peruttu_palaveri, task, deadline, lunch) |
| Notes           | 1,585   | 99% linked to org, 89% to person, 58% to deal |
| Products        | 14      | No native Twenty equivalent |
| Pipelines       | 5       | See stage mapping |
| Stages          | 27      | Across 5 pipelines |
| Users           | 11      | 3 currently active |

**Total records to migrate: ~13,400**

---

## 2. Architecture Decisions

### 2.1 Deals and Leads → both become Opportunities

Pipedrive separates *Leads* (pre-qualification inbox) from *Deals* (active pipeline). Twenty has only `Opportunity`. Map both as follows:

| Source             | Twenty stage              | Notes |
|--------------------|---------------------------|-------|
| Pipedrive Lead     | `LEAD` (new custom stage) | Treat as top-of-funnel |
| Deal status=open   | Map from pipeline stage   | See §3 |
| Deal status=won    | `WON`                     | |
| Deal status=lost   | `LOST`                    | |

### 2.2 Five pipelines → one Opportunity object with a `pipeline` field

Twenty has a single `stage` field (SELECT) on Opportunity. With 5 pipelines and 27 stages, combine them into one flat stage list, prefixed with pipeline name to avoid collision:

```
UP-SELL / Keskustelu avattu
UP-SELL / Tarjous
UP-SELL / On Hold - Tarjous
UP-SELL / Neuvottelu
OMA / Palaveerattu (Icebox)
OMA / Soittoon
...etc
```

Additionally, add a custom `TEXT` field `pipelineName` to Opportunity so records are filterable by pipeline.

### 2.3 Activities split by type

Pipedrive activities become **Tasks** in Twenty, with activity type stored in a custom `activityType` SELECT field. Activities with `done=false` stay as open tasks. The full rich content (HTML notes) of each activity becomes the task body.

### 2.4 Activity type `buukkaus` and `peruttu_palaveri`

These are custom Pipedrive activity types unique to Webso. They will be mapped to the custom `activityType` field as `BUUKKAUS` and `PERUTTU_PALAVERI`.

### 2.5 Products

Twenty has no native product/line-item entity. Options:
- **Option A (recommended):** Create a custom object `Product` in Twenty with fields: name, price, currency, billingFrequency, code. Link to Opportunities via a custom relation.
- **Option B (simple):** Skip products for now — 14 records, low priority.

This plan uses **Option A**.

### 2.6 Timestamps preservation

Twenty allows setting `createdAt` and `updatedAt` directly via SQL insert. All Pipedrive `add_time` values will be written to `createdAt` and `update_time` to `updatedAt`, preserving the full history.

### 2.7 `createdBy` attribution

All migrated records get:
```json
{
  "source": "IMPORT",
  "workspaceMemberId": null,
  "name": "Pipedrive Migration"
}
```

For records where we know the Pipedrive `owner_id`, we look up the workspace member mapping (§4) and set `workspaceMemberId` + `name` accordingly.

---

## 3. Stage & Pipeline Mapping

### Twenty stage SELECT values to create on Opportunity

```
# Shared / System
LEAD                          ← Pipedrive Leads inbox
WON                           ← won deals
LOST                          ← lost deals

# Pipeline: UP-SELL
UPSELL_KESKUSTELU_AVATTU
UPSELL_TARJOUS
UPSELL_ON_HOLD
UPSELL_NEUVOTTELU

# Pipeline: Oma myynti
OMA_PALAVEERATTU_ICEBOX
OMA_SOITTOON
OMA_UUDET_PALAVERIT
OMA_JATKOPALSUT
OMA_ON_HOLD
OMA_PROPOSAL_MADE
OMA_NEGOTIATIONS_STARTED

# Pipeline: Sellai
SELLAI_PROSPECT
SELLAI_TRIED_TO_CONTACT
SELLAI_VALUE_COMMUNICATED
SELLAI_MEETING_ARRANGED
SELLAI_PROPOSAL_SENT
SELLAI_GREEN_LIGHT

# Pipeline: Alihankinta yritykset
ALI_PEKKA_YHTEYDESSA
ALI_VALUE_COMMUNICATED
ALI_PALAVEERATTU
ALI_TARJOUS_LAHETETTY
ALI_KAUPPAA_TEHTY
ALI_EPAMIELLYTTAVAT

# Pipeline: Alihankinta Bodyshop
BODYSHOP_POTENTIAALI
BODYSHOP_CV_LAHETETTY
BODYSHOP_HAASTATTELU
BODYSHOP_NEUVOTTELU
```

### Pipedrive stage_id → Twenty stage mapping

| PD pipeline       | PD stage_id | PD stage name              | Twenty stage value           |
|-------------------|-------------|----------------------------|------------------------------|
| UP-SELL (2)       | 7           | Keskustelu avattu          | UPSELL_KESKUSTELU_AVATTU     |
| UP-SELL (2)       | 8           | Tarjous                    | UPSELL_TARJOUS               |
| UP-SELL (2)       | 26          | On Hold - Tarjous          | UPSELL_ON_HOLD               |
| UP-SELL (2)       | 9           | Neuvottelu                 | UPSELL_NEUVOTTELU            |
| Oma myynti (3)    | 10          | Palaveerattu (Icebox)      | OMA_PALAVEERATTU_ICEBOX      |
| Oma myynti (3)    | 43          | Soittoon                   | OMA_SOITTOON                 |
| Oma myynti (3)    | 11          | Uudet palaverit            | OMA_UUDET_PALAVERIT          |
| Oma myynti (3)    | 36          | Jatkopalsut                | OMA_JATKOPALSUT              |
| Oma myynti (3)    | 25          | On Hold                    | OMA_ON_HOLD                  |
| Oma myynti (3)    | 12          | Proposal Made              | OMA_PROPOSAL_MADE            |
| Oma myynti (3)    | 13          | Negotiations Started       | OMA_NEGOTIATIONS_STARTED     |
| Sellai (4)        | 14          | Prospect                   | SELLAI_PROSPECT              |
| Sellai (4)        | 15          | Tried to contact           | SELLAI_TRIED_TO_CONTACT      |
| Sellai (4)        | 16          | Value communicated         | SELLAI_VALUE_COMMUNICATED    |
| Sellai (4)        | 17          | Meeting arranged           | SELLAI_MEETING_ARRANGED      |
| Sellai (4)        | 18          | Proposal sent              | SELLAI_PROPOSAL_SENT         |
| Sellai (4)        | 19          | Green light                | SELLAI_GREEN_LIGHT           |
| Alihankinta (6)   | 27          | Pekka ollu yhteydessä      | ALI_PEKKA_YHTEYDESSA         |
| Alihankinta (6)   | 28          | Value communicated         | ALI_VALUE_COMMUNICATED       |
| Alihankinta (6)   | 29          | Palaveerattu               | ALI_PALAVEERATTU             |
| Alihankinta (6)   | 30          | Tarjous lähetetty          | ALI_TARJOUS_LAHETETTY        |
| Alihankinta (6)   | 31          | Kauppaa tehty              | ALI_KAUPPAA_TEHTY            |
| Alihankinta (6)   | 37          | Epämiellyttävät            | ALI_EPAMIELLYTTAVAT          |
| Bodyshop (7)      | 32          | Potentiaali                | BODYSHOP_POTENTIAALI         |
| Bodyshop (7)      | 33          | CV Lähtetty                | BODYSHOP_CV_LAHETETTY        |
| Bodyshop (7)      | 34          | Haastattelu                | BODYSHOP_HAASTATTELU         |
| Bodyshop (7)      | 35          | Neuvottelu                 | BODYSHOP_NEUVOTTELU          |
| *(leads)*         | —           | *(no stage)*               | LEAD                         |
| *(won deals)*     | —           | *(status=won)*             | WON                          |
| *(lost deals)*    | —           | *(status=lost)*            | LOST                         |

---

## 4. User Mapping

Map Pipedrive user IDs to Twenty workspace member UUIDs. After workspace setup, query:

```sql
SELECT id, "userEmail", name FROM workspace_<id>."workspaceMember";
```

| PD user_id | Name               | Email                     | Active | Twenty member UUID       |
|------------|--------------------|---------------------------|--------|--------------------------|
| 14953704   | Pekka Mattinen     | pekka@webso.fi            | ✅     | *(look up after setup)*  |
| 30071928   | Juuso Käyhkö       | juuso@webso.fi            | ✅     | *(look up after setup)*  |
| 23011193   | Buukkarit          | myynti@webso.fi           | ✅     | *(look up after setup)*  |
| 14953693   | Aleksi Puttonen    | aleksi@webso.fi           | ❌     | null (inactive)          |
| 21113836   | El Dictator        | mikko.mattinen@webso.fi   | ❌     | null                     |
| 20319999   | Jimi Hiltunen      | jimi@webso.fi             | ❌     | null                     |
| 16135335   | Juho               | juho@webso.fi             | ❌     | null                     |
| 14953726   | Matias Nieminen    | matias@webso.fi           | ❌     | null                     |
| 14953715   | Roope Lassila      | roope@webso.fi            | ❌     | null                     |
| 22319227   | Sampo Puheloinen   | sampo@webso.fi            | ❌     | null                     |
| 17287783   | Sauli              | sauli@webso.fi            | ❌     | null                     |

Save this as `data/user_map.json` before running migration scripts.

---

## 5. Custom Fields to Create in Twenty

These must be created **before** running migration scripts (via Twenty UI or API).

### 5.1 On Company

| Field name        | Type    | Source                                  |
|-------------------|---------|-----------------------------------------|
| `ytunnus`         | TEXT    | PD org custom: Y-tunnus                 |
| `virallinen_nimi` | TEXT    | PD org custom: Virallinen nimi          |
| `henkilokunta`    | TEXT    | PD org custom: Henkilökuntaluokka       |
| `liikevaihto`     | TEXT    | PD org custom: Liikevaihtoluokka        |
| `perustettu`      | DATE    | PD org custom: Perustettu               |
| `paatoimiala_tol` | TEXT    | PD org custom: Päätoimiala (TOL 2008)   |
| `paatoimiala_pf`  | TEXT    | PD org custom: Päätoimiala (Profinder)  |
| `markkinointinimi`| TEXT    | PD org custom: Markkinointinimi         |
| `labelIds`        | TEXT    | PD label_ids (store as comma-separated) |
| `pipedriveId`     | NUMBER  | Original PD id for reference            |

**Note:** `website` and `phone` map to Twenty's existing `domainName` (LinksMetadata) and a custom `phone` TEXT field. The address maps to Twenty's native `address` (AddressMetadata) — but that's on Company, not Person. PD person address goes into a custom TEXT field `address` on Person since Twenty's address is on Company.

### 5.2 On Person

| Field name   | Type    | Source                              |
|--------------|---------|-------------------------------------|
| `title`      | TEXT    | PD person custom: Title / Titteli   |
| `labelIds`   | TEXT    | PD label_ids                        |
| `pipedriveId`| NUMBER  | Original PD id                      |

### 5.3 On Opportunity

| Field name        | Type    | Source                              |
|-------------------|---------|-------------------------------------|
| `pipelineName`    | TEXT    | PD pipeline name                    |
| `pipelineStage`   | TEXT    | PD stage name (human-readable)      |
| `lostReason`      | TEXT    | PD lost_reason                      |
| `probability`     | NUMBER  | PD probability (0–100)              |
| `stageChangedAt`  | DATE_TIME | PD stage_change_time              |
| `wonAt`           | DATE_TIME | PD won_time                       |
| `lostAt`          | DATE_TIME | PD lost_time                      |
| `origin`          | TEXT    | PD origin (ManuallyCreated / Zapier)|
| `drive`           | TEXT    | PD custom: DRIVE field              |
| `isLead`          | BOOLEAN | True if source is Pipedrive Lead    |
| `labelIds`        | TEXT    | PD label_ids                        |
| `pipedriveId`     | TEXT    | Original PD id (string for leads)   |

### 5.4 On Task

| Field name      | Type   | Source                                         |
|-----------------|--------|------------------------------------------------|
| `activityType`  | SELECT | PD activity type                               |
| `duration`      | TEXT   | PD duration (e.g. "01:30")                     |
| `pipedriveId`   | NUMBER | Original PD activity id                        |

`activityType` SELECT options: `CALL`, `MEETING`, `EMAIL`, `UNANSWERED_CALL`, `TASK`, `DEADLINE`, `LUNCH`, `BUUKKAUS`, `PERUTTU_PALAVERI`

---

## 6. Migration Order (dependency chain)

```
1. Users (workspace members) — must exist first
2. Companies (organizations) — no dependencies
3. People (persons)          — depends on Companies
4. Opportunities (deals)     — depends on Companies + People
5. Opportunities (leads)     — depends on Companies + People
6. Notes                     — depends on Companies + People + Opportunities
7. Tasks (activities)        — depends on Companies + People + Opportunities
8. TimelineActivities        — depends on all above
```

Do NOT insert notes/tasks before opportunities, as the junction table FKs will fail.

---

## Phase A — Organizations → Companies

### Fields

| Pipedrive field         | Twenty field                    | Transform                            |
|-------------------------|---------------------------------|--------------------------------------|
| `id`                    | `pipedriveId`                   | Store for ID mapping                 |
| `name`                  | `name`                          | Direct                               |
| `address.value`         | `address.addressStreet1`        | Full address string → parse          |
| `address.route`         | `address.addressStreet1`        | Street name                          |
| `address.street_number` | (append to addressStreet1)      |                                      |
| `address.city` / `locality` | `address.addressCity`       |                                      |
| `address.postal_code`   | `address.addressZipCode`        |                                      |
| `address.country`       | `address.addressCountry`        |                                      |
| `website`               | `domainName.primaryLinkUrl`     | If non-empty                         |
| `owner_id`              | `accountOwnerId`                | Via user_map                         |
| `add_time`              | `createdAt`                     | Preserve                             |
| `update_time`           | `updatedAt`                     | Preserve                             |
| `custom_fields[Y-tunnus]`           | `ytunnus`          | Hash key lookup                      |
| `custom_fields[Virallinen nimi]`    | `virallinen_nimi`  |                                      |
| `custom_fields[Henkilökuntaluokka]` | `henkilokunta`     |                                      |
| `custom_fields[Liikevaihtoluokka]`  | `liikevaihto`      |                                      |
| `custom_fields[Perustettu]`         | `perustettu`       |                                      |
| `custom_fields[Päätoimiala TOL]`    | `paatoimiala_tol`  |                                      |
| `custom_fields[Päätoimiala Profinder]` | `paatoimiala_pf`|                                      |
| `custom_fields[Markkinointinimi]`   | `markkinointinimi` |                                      |
| `custom_fields[Puhelin]`            | (store in note or skip) | PD phone on org — Twenty Company has no phone |
| `label_ids`             | `labelIds`                      | JSON array → comma-separated string  |
| `is_deleted`            | `deletedAt`                     | If true, set `deletedAt = update_time` |
| `annual_revenue`        | `annualRecurringRevenue.amountMicros` | × 1,000,000 if present        |

### Custom field hash keys (from data/schemas/custom_fields.json)

```python
ORG_FIELD_KEYS = {
    "virallinen_nimi":  "a233077bb653400c6a6fcfebb3851cd4dd039915",
    "ytunnus":          "931425dd4a675487146add0d454d2927ce41f2fc",
    "henkilokunta":     "8e248eb04d03c62894bc34a39a7a395ae5a007fa",
    "liikevaihto":      "312b2fa7cef1b39558d40e2b64e659ccf8993680",
    "perustettu":       "af0ff61c2117c518fd67...",  # check full key in custom_fields.json
    "www":              "8c93d48db9e4713a692d...",
    "puhelin":          "b5d9fd1785600dc630e1...",
    "paatoimiala_tol":  "54fb878d1bed7f4ece48...",
    "paatoimiala_pf":   "d0ddd72ec2c009bd6d74...",
    "markkinointinimi": "19396b4979bfbc4d1dff...",
}
```

Get full keys from: `python3 -c "import json; cf=json.load(open('data/schemas/custom_fields.json')); [print(f['key'], f['name']) for f in cf['organizations']]"`

### Expected output
- ~2,067 Company rows in Twenty
- ID map saved to `data/id_maps/companies.json` as `{ "pd_id": "twenty_uuid", ... }`

---

## Phase B — Persons → People

### Fields

| Pipedrive field         | Twenty field                    | Transform                            |
|-------------------------|---------------------------------|--------------------------------------|
| `id`                    | `pipedriveId`                   | Store for ID mapping                 |
| `first_name`            | `name.firstName`                | Direct                               |
| `last_name`             | `name.lastName`                 | Direct (fallback: empty string)      |
| `emails[*].value`       | `emails.primaryEmail` / `additionalEmails` | First primary, rest additional |
| `phones[*].value`       | `phones.primaryPhoneNumber` / `additionalPhones` | First primary, rest additional |
| `phones[*].label`       | `phones.primaryPhoneCountryCode`| — actually store label, not code     |
| `org_id`                | `companyId`                     | Via company ID map                   |
| `owner_id`              | (no direct field — use `createdBy.workspaceMemberId`) | |
| `add_time`              | `createdAt`                     |                                      |
| `update_time`           | `updatedAt`                     |                                      |
| `custom_fields[Title]`  | `title`                         | Hash key: `4c9293737b1fa9399cb4...`  |
| `custom_fields[Titteli]`| `title` (prefer if Title empty) | Hash key: `e629f88dd960275ca6aa...`  |
| `custom_fields[Osoite]` | (skip — Twenty Person has no address) | Or store as note           |
| `label_ids`             | `labelIds`                      |                                      |
| `is_deleted`            | `deletedAt`                     |                                      |

### Phone number handling

Pipedrive phones come as:
```json
[{"label": "work", "value": "0405472446", "primary": true}]
```

Map to Twenty PhonesMetadata:
```json
{
  "primaryPhoneNumber": "0405472446",
  "primaryPhoneCountryCode": "FI",
  "primaryPhoneCallingCode": "+358",
  "additionalPhones": []
}
```

**Country code inference:** Most numbers are Finnish. Apply heuristic: if number starts with `+358` it's Finnish, `+46` Swedish, `+1` US/CA, otherwise default to `FI` + `+358` for bare numbers.

### Expected output
- ~2,864 Person rows
- ID map: `data/id_maps/persons.json`

---

## Phase C — Deals → Opportunities

### Fields

| Pipedrive field         | Twenty field                    | Transform                            |
|-------------------------|---------------------------------|--------------------------------------|
| `id`                    | `pipedriveId`                   |                                      |
| `title`                 | `name`                          |                                      |
| `value`                 | `amount.amountMicros`           | × 1,000,000 (even if 0.0)            |
| `currency`              | `amount.currencyCode`           | e.g. "EUR"                           |
| `stage_id`              | `stage`                         | Via stage map (§3)                   |
| `status`                | `stage`                         | won → WON, lost → LOST (overrides stage_id map) |
| `pipeline_id`           | `pipelineName`                  | Via pipeline name lookup             |
| `stage_id`              | `pipelineStage`                 | Human-readable stage name            |
| `expected_close_date`   | `closeDate`                     | ISO date                             |
| `close_time`            | `closeDate` (fallback)          | If expected_close_date is null       |
| `lost_reason`           | `lostReason`                    |                                      |
| `probability`           | `probability`                   |                                      |
| `stage_change_time`     | `stageChangedAt`                |                                      |
| `won_time`              | `wonAt`                         |                                      |
| `lost_time`             | `lostAt`                        |                                      |
| `org_id`                | `companyId`                     | Via company ID map                   |
| `person_id`             | `pointOfContactId`              | Via person ID map                    |
| `owner_id`              | `ownerId`                       | Via user map                         |
| `creator_user_id`       | `createdBy.workspaceMemberId`   | Via user map                         |
| `origin`                | `origin`                        |                                      |
| `label_ids`             | `labelIds`                      |                                      |
| `is_deleted`            | `deletedAt`                     |                                      |
| `add_time`              | `createdAt`                     |                                      |
| `update_time`           | `updatedAt`                     |                                      |
| `custom_fields[DRIVE]`  | `drive`                         | Hash key: `27d4af5421c600368b82...`  |

### Deal status → stage logic

```python
def map_stage(deal):
    if deal['status'] == 'won':
        return 'WON'
    elif deal['status'] == 'lost':
        return 'LOST'
    else:  # open
        return STAGE_MAP[deal['stage_id']]
```

### Expected output
- ~483 Opportunity rows
- ID map: `data/id_maps/deals.json`

---

## Phase D — Leads → Opportunities (lead pool)

Pipedrive Leads are pre-deal, unqualified entries. In Twenty, they become Opportunities with `stage = LEAD` and `isLead = true`.

### Fields

| Pipedrive field      | Twenty field          | Transform                            |
|----------------------|-----------------------|--------------------------------------|
| `id` (UUID string)   | `pipedriveId`         | Store UUID as string                 |
| `title`              | `name`                |                                      |
| `value.amount`       | `amount.amountMicros` | × 1,000,000 (only 1.5% have value)  |
| `value.currency`     | `amount.currencyCode` |                                      |
| `organization_id`    | `companyId`           | Via company ID map                   |
| `person_id`          | `pointOfContactId`    | Via person ID map                    |
| `owner_id`           | `ownerId`             | Via user map                         |
| `expected_close_date`| `closeDate`           |                                      |
| `add_time`           | `createdAt`           |                                      |
| `update_time`        | `updatedAt`           |                                      |
| `source_name`        | `origin`              |                                      |
| `is_archived`        | `deletedAt`           | If archived, set deletedAt           |
| *(implicit)*         | `stage`               | Always `LEAD`                        |
| *(implicit)*         | `isLead`              | Always `true`                        |
| *(implicit)*         | `pipelineName`        | "Leads"                              |

### Expected output
- ~260 Opportunity rows (appended to deal map)
- ID map: `data/id_maps/leads.json`

---

## Phase E — Notes

One Note + one or more NoteTarget rows per Pipedrive note.

### Note row

| Pipedrive field   | Twenty field              | Transform                              |
|-------------------|---------------------------|----------------------------------------|
| `id`              | (store in id map)         |                                        |
| `content`         | `bodyV2.markdown`         | HTML → strip tags or keep as markdown  |
| `content`         | `title`                   | First 80 chars of content (truncated)  |
| `add_time`        | `createdAt`               |                                        |
| `update_time`     | `updatedAt`               |                                        |
| `user_id`         | `createdBy.workspaceMemberId` | Via user map                       |

### NoteTarget rows

For each Pipedrive note, create one `NoteTarget` row per linked entity:

```python
def create_note_targets(note, note_uuid, company_map, person_map, deal_map, lead_map):
    targets = []

    if note.get('org_id'):
        targets.append({
            'noteId': note_uuid,
            'targetCompanyId': company_map[note['org_id']]
        })

    if note.get('person_id'):
        targets.append({
            'noteId': note_uuid,
            'targetPersonId': person_map[note['person_id']]
        })

    if note.get('deal_id') and note['deal_id'] in deal_map:
        targets.append({
            'noteId': note_uuid,
            'targetOpportunityId': deal_map[note['deal_id']]
        })

    if note.get('lead_id') and note['lead_id'] in lead_map:
        targets.append({
            'noteId': note_uuid,
            'targetOpportunityId': lead_map[note['lead_id']]
        })

    return targets
```

**Important:** A note linked to both an org AND a person AND a deal will have 3 separate NoteTarget rows. This is correct — Twenty supports multi-linking.

### HTML content handling

Pipedrive notes contain HTML (`<p>`, `<ul>`, `<li>`, `<br>`, `<a>`). Options:
- **Convert to markdown** using `markdownify` library (recommended)
- **Strip to plain text** using `BeautifulSoup`

Install: `pip install markdownify beautifulsoup4`

### Expected output
- ~1,585 Note rows
- ~3,600 NoteTarget rows (avg ~2.3 targets per note based on coverage stats)
- ID map: `data/id_maps/notes.json`

---

## Phase F — Activities → Tasks + Timeline

### Task row

| Pipedrive field       | Twenty field                | Transform                              |
|-----------------------|-----------------------------|----------------------------------------|
| `id`                  | `pipedriveId`               |                                        |
| `subject`             | `title`                     |                                        |
| `note`                | `bodyV2.markdown`           | HTML → markdown (same as notes)        |
| `due_date` + `due_time` | `dueAt`                   | Combine: `2024-03-15T14:00:00Z`        |
| `done`                | `status`                    | true → "DONE", false → "TODO"          |
| `type`                | `activityType`              | Custom field, see SELECT options       |
| `duration`            | `duration`                  | Custom TEXT field                      |
| `owner_id`            | `assigneeId`                | Via user map                           |
| `add_time`            | `createdAt`                 |                                        |
| `update_time`         | `updatedAt`                 |                                        |

### TaskTarget rows

```python
def create_task_targets(activity, task_uuid, company_map, person_map, deal_map, lead_map):
    targets = []

    if activity.get('org_id') and activity['org_id'] in company_map:
        targets.append({'taskId': task_uuid, 'targetCompanyId': company_map[activity['org_id']]})

    if activity.get('person_id') and activity['person_id'] in person_map:
        targets.append({'taskId': task_uuid, 'targetPersonId': person_map[activity['person_id']]})

    if activity.get('deal_id') and activity['deal_id'] in deal_map:
        targets.append({'taskId': task_uuid, 'targetOpportunityId': deal_map[activity['deal_id']]})

    if activity.get('lead_id') and activity['lead_id'] in lead_map:
        targets.append({'taskId': task_uuid, 'targetOpportunityId': lead_map[activity['lead_id']]})

    return targets
```

### Activity type mapping

| Pipedrive type         | `activityType` value    |
|------------------------|-------------------------|
| `call`                 | `CALL`                  |
| `meeting`              | `MEETING`               |
| `email`                | `EMAIL`                 |
| `unanswered_call`      | `UNANSWERED_CALL`       |
| `task`                 | `TASK`                  |
| `deadline`             | `DEADLINE`              |
| `lunch`                | `LUNCH`                 |
| `buukkaus`             | `BUUKKAUS`              |
| `peruttu_palaveri`     | `PERUTTU_PALAVERI`      |

### Expected output
- ~6,081 Task rows
- ~8,000–10,000 TaskTarget rows
- ID map: `data/id_maps/activities.json`

---

## Phase G — Products (custom object)

Create a custom object in Twenty called `Product` with these fields:

| Field            | Type    | Source                    |
|------------------|---------|---------------------------|
| `name`           | TEXT    | `name`                    |
| `code`           | TEXT    | `code`                    |
| `price`          | NUMBER  | `prices[0].price`         |
| `currency`       | TEXT    | `prices[0].currency`      |
| `cost`           | NUMBER  | `prices[0].cost`          |
| `billingFrequency` | SELECT | `billing_frequency`      |
| `tax`            | NUMBER  | `tax` (%)                 |
| `pipedriveId`    | NUMBER  | `id`                      |

`billingFrequency` SELECT options: `ONE_TIME`, `MONTHLY`, `YEARLY`, `WEEKLY`

After creating the custom object, also create a relation from `Opportunity` to `Product` (many-to-many via a junction custom object, or a simple text field listing product IDs for now — only 14 products exist so a TEXT field `productNames` on Opportunity is sufficient short-term).

---

## Phase H — Timeline History synthesis

After all records are migrated, insert `TimelineActivity` rows to reconstruct a meaningful activity feed for each record. This is what powers the history timeline visible on each Company/Person/Opportunity page.

### What to insert

**1. For each Deal/Lead — creation event**
```python
{
    "happensAt": deal["add_time"],
    "name": "opportunity.created",
    "properties": {
        "source": "Pipedrive",
        "pipeline": deal["pipeline_name"],
        "stage": stage_name,
        "value": deal["value"],
        "currency": deal["currency"]
    },
    "targetOpportunityId": opportunity_uuid,
    "linkedRecordId": opportunity_uuid
}
```

**2. For each Activity (by type) — use to power timeline**
```python
{
    "happensAt": activity["add_time"],
    "name": f"activity.{activity['type']}",  # e.g. "activity.call"
    "properties": {
        "subject": activity["subject"],
        "type": activity["type"],
        "duration": activity.get("duration"),
        "done": activity["done"],
        "note": strip_html(activity.get("note", ""))[:500]  # truncate
    },
    "targetCompanyId": company_map.get(activity["org_id"]),
    "targetPersonId": person_map.get(activity["person_id"]),
    "targetOpportunityId": deal_map.get(activity.get("deal_id")),
    "linkedRecordId": primary_linked_id,
    "linkedRecordCachedName": primary_linked_name
}
```

**3. For won/lost deals — status change events**
```python
{
    "happensAt": deal["won_time"] or deal["lost_time"],
    "name": "opportunity.statusChanged",
    "properties": {
        "status": deal["status"],
        "lostReason": deal.get("lost_reason")
    }
}
```

### Expected output
- ~10,000–15,000 TimelineActivity rows

---

## Phase I — Deal History (dealChange feed)

### Why this matters

This is the closest equivalent to Pipedrive's deal timeline. The Pipedrive `/v1/deals/{id}/flow` endpoint returns every field change ever made to a deal, with exact timestamps and formatted old/new values. Mapped into Twenty's `TimelineActivity` system, these render as **native-looking field diff cards** — exactly the same UI as if a user had edited the deal inside Twenty.

### What was fetched

From `data/raw/deal_flows.json` (4,237 total events across 483 deals):

| Flow event type | Count | What it is                              |
|----------------|-------|-----------------------------------------|
| `activity`     | 1,637 | Calls/meetings/tasks linked to deal     |
| `dealChange`   | 1,529 | Field edits with before/after values    |
| `note`         | 896   | Notes linked to deal                    |
| `file`         | 93    | File attachments                        |
| `mailMessage`  | 82    | Emails linked to deal                   |

Of the 1,529 `dealChange` events:

| Field changed         | Count | Twenty equivalent       |
|-----------------------|-------|-------------------------|
| `stage_id`            | 685   | `stage`                 |
| `add_time`            | 483   | (creation event)        |
| `status`              | 168   | `stage` (WON / LOST)    |
| `user_id`             | 84    | `owner`                 |
| `value`               | 81    | `amount`                |
| `person_id`           | 23    | `pointOfContact`        |
| `expected_close_date` | 5     | `closeDate`             |

**377 of 483 deals have at least one stage transition.** This is the deal pipeline journey — fully recoverable.

---

### How Twenty renders this

Twenty's timeline reads `TimelineActivity` records and branches on the `name` field:

- `opportunity.created` → "Pekka created this deal" with creation icon
- `opportunity.updated` → "Pekka updated [N fields]" with expandable diff card
- `linked-note.created` → "Pekka added a note: [title]" with note icon, clickable
- `linked-task.created` → "Pekka added a call: [subject]" with task icon, clickable

The `properties.diff` object powers the expandable card for updates:

```json
{
  "diff": {
    "stage": {
      "before": "OMA_SOITTOON",
      "after": "OMA_PALAVEERATTU_ICEBOX"
    }
  }
}
```

Twenty looks up the field by name in metadata, uses its label and icon, and renders the before/after values using the field's display component (e.g. SELECT shows the option label, CURRENCY shows formatted money).

---

### dealChange → TimelineActivity mapping

#### Field key → Twenty field name

| Pipedrive `field_key` | Twenty field `name` | Value transform                                    |
|-----------------------|---------------------|----------------------------------------------------|
| `stage_id`            | `stage`             | old/new stage_id → stage SELECT value (from stage map §3) |
| `status`              | `stage`             | "won" → "WON", "lost" → "LOST"                    |
| `user_id`             | `owner`             | Use `additional_data.old_value_formatted` / `new_value_formatted` |
| `value`               | `amount`            | Build CurrencyMetadata: `{"amountMicros": v*1e6, "currencyCode": "EUR"}` |
| `person_id`           | `pointOfContact`    | Use `additional_data.new_value_formatted` (person name) |
| `expected_close_date` | `closeDate`         | ISO date string                                    |
| `add_time`            | *(skip — use for opportunity.created event)*       |

#### The `opportunity.created` event

The `add_time` dealChange signals the deal creation timestamp. Create one `opportunity.created` TimelineActivity per deal:

```python
{
    "name": "opportunity.created",
    "happensAt": deal["add_time"],
    "properties": {
        "after": {
            "name": deal["title"],
            "stage": mapped_stage,
            "amount": {"amountMicros": deal["value"] * 1_000_000, "currencyCode": deal["currency"]}
        }
    },
    "linkedRecordId": opportunity_uuid,
    "linkedRecordCachedName": deal["title"],
    "workspaceMemberId": user_map.get(str(deal["creator_user_id"])),
    "targetOpportunityId": opportunity_uuid
}
```

#### Stage transition events (685 events — the most valuable)

```python
for event in deal_flow:
    if event["object"] != "dealChange":
        continue
    data = event["data"]
    if data["field_key"] != "stage_id":
        continue

    old_stage_value = STAGE_ID_TO_TWENTY[str(data["old_value"])] if data["old_value"] else None
    new_stage_value = STAGE_ID_TO_TWENTY[str(data["new_value"])]
    new_stage_label = data.get("additional_data", {}).get("new_value_formatted", new_stage_value)

    insert_timeline_activity({
        "name": "opportunity.updated",
        "happensAt": event["timestamp"],
        "properties": {
            "diff": {
                "stage": {
                    "before": old_stage_value,
                    "after": new_stage_value
                }
            }
        },
        "linkedRecordId": opportunity_uuid,
        "linkedRecordCachedName": deal_title,
        "workspaceMemberId": user_map.get(str(data["user_id"])),
        "targetOpportunityId": opportunity_uuid
    })
```

This produces entries like:
```
● [pencil icon] Pekka updated stage
  ┌─────────────────────────────┐
  │ Stage                       │
  │ Soittoon → Palaveerattu     │
  └─────────────────────────────┘
```

#### Won / Lost events (168 events)

Status changes are the most significant events. They get their own variant:

```python
if data["field_key"] == "status" and data["new_value"] in ("won", "lost"):
    insert_timeline_activity({
        "name": "opportunity.updated",
        "happensAt": event["timestamp"],
        "properties": {
            "diff": {
                "stage": {
                    "before": last_known_stage,     # track from prior stage_id event
                    "after": "WON" if data["new_value"] == "won" else "LOST"
                }
            }
        },
        ...
    })
```

#### Owner reassignment events (84 events)

```python
if data["field_key"] == "user_id":
    old_name = data.get("additional_data", {}).get("old_value_formatted", "Unknown")
    new_name = data.get("additional_data", {}).get("new_value_formatted", "Unknown")
    insert_timeline_activity({
        "name": "opportunity.updated",
        "properties": {
            "diff": {
                "owner": {
                    "before": old_name,
                    "after": new_name
                }
            }
        },
        ...
    })
```

#### Value change events (81 events)

```python
if data["field_key"] == "value":
    insert_timeline_activity({
        "name": "opportunity.updated",
        "properties": {
            "diff": {
                "amount": {
                    "before": {"amountMicros": int(float(data["old_value"] or 0)) * 1_000_000, "currencyCode": "EUR"},
                    "after":  {"amountMicros": int(float(data["new_value"] or 0)) * 1_000_000, "currencyCode": "EUR"}
                }
            }
        },
        ...
    })
```

---

### Flow events for notes and activities

The `note` and `activity` events in the deal flow tell us **which deal** a note/activity was linked to and exactly **when** it was linked. These are handled by Phases E and F (NoteTarget/TaskTarget insertions), but the corresponding `TimelineActivity` rows should use the flow event timestamp, not `add_time`.

#### linked-note events

When inserting a NoteTarget row that links a note to an Opportunity, also insert:

```python
{
    "name": "linked-note.created",
    "happensAt": flow_event["timestamp"],     # from deal flow, not note.add_time
    "properties": {
        "diff": {
            "title": {"before": None, "after": note_title}
        }
    },
    "linkedRecordId": note_uuid,
    "linkedRecordCachedName": note_title,
    "linkedObjectMetadataId": note_object_metadata_id,
    "workspaceMemberId": user_map.get(str(flow_event["data"]["user_id"])),
    "targetOpportunityId": opportunity_uuid
}
```

This makes the note appear in the deal's timeline as a clickable entry that opens the note in the side panel.

#### linked-task (activity) events

Same pattern — for each `activity` event in the deal flow:

```python
{
    "name": "linked-task.created",
    "happensAt": flow_event["timestamp"],
    "properties": {
        "diff": {
            "title": {"before": None, "after": activity_subject}
        }
    },
    "linkedRecordId": task_uuid,
    "linkedRecordCachedName": activity_subject,
    "linkedObjectMetadataId": task_object_metadata_id,
    "workspaceMemberId": user_map.get(str(flow_event["data"]["user_id"])),
    "targetOpportunityId": opportunity_uuid
}
```

---

### File events (93 events)

Pipedrive file attachments have no direct path to Twenty (no file content, just metadata). Insert as informational timeline entries:

```python
{
    "name": "opportunity.updated",
    "happensAt": event["timestamp"],
    "properties": {
        "diff": {
            "attachment": {
                "before": None,
                "after": event["data"].get("name", "file")
            }
        }
    },
    ...
}
```

Or skip entirely if file migration is out of scope.

---

### Complete timeline picture per deal

After Phase I, a deal page in Twenty will show a chronological feed like:

```
│ November 2023 ──────────────────────────────────────
├─ [+] Pekka created deal "Acme Renewal"
│        Value: €0 · Stage: Palaveerattu (Icebox)
│
│ September 2023 ──────────────────────────────────────
├─ [✏] Pekka updated stage
│        Soittoon → Jatkopalsut
│
├─ [✏] Roope updated owner
│        Aleksi Puttonen → Roope Lassila
│
├─ [📝] Roope added a note
│        "Palaverin muistiinpanot: QAutomatella..."  ← clickable, opens note
│
├─ [☎] Roope logged a call: "Follow-up call"         ← clickable, opens task
│
│ June 2023 ──────────────────────────────────────────
├─ [✏] Pekka updated amount
│        €16,800 → €13,000
│
└─ [✏] Pekka updated stage
         Uudet palaverit → Soittoon
```

This is functionally identical to Pipedrive's deal history timeline.

---

### Expected output from Phase I

| Event type             | Count  |
|------------------------|--------|
| `opportunity.created`  | ~483   |
| `opportunity.updated` (stage) | ~685 |
| `opportunity.updated` (status) | ~168 |
| `opportunity.updated` (owner) | ~84 |
| `opportunity.updated` (value) | ~81 |
| `opportunity.updated` (other) | ~28 |
| `linked-note.created`  | ~896   |
| `linked-task.created`  | ~1,637 |
| **Total new TimelineActivity rows** | **~4,062** |

Combined with the ~8,000 from Phase H (non-deal activities, person/company timeline), total timeline rows: **~12,000**.

---

### Implementation notes

- Load `data/raw/deal_flows.json` — already fetched (4,237 events, 0 errors)
- Process events per deal in chronological order (sort by `timestamp` ascending)
- Track `last_known_stage` per deal as you iterate, so status-change events can reference it
- `linkedObjectMetadataId` requires querying `objectMetadata` table after workspace setup:
  ```sql
  SELECT id FROM "objectMetadata" WHERE "nameSingular" = 'note';   -- for linked-note
  SELECT id FROM "objectMetadata" WHERE "nameSingular" = 'task';   -- for linked-task
  ```
- Inactive user IDs (e.g. Aleksi 14953693) should have `workspaceMemberId: null` — the name still shows from `additional_data.old_value_formatted`

---

## 16. Validation Checklist

Run these queries after migration to verify integrity:

```sql
-- Company count
SELECT COUNT(*) FROM "company";  -- expect ~2067

-- Person count
SELECT COUNT(*) FROM "person";  -- expect ~2864

-- Persons linked to company
SELECT COUNT(*) FROM "person" WHERE "companyId" IS NOT NULL;  -- expect ~2308

-- Opportunity count
SELECT COUNT(*) FROM "opportunity";  -- expect ~743 (483 deals + 260 leads)

-- Opportunities with company
SELECT COUNT(*) FROM "opportunity" WHERE "companyId" IS NOT NULL;  -- expect ~740

-- Note count
SELECT COUNT(*) FROM "note";  -- expect ~1585

-- NoteTarget count
SELECT COUNT(*) FROM "noteTarget";  -- expect ~3500+

-- Task count
SELECT COUNT(*) FROM "task";  -- expect ~6081

-- TaskTarget count
SELECT COUNT(*) FROM "taskTarget";  -- expect ~8000+

-- Check for orphaned noteTargets (null note)
SELECT COUNT(*) FROM "noteTarget" WHERE "noteId" IS NULL;  -- expect 0

-- Check for orphaned taskTargets
SELECT COUNT(*) FROM "taskTarget" WHERE "taskId" IS NULL;  -- expect 0

-- Sample: verify a specific company has notes
SELECT n.title, n."createdAt"
FROM "note" n
JOIN "noteTarget" nt ON nt."noteId" = n.id
JOIN "company" c ON c.id = nt."targetCompanyId"
WHERE c.name = 'QAutomate Oy'
ORDER BY n."createdAt";
```

---

## 17. ID Mapping File Strategy

During migration, save Pipedrive ID → Twenty UUID maps to JSON files:

```
data/id_maps/
  companies.json      { "1": "uuid-...", "2": "uuid-...", ... }
  persons.json        { "1": "uuid-...", ... }
  deals.json          { "1": "uuid-...", ... }
  leads.json          { "27d55d50-95e4...": "uuid-...", ... }
  activities.json     { "2": "uuid-...", ... }
  notes.json          { "1": "uuid-...", ... }
  users.json          { "14953704": "twenty-member-uuid", ... }
```

These maps are used by later phases to resolve foreign keys. They should be loaded at the start of each migration phase and updated as new records are inserted.

---

## 17. Script Execution Order

The existing `init_migration.py` script needs to be **rewritten** to reflect this plan. The new flow:

```bash
# Step 1: One-time setup (before running scripts)
# - Create custom fields in Twenty UI (see §5)
# - Create user_map.json manually (see §4)
# - Create Product custom object in Twenty UI (see §G)

# Step 2: Fetch fresh data (already done, but re-run before final migration)
python fetch_and_export.py

# Step 3: Run migration phases in order
python migrate.py --phase companies        # Phase A
python migrate.py --phase persons          # Phase B
python migrate.py --phase deals            # Phase C
python migrate.py --phase leads            # Phase D
python migrate.py --phase notes            # Phase E
python migrate.py --phase activities       # Phase F
python migrate.py --phase products         # Phase G
python migrate.py --phase timeline         # Phase H

# Or run all at once:
python migrate.py --all

# Step 4: Validate
python validate.py

# Step 5: (Optional) incremental sync
python update_migration.py --neon
```

### Script architecture (`migrate.py`)

```python
# Pseudocode structure
class MigrationRunner:
    def __init__(self, db_url, id_maps_dir):
        self.db = connect(db_url)
        self.id_maps = load_all_maps(id_maps_dir)

    def run_phase(self, phase: str):
        phases = {
            "companies":    self.migrate_companies,
            "persons":      self.migrate_persons,
            "deals":        self.migrate_deals,
            "leads":        self.migrate_leads,
            "notes":        self.migrate_notes,
            "activities":   self.migrate_activities,
            "products":     self.migrate_products,
            "timeline":     self.migrate_timeline,
            "deal_history": self.migrate_deal_history,   # Phase I
        }
        phases[phase]()
        self.save_maps()

    def migrate_companies(self):
        orgs = load_json("data/raw/organizations.json")
        workspace_id = self.get_workspace_id()
        for org in orgs:
            twenty_uuid = gen_uuid()
            self.insert_company(workspace_id, org, twenty_uuid)
            self.id_maps["companies"][str(org["id"])] = twenty_uuid
```

---

## Summary

| Phase              | Records   | Complexity | Dependencies              |
|--------------------|----------:|------------|---------------------------|
| A: Orgs            | 2,067     | Low        | None                      |
| B: Persons         | 2,864     | Low        | A                         |
| C: Deals           | 483       | Medium     | A, B                      |
| D: Leads           | 260       | Medium     | A, B                      |
| E: Notes           | 1,585     | Medium     | A, B, C, D                |
| F: Activities      | 6,081     | High       | A, B, C, D                |
| G: Products        | 14        | Low        | None                      |
| H: Timeline (gen.) | ~8,000    | High       | A, B, C, D, E, F          |
| I: Deal History    | ~4,062    | High       | C, D, E, F + deal_flows   |
| **Total**          | **~25,400** |          |                           |

**Critical path for data fidelity:** A → B → C → D (core objects with relationships). Notes and Tasks can be re-run independently. Phase I (deal history) requires Phase C + the pre-fetched `data/raw/deal_flows.json`.

**The most user-visible result** of a complete migration is Phase I: every deal page shows the full pipeline journey from creation through stage transitions to won/lost, with linked notes and calls — indistinguishable from native Twenty activity.

All raw data is in `data/raw/` and schemas in `data/schemas/`. Deal flow history is in `data/raw/deal_flows.json` (4,237 events, 0 fetch errors). Custom field hash keys are in `data/schemas/custom_fields.json`.
