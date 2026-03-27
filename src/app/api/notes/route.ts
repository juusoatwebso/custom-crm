import { prisma } from "@/lib/prisma";
import { noteSchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "0");
    const pageSize = parseInt(searchParams.get("pageSize") || "25");
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    const skip = Math.max(0, page * pageSize);

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const [data, total] = await Promise.all([
      prisma.note.findMany({
        skip,
        take: pageSize,
        orderBy,
        include: {
          organization: true,
          person: true,
          deal: true,
          author: true,
        },
      }),
      prisma.note.count(),
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
    const validatedData = noteSchema.parse(body);

    // Clean empty strings for relation fields
    const cleanedData: Record<string, any> = { ...validatedData };
    const relationFields = ["organizationId", "personId", "dealId", "authorId"];
    for (const field of relationFields) {
      if (cleanedData[field] === "") cleanedData[field] = undefined;
    }

    const note = await prisma.note.create({
      data: cleanedData as any,
      include: {
        organization: true,
        person: true,
        deal: true,
        author: true,
      },
    });

    return NextResponse.json(note, { status: 201 });
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
