import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  videos,
  annotations,
  scenes,
  keyMoments,
  folders,
  folderVideos,
} from "@/lib/schema";
import { ilike, or, eq, and, inArray } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ query: q ?? "", results: [], total: 0 });
  }

  const pattern = `%${q}%`;
  const tagSearch = q.startsWith("#") ? q.slice(1) : q;
  const tagPattern = `%"${tagSearch.replace(/[\\%_"]/g, "\\$&")}"%`;

  // If the query itself is a 4-digit year (e.g. "2019"), also match videos whose
  // Year field equals it — this lets users search by year in the query box.
  const qYear = /^\d{4}$/.test(q) ? parseInt(q, 10) : null;

  const typeParam = request.nextUrl.searchParams.get("type");
  const typeFilter =
    typeParam === "annotation" ||
    typeParam === "scene" ||
    typeParam === "key_moment" ||
    typeParam === "video"
      ? typeParam
      : null;

  const limit = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const offset = Math.max(
    parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0,
    0,
  );
  const folderIdParam = request.nextUrl.searchParams.get("folderId");
  const folderId = folderIdParam ? parseInt(folderIdParam, 10) : null;
  const yearParam = request.nextUrl.searchParams.get("year");
  const yearFilter = yearParam ? parseInt(yearParam, 10) : null;

  // Get user's video IDs
  const userVideoIds = await db
    .select({ id: videos.id })
    .from(videos)
    .where(
      yearFilter
        ? and(eq(videos.userId, session.user.id as string), eq(videos.year, yearFilter))
        : eq(videos.userId, session.user.id as string),
    );
  let userVideoIdArr = userVideoIds.map((v) => v.id);

  if (userVideoIdArr.length === 0) {
    return NextResponse.json({ query: q, results: [], total: 0 });
  }

  // If folderId provided, intersect with videos in that folder
  if (folderId) {
    const folderRows = await db
      .select({ videoId: folderVideos.videoId })
      .from(folderVideos)
      .where(eq(folderVideos.folderId, folderId));
    const folderVideoIds = new Set(folderRows.map((r) => r.videoId));
    userVideoIdArr = userVideoIdArr.filter((id) => folderVideoIds.has(id));
    if (userVideoIdArr.length === 0) {
      return NextResponse.json({ query: q, results: [], total: 0 });
    }
  }

  const matchedAnnotations =
    typeFilter && typeFilter !== "annotation"
      ? []
      : await db
          .select({
            id: annotations.id,
            videoId: annotations.videoId,
            timestamp: annotations.timestampStart,
            endTimestamp: annotations.timestampEnd,
            title: annotations.label,
            detail: annotations.note,
            tags: annotations.tags,
          })
          .from(annotations)
          .where(
            and(
              or(
                ilike(annotations.label, pattern),
                ilike(annotations.note, pattern),
                ilike(annotations.tags, tagPattern),
              ),
              inArray(annotations.videoId, userVideoIdArr),
            ),
          );

  const matchedScenes =
    typeFilter && typeFilter !== "scene"
      ? []
      : await db
          .select({
            videoId: scenes.videoId,
            timestamp: scenes.timestamp,
            title: scenes.aiDescription,
            detail: scenes.aiTags,
          })
          .from(scenes)
          .where(
            and(
              or(
                ilike(scenes.aiDescription, pattern),
                ilike(scenes.aiTags, pattern),
              ),
              inArray(scenes.videoId, userVideoIdArr),
            ),
          );

  const matchedMoments =
    typeFilter && typeFilter !== "key_moment"
      ? []
      : await db
          .select({
            videoId: keyMoments.videoId,
            timestamp: keyMoments.timestamp,
            title: keyMoments.title,
            detail: keyMoments.description,
          })
          .from(keyMoments)
          .where(
            and(
              or(
                ilike(keyMoments.title, pattern),
                ilike(keyMoments.description, pattern),
              ),
              inArray(keyMoments.videoId, userVideoIdArr),
            ),
          );

  // Videos matching by title, channel, or year
  const matchedVideos =
    typeFilter && typeFilter !== "video"
      ? []
      : await db
          .select({ id: videos.id, title: videos.title, channel: videos.channel, year: videos.year })
          .from(videos)
          .where(
            and(
              or(
                ilike(videos.title, pattern),
                ilike(videos.channel, pattern),
                ...(qYear != null ? [eq(videos.year, qYear)] : []),
              ),
              inArray(videos.id, userVideoIdArr),
            ),
          );

  const results: {
    type: string;
    videoId: number;
    videoTitle: string | null;
    videoThumbnail: string | null;
    videoYear: number | null;
    videoChannel: string | null;
    folderName: string | null;
    timestamp: number;
    endTimestamp: number | null;
    title: string;
    detail: string | null;
    tags?: string[];
  }[] = [];

  for (const a of matchedAnnotations) {
      results.push({
      type: "annotation",
      videoId: a.videoId,
      videoTitle: null,
      videoThumbnail: null,
      videoYear: null,
      videoChannel: null,
      folderName: null,
      timestamp: a.timestamp,
      endTimestamp: a.endTimestamp ?? null,
      title: a.title,
      detail: a.detail,
      tags: a.tags ? JSON.parse(a.tags) : [],
    });
  }

  for (const s of matchedScenes) {
    results.push({
      type: "scene",
      videoId: s.videoId,
      videoTitle: null,
      videoThumbnail: null,
      videoYear: null,
      videoChannel: null,
      folderName: null,
      timestamp: s.timestamp,
      endTimestamp: null,
      title: s.title ?? "Scene",
      detail: s.detail,
    });
  }

  for (const m of matchedMoments) {
    results.push({
      type: "key_moment",
      videoId: m.videoId,
      videoTitle: null,
      videoThumbnail: null,
      videoYear: null,
      videoChannel: null,
      folderName: null,
      timestamp: m.timestamp,
      endTimestamp: null,
      title: m.title,
      detail: m.detail,
    });
  }

  for (const v of matchedVideos) {
    results.push({
      type: "video",
      videoId: v.id,
      videoTitle: v.title,
      videoThumbnail: null,
      videoYear: v.year,
      videoChannel: v.channel,
      folderName: null,
      timestamp: 0,
      endTimestamp: null,
      title: v.title ?? "Video",
      detail: v.channel,
    });
  }

  results.sort((a, b) => a.videoId - b.videoId || a.timestamp - b.timestamp);

  // Batch-fetch video metadata (fixes N+1)
  const allVideoIds = [...new Set(results.map((r) => r.videoId))];
  const videoMap = new Map<
    number,
    { id: number; title: string | null; thumbnailUrl: string | null; year: number | null; channel: string | null }
  >();
  if (allVideoIds.length > 0) {
    const vRows = await db
      .select({ id: videos.id, title: videos.title, thumbnailUrl: videos.thumbnailUrl, year: videos.year, channel: videos.channel })
      .from(videos)
      .where(inArray(videos.id, allVideoIds));
    for (const v of vRows) {
      videoMap.set(v.id, { id: v.id, title: v.title, thumbnailUrl: v.thumbnailUrl, year: v.year, channel: v.channel });
    }
  }

  const folderMap = new Map<number, string>();
  if (allVideoIds.length > 0) {
    const folderRows = await db
      .select({ videoId: folderVideos.videoId, folderName: folders.name })
      .from(folderVideos)
      .innerJoin(folders, eq(folderVideos.folderId, folders.id))
      .where(inArray(folderVideos.videoId, allVideoIds));
    for (const fr of folderRows) {
      if (!folderMap.has(fr.videoId)) folderMap.set(fr.videoId, fr.folderName);
    }
  }

  for (const r of results) {
    const v = videoMap.get(r.videoId);
    if (v) {
      r.videoTitle = v.title;
      r.videoThumbnail = v.thumbnailUrl;
      r.videoYear = v.year;
      r.videoChannel = v.channel;
    }
    r.folderName = folderMap.get(r.videoId) ?? null;
  }

  const total = results.length;
  const paged = results.slice(offset, offset + limit);

  return NextResponse.json({ query: q, results: paged, total });
}
