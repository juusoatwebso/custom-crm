import { prisma } from "@/lib/prisma";
import { activitySchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const activity = await prisma.activity.findUnique({
      where: { id },
      include: { organization: true, person: true, deal: true, assignee: true },
    });
    if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    return NextResponse.json(activity);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = activitySchema.partial().parse(body);

    // Clean empty strings for relation fields and convert dueDate
    const cleanedData: Record<string, any> = { ...validatedData };
    const relationFields = ["organizationId", "personId", "dealId", "assigneeId"];
    for (const field of relationFields) {
      if (cleanedData[field] === "") cleanedData[field] = undefined;
    }
    if (cleanedData.dueDate && typeof cleanedData.dueDate === "string") {
      cleanedData.dueDate = new Date(cleanedData.dueDate);
    }
    if (cleanedData.dueDate === "") cleanedData.dueDate = undefined;
    if (cleanedData.dueTime === "") cleanedData.dueTime = undefined;
    if (cleanedData.duration === "") cleanedData.duration = undefined;
    if (cleanedData.location === "") cleanedData.location = undefined;
    if (cleanedData.note === "") cleanedData.note = undefined;

    const activity = await prisma.activity.update({
      where: { id },
      data: cleanedData,
      include: { organization: true, person: true, deal: true, assignee: true },
    });
    return NextResponse.json(activity);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const activity = await prisma.activity.update({ where: { id }, data: { isDeleted: true } });
    return NextResponse.json(activity);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
