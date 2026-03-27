import { prisma } from "@/lib/prisma";
import { dealSchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search") || "";
    const rawPage = parseInt(searchParams.get("page") || "0");
    const pageSize = parseInt(searchParams.get("pageSize") || "25");
    const sortBy = searchParams.get("sortBy") || "title";
    const sortOrder = searchParams.get("sortOrder") || "asc";
    const status = searchParams.get("status");
    const pipelineId = searchParams.get("pipelineId");
    const isLead = searchParams.get("isLead");

    const page = rawPage;
    const skip = Math.max(0, page * pageSize);

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const where: any = {
      isDeleted: false,
    };

    if (search) {
      where.title = {
        contains: search,
        mode: "insensitive",
      };
    }

    if (status) {
      where.status = status;
    }

    if (pipelineId) {
      where.pipelineId = pipelineId;
    }

    if (isLead !== null && isLead !== undefined) {
      where.isLead = isLead === "true";
    }

    const [data, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          organization: true,
          person: true,
          stage: true,
          pipeline: true,
          owner: true,
        },
      }),
      prisma.deal.count({ where }),
    ]);

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Convert empty strings to undefined for optional relation fields
function cleanRelationFields(data: Record<string, any>): Record<string, any> {
  const relationFields = ["pipelineId", "stageId", "organizationId", "personId", "ownerId"];
  const cleaned = { ...data };
  for (const field of relationFields) {
    if (cleaned[field] === "") {
      cleaned[field] = undefined;
    }
  }
  return cleaned;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = dealSchema.parse(body);
    const cleanedData = cleanRelationFields(validatedData);

    // Default origin for CRM-created deals
    if (!cleanedData.origin) {
      cleanedData.origin = "CRM";
    }

    const deal = await prisma.deal.create({
      data: cleanedData as any,
      include: {
        organization: true,
        person: true,
        stage: true,
        pipeline: true,
        owner: true,
      },
    });

    return NextResponse.json(deal, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
