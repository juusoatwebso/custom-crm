import { prisma } from "@/lib/prisma";
import { organizationSchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "0");
    const pageSize = parseInt(searchParams.get("pageSize") || "25");
    const sortBy = searchParams.get("sortBy") || "name";
    const sortOrder = searchParams.get("sortOrder") || "asc";

    const skip = Math.max(0, page * pageSize);

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const where: any = {
      isDeleted: false,
    };

    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [data, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          _count: {
            select: {
              persons: true,
              deals: true,
            },
          },
          owner: true,
        },
      }),
      prisma.organization.count({ where }),
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
    const validatedData = organizationSchema.parse(body);

    // Clean empty strings for relation fields
    const cleanedData: Record<string, any> = { ...validatedData };
    if (cleanedData.ownerId === "") cleanedData.ownerId = undefined;

    const organization = await prisma.organization.create({
      data: cleanedData as any,
      include: {
        _count: {
          select: {
            persons: true,
            deals: true,
          },
        },
        owner: true,
      },
    });

    return NextResponse.json(organization, { status: 201 });
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
