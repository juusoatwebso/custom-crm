import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, "../crm-migration/data/raw");

interface DealFlowEvent {
  object: "dealChange" | "activity" | "note" | "file" | "mailMessage";
  timestamp: string;
  data: any;
}

type DealFlows = Record<string, DealFlowEvent[]>;

function htmlToText(html: string | null): string {
  if (!html) return "";
  let text = html
    // Replace <br>, <br/>, <p>, <div> with newlines
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]*>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Clean up whitespace: collapse multiple spaces on same line, but preserve newlines
    .replace(/[^\S\n]+/g, " ")
    // Collapse 3+ newlines into 2
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

const EVENT_TYPE_MAP: Record<string, string> = {
  dealChange: "DEAL_CHANGE",
  activity: "ACTIVITY",
  note: "NOTE",
  file: "FILE",
  mailMessage: "MAIL_MESSAGE",
};

async function main() {
  console.log("Starting deal flows import...");

  // Build pipedrive deal ID -> DB deal ID map
  const deals = await prisma.deal.findMany({
    where: { pipedriveId: { not: null } },
    select: { id: true, pipedriveId: true },
  });
  const dealMap = new Map<string, string>();
  for (const deal of deals) {
    if (deal.pipedriveId) {
      dealMap.set(deal.pipedriveId, deal.id);
    }
  }
  console.log(`Found ${dealMap.size} deals with pipedriveId`);

  // Build user map
  const users = await prisma.user.findMany({
    where: { pipedriveId: { not: null } },
    select: { id: true, name: true, pipedriveId: true },
  });
  const userMap = new Map<number, { id: string; name: string }>();
  for (const user of users) {
    if (user.pipedriveId) {
      userMap.set(user.pipedriveId, { id: user.id, name: user.name });
    }
  }

  // Clear existing flow events
  const deleted = await prisma.dealFlowEvent.deleteMany();
  console.log(`Cleared ${deleted.count} existing flow events`);

  // Read deal flows
  const filepath = path.join(DATA_DIR, "deal_flows.json");
  const content = fs.readFileSync(filepath, "utf-8");
  const dealFlows: DealFlows = JSON.parse(content);

  let imported = 0;
  let skipped = 0;
  const batchSize = 500;
  let batch: any[] = [];

  for (const [pipedriveDealId, events] of Object.entries(dealFlows)) {
    const dealDbId = dealMap.get(pipedriveDealId);
    if (!dealDbId) {
      skipped += events.length;
      continue;
    }

    for (const event of events) {
      const eventType = EVENT_TYPE_MAP[event.object];
      if (!eventType) continue;

      const userId = event.data?.user_id
        ? userMap.get(event.data.user_id)
        : event.data?.created_by_user_id
          ? userMap.get(event.data.created_by_user_id)
          : null;

      const record: any = {
        eventType,
        timestamp: new Date(event.timestamp),
        dealId: dealDbId,
        userId: userId?.id || null,
        userName: userId?.name || event.data?.owner_name || null,
      };

      if (event.object === "dealChange") {
        record.fieldKey = event.data.field_key || null;
        record.oldValue = event.data.old_value ? String(event.data.old_value) : null;
        record.newValue = event.data.new_value ? String(event.data.new_value) : null;
        record.oldValueFormatted = event.data.additional_data?.old_value_formatted
          ? String(event.data.additional_data.old_value_formatted)
          : null;
        record.newValueFormatted = event.data.additional_data?.new_value_formatted
          ? String(event.data.additional_data.new_value_formatted)
          : null;
        record.pipedriveId = event.data.id || null;
      } else if (event.object === "activity") {
        record.activitySubject = event.data.subject || null;
        record.activityType = event.data.type_name || event.data.type || null;
        record.activityDone = event.data.done ?? null;
        record.pipedriveId = event.data.id || null;
        // Capture linked note or public_description from activity
        const actNote = event.data.note ? htmlToText(event.data.note) : null;
        const actDesc = event.data.public_description ? htmlToText(event.data.public_description) : null;
        record.noteContent = actNote || actDesc || null;
      } else if (event.object === "note") {
        record.noteContent = event.data.content
          ? htmlToText(event.data.content)
          : null;
        record.pipedriveId = event.data.id || null;
        record.userName = event.data.user?.name || userId?.name || null;
      } else if (event.object === "file") {
        record.fileName = event.data.name || event.data.file_name || null;
        record.pipedriveId = event.data.id || null;
      } else if (event.object === "mailMessage") {
        record.mailSubject = event.data.subject || null;
        record.pipedriveId = event.data.id || null;
        // Capture email snippet
        record.noteContent = event.data.snippet ? String(event.data.snippet).trim() : null;
      }

      batch.push(record);

      if (batch.length >= batchSize) {
        await prisma.dealFlowEvent.createMany({ data: batch });
        imported += batch.length;
        process.stdout.write(`\rImported ${imported} events...`);
        batch = [];
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await prisma.dealFlowEvent.createMany({ data: batch });
    imported += batch.length;
  }

  console.log(`\n✓ Imported ${imported} deal flow events (skipped ${skipped} for unmapped deals)`);

  // Summary
  const counts = await prisma.dealFlowEvent.groupBy({
    by: ["eventType"],
    _count: true,
  });
  console.log("\nEvent type breakdown:");
  for (const c of counts) {
    console.log(`  ${c.eventType}: ${c._count}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
