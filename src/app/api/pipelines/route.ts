import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const pipelines = await prisma.pipeline.findMany({
      orderBy: {
        orderNr: "asc",
      },
      include: {
        stages: {
          orderBy: {
            orderNr: "asc",
          },
          include: {
            _count: {
              select: {
                deals: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ data: pipelines });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
