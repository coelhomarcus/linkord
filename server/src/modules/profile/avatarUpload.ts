import fs from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp, { type Metadata } from 'sharp';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable } from '../../db/schema.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { newId, filePathFor } from '../attachments/attachmentStorage.js';
import { hasRoomFor } from '../attachments/attachmentQuota.js';
import { cropPipeline, fitCrop, frameSize, parseCropParam, type CropRect } from '../attachments/imageCrop.js';
import * as floodControl from '../../realtime/floodControl.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'avatar' });

const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const FORMAT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

// This route had NO cap of any kind before — neither a per-request check nor
// a request-rate one — so a compromised account could hammer it (each hit
// doing real disk I/O) with nothing to stop it. 5/min is generous for an
// actual person picking a photo (including a few crop retries).
const AVATAR_UPLOAD_LIMIT = { windowMs: 60_000, max: 5 };

// The crop rect is in the source photo's own pixels, so the ceiling applies
// to what gets stored, not to the input (a 6000px camera photo is normal).
const MAX_OUTPUT_DIMENSION = 4096;
const FIT_OUTPUT = { width: MAX_OUTPUT_DIMENSION, height: MAX_OUTPUT_DIMENSION, fit: 'inside', withoutEnlargement: true } as const;

type ProfileImageErrorCode = 'crop_failed' | 'invalid_crop';

class ProfileImageProcessingError extends Error {
  readonly code: ProfileImageErrorCode;

  constructor(code: ProfileImageErrorCode, message: string) {
    super(message);
    this.name = 'ProfileImageProcessingError';
    this.code = code;
  }
}

function mimeForFormat(format: string | undefined): string | null {
  return format ? FORMAT_MIME[format] ?? null : null;
}

function unreadable(err: unknown): ProfileImageProcessingError {
  if (err instanceof ProfileImageProcessingError) return err;
  log.warn('avatar image could not be read', { err: err instanceof Error ? err.message : String(err) });
  return new ProfileImageProcessingError('crop_failed', 'Não foi possível processar a imagem.');
}

/** Crops and encodes like the crop dialog promised: animated WebP stays
 * WebP, other animations become GIF, stills become JPEG. */
async function cropAndEncode(buffer: Buffer, crop: CropRect, meta: Metadata, animated: boolean): Promise<{ data: Buffer; mime: string }> {
  const size = frameSize(meta);
  const rect = size && fitCrop(crop, size.width, size.height);
  if (!rect) throw new ProfileImageProcessingError('invalid_crop', 'Recorte fora dos limites da imagem.');
  const image = cropPipeline(buffer, rect, animated).resize(FIT_OUTPUT);
  if (animated && meta.format === 'webp') return { data: await image.webp({ quality: 90 }).toBuffer(), mime: 'image/webp' };
  if (animated) return { data: await image.gif().toBuffer(), mime: 'image/gif' };
  return { data: await image.jpeg({ quality: 92 }).toBuffer(), mime: 'image/jpeg' };
}

/** Crops (when `crop` is given) and stores a profile image; when animated,
 * also freezes the first frame as a JPEG poster for the call UI. Without a
 * crop the bytes are stored as they came: tabs on a build from before the
 * server cropped send an image the browser already cut. Sharp's default
 * pixel limit is the decompression-bomb guard. `uploaderId` is who gets to
 * later claim this as their own avatar/banner/server icon. */
export async function encodeAndStoreProfileImage(
  buffer: Buffer,
  uploaderId: string,
  crop: CropRect | null = null,
): Promise<{ avatar: string; avatarPoster: string | undefined }> {
  let stored: Buffer;
  let outMime: string;
  let animated = false;
  try {
    const meta = await sharp(buffer, { animated: true }).metadata();
    const frameHeight = meta.pageHeight ?? meta.height ?? 0;
    const mime = mimeForFormat(meta.format);
    if (!meta.width || !frameHeight || !mime) {
      throw new ProfileImageProcessingError('crop_failed', 'Não foi possível processar a imagem.');
    }
    animated = (meta.pages ?? 1) > 1;
    if (crop) {
      ({ data: stored, mime: outMime } = await cropAndEncode(buffer, crop, meta, animated));
    } else {
      stored = buffer;
      outMime = mime;
    }
  } catch (err) {
    throw unreadable(err);
  }

  const id = newId();
  await fs.writeFile(filePathFor(id), stored);
  try {
    await db.insert(attachmentsTable).values({ id, messageId: null, uploaderId, fileName: 'avatar', mimeType: outMime, size: stored.length });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }

  // For an animated avatar/banner, also freeze the first frame as a JPEG
  // "poster" — the call UI (Tile.tsx) shows this instead of the live
  // animation until the person actually speaks, same idea as Discord.
  // Best-effort: a failure here still leaves a perfectly good (animated)
  // avatar/banner, it just won't freeze in calls.
  let posterUrl: string | undefined;
  if (animated) {
    const posterId = newId();
    try {
      const posterBuffer = await sharp(stored, { animated: false }).jpeg({ quality: 88 }).toBuffer();
      await fs.writeFile(filePathFor(posterId), posterBuffer);
      try {
        await db.insert(attachmentsTable).values({ id: posterId, messageId: null, uploaderId, fileName: 'avatar-poster', mimeType: 'image/jpeg', size: posterBuffer.length });
        posterUrl = `/uploads/${posterId}`;
      } catch (err) {
        await fs.unlink(filePathFor(posterId)).catch(() => {});
        throw err;
      }
    } catch (err) {
      log.warn('failed to generate avatar poster', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  return { avatar: `/uploads/${id}`, avatarPoster: posterUrl };
}

/** Avatar upload — same storage/serving route as chat attachments
 * (`/uploads/<id>`), but the row is born with `messageId: null` (marks it
 * as an avatar, see schema.ts/getUsage). The body is the original file and
 * `?crop=x,y,width,height` the rect picked in the crop dialog.
 * Applying the result as the account's avatar happens in the existing
 * `profile` websocket flow, which also cleans up the old file. */
export async function handleAvatarUpload(request: FastifyRequest<{ Querystring: { crop?: string } }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  if (!floodControl.allow(`avatar:${sess.userId}`, AVATAR_UPLOAD_LIMIT)) {
    return sendError(reply, 429, 'rate_limited', 'Muitas trocas de foto em pouco tempo. Tente de novo em instantes.');
  }

  const mimeType = String(request.headers['content-type'] || '').split(';')[0]!.trim();
  if (!AVATAR_MIME_TYPES.has(mimeType)) {
    return sendError(reply, 400, 'invalid_type', 'Formato inválido. Use PNG, JPEG, GIF ou WEBP.');
  }

  const buffer = request.body as Buffer;
  if (!buffer || buffer.length === 0) return sendError(reply, 400, 'empty_file', 'Arquivo vazio.');

  const crop = parseCropParam(request.query.crop);
  if (request.query.crop !== undefined && !crop) return sendError(reply, 400, 'invalid_crop', 'Recorte inválido.');

  if (!(await hasRoomFor(buffer.length))) {
    log.warn('avatar upload refused: instance storage is full', { userId: sess.userId, size: buffer.length });
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio (30GB no total). Tente novamente mais tarde.');
  }

  try {
    const result = await encodeAndStoreProfileImage(buffer, sess.userId, crop);
    return sendJson(reply, 201, result);
  } catch (err) {
    if (err instanceof ProfileImageProcessingError) {
      log.warn('failed to store avatar', { err: err.message });
      return sendError(reply, 400, err.code, err.message);
    }
    log.warn('failed to store avatar', { err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
