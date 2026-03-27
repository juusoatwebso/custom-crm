import { prisma } from "@/lib/prisma";
import { personSchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search") || "";
    const rawPage = parseInt(searchParams.get("page") || "0");
    const pageSize = parseInt(searchParams.get("pageSize") || "25");
    const sortBy = searchParams.get("sortBy") || "firstName";
    const sortOrder = searchParams.get("sortOrder") || "asc";

    const page = rawPage;
    const skip = Math.max(0, page * pageSize);

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const where: any = {
      isDeleted: false,
    };

    if (search) {
      where.OR = [
        {
          firstName: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          lastName: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.person.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          organization: true,
          _count: {
            select: {
              deals: true,
            },
          },
        },
      }),
      prisma.person.count({ where }),
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
    const validatedData = personSchema.parse(body);

    // Clean empty strings for relation fields
    const cleanedData: Record<string, any> = { ...validatedData };
    if (cleanedData.organizationId === "") cleanedData.organizationId = undefined;
    if (cleanedData.ownerId === "") cleanedData.ownerId = undefined;
    if (cleanedData.email === "") cleanedData.email = undefined;

    const person = await prisma.person.create({
      data: cleanedData as any,
      include: {
        organization: true,
        _count: {
          select: {
            deals: true,
          },
        },
      },
    });

    return NextResponse.json(person, { status: 201 });
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
