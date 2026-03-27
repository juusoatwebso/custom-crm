import { prisma } from "@/lib/prisma";
import { activitySchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "0");
    const pageSize = parseInt(searchParams.get("pageSize") || "25");
    const sortBy = searchParams.get("sortBy") || "subject";
    const sortOrder = searchParams.get("sortOrder") || "asc";
    const type = searchParams.get("type");
    const done = searchParams.get("done");
    const assigneeId = searchParams.get("assigneeId");

    const skip = Math.max(0, page * pageSize);

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const where: any = {
      isDeleted: false,
    };

    if (search) {
      where.subject = {
        contains: search,
        mode: "insensitive",
      };
    }

    if (type) {
      where.type = type;
    }

    if (done !== null && done !== undefined) {
      where.done = done === "true";
    }

    if (assigneeId) {
      where.assigneeId = assigneeId;
    }

    const [data, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          organization: true,
          person: true,
          deal: true,
          assignee: true,
        },
      }),
      prisma.activity.count({ where }),
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = activitySchema.parse(body);

    // Clean empty strings for relation fields and convert dueDate
    const cleanedData: Record<string, any> = { ...validatedData };
    const relationFields = ["organizationId", "personId", "dealId", "assigneeId"];
    for (const field of relationFields) {
      if (cleanedData[field] === "") cleanedData[field] = undefined;
    }
    // Convert dueDate string to Date for Prisma DateTime field
    if (cleanedData.dueDate && typeof cleanedData.dueDate === "string") {
      cleanedData.dueDate = new Date(cleanedData.dueDate);
    }
    if (cleanedData.dueDate === "") cleanedData.dueDate = undefined;
    if (cleanedData.dueTime === "") cleanedData.dueTime = undefined;
    if (cleanedData.duration === "") cleanedData.duration = undefined;
    if (cleanedData.location === "") cleanedData.location = undefined;
    if (cleanedData.note === "") cleanedData.note = undefined;

    const activity = await prisma.activity.create({
      data: cleanedData as any,
      include: {
        organization: true,
        person: true,
        deal: true,
        assignee: true,
      },
    });

    return NextResponse.json(activity, { status: 201 });
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
