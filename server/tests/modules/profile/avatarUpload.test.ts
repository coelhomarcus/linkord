import { test, beforeEach, afterEach, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../../src/config/env.js';
import { db } from '../../../src/db/client.js';
import { filePathFor } from '../../../src/modules/attachments/attachmentStorage.js';
import { encodeAndStoreProfileImage } from '../../../src/modules/profile/avatarUpload.js';

let uploadDir: string;
let previousUploadDir: string;
const UPLOADER_ID = 'test-uploader';

beforeEach(async () => {
  previousUploadDir = config.UPLOAD_DIR;
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'linkord-avatar-test-'));
  config.UPLOAD_DIR = uploadDir;
  mock.method(db, 'insert', () => ({ values: async () => undefined }) as never);
});

afterEach(async () => {
  mock.restoreAll();
  config.UPLOAD_DIR = previousUploadDir;
  await fs.rm(uploadDir, { recursive: true, force: true });
});

async function staticJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 5, channels: 3, background: { r: 80, g: 140, b: 220 } },
  }).jpeg().toBuffer();
}

// Two 2x2 frames with a short delay, kept inline so this test does not need
// another fixture or image dependency.
function animatedGif(): Buffer {
  return Buffer.from(
    'R0lGODlhAgACAPcfMQAAACQAAEgAAGwAAJAAALQAANgAAPwAAAAkACQkAEgkAGwkAJAkALQkANgkAPwkAABIACRIAEhIAGxIAJBIALRIANhIAPxIAABsACRsAEhsAGxsAJBsALRsANhsAPxsAACQACSQAEiQAGyQAJCQALSQANiQAPyQAAC0ACS0AEi0AGyQAJC0ALSQANi0APy0AADYACTYAEjYAGzYAJDYALTYANjYAPzYAAD8ACT8AEj8AGz8AJD8ALT8ANj8APz8AAAAVSQAVUgAVWwAVZAAVbQAVdgAVfwAVQAkVSQkVUgkVWwkVZAkVbQkVdgkVfwkVQBIVSRIVUhIVWxIVZBIVbRIVdhIVfxIVQBsVSRsVUhsVWxsVZBsVbRsVdhsVfxsVQCQVSSQVUiQVWyQVZCQVbSQVdiQVfyQVQC0VSS0VUi0VWy0VZC0VbS0Vdi0Vfy0VQDYVSTYVUjYVWzYVZDYVbTYVdjYVfzYVQD8VST8VUj8VWz8VZD8VbT8Vdj8Vfz8VQAAqiQAqkgAqmwAqpAAqrQAqtgAqvwAqgAkqiQkqkgkqmwkqpAkqrQkqtgkqvwkqgBIqiRIqkhIqmxIqpBIqrRIqthIqvxIqgBsqiRsqkhsqmxsqpBsqrRsqthsqvxsqgCQqiSQqkiQqmyQqpCQqrSQqtiQqvyQqgC0qiS0qki0qmy0qpC0qrS0qti0qvy0qgDYqiTYqkjYqmzYqpDYqrTYqtjYqvzYqgD8qiT8qkj8qmz8qpDYqrTYqtjYqvzYqgAA/yQA/0gA/2wA/5AA/7QA/9gA//wA/wAk/yQk/0gk/2wk/5Ak/7Qk/9gk//wk/wBI/yRI/0hI/2xI/5BI/7RI/9hI//xI/wBs/yRs/0hs/2xs/5Bs/7Rs/9hs//xs/wCQ/ySQ/0iQ/2yQ/5CQ/7SQ/9iQ//yQ/wC0/yS0/0i0/2yQ/5C0/7S0/9i0//y0/wDY/yTY/0jY/2zY/5DY/7TY/9jY//zY/wD8/yT8/0j8/2z8/5D8/7T8/9j8//z8/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEMgAfACwAAAAAAgACAAAIBgAPCDwQEAAh+QQFMgAAACwAAAAAAgACAAAIBgCBCQQWEAA7',
    'base64',
  );
}

describe('encodeAndStoreProfileImage', () => {
  test('without a crop, stores a still JPEG as-is and skips the poster', async () => {
    const input = await staticJpeg();
    const result = await encodeAndStoreProfileImage(input, UPLOADER_ID);
    const id = result.avatar.split('/').pop()!;
    const stored = await fs.readFile(filePathFor(id));
    const metadata = await sharp(stored).metadata();

    assert.deepEqual(stored, input);
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 8);
    assert.equal(metadata.height, 5);
    assert.equal(result.avatarPoster, undefined);
  });

  test('without a crop, keeps an animated GIF and generates a JPEG poster', async () => {
    const result = await encodeAndStoreProfileImage(animatedGif(), UPLOADER_ID);
    const imageId = result.avatar.split('/').pop()!;
    const posterId = result.avatarPoster?.split('/').pop();
    const imageMetadata = await sharp(await fs.readFile(filePathFor(imageId)), { animated: true }).metadata();
    const posterMetadata = await sharp(await fs.readFile(filePathFor(posterId!))).metadata();

    assert.equal(imageMetadata.format, 'gif');
    assert.equal(imageMetadata.pages, 2);
    assert.equal(posterMetadata.format, 'jpeg');
    assert.equal(posterMetadata.width, 2);
    assert.equal(posterMetadata.height, 2);
  });

  test('crops a still to the picked rect, as JPEG', async () => {
    const input = await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const result = await encodeAndStoreProfileImage(input, UPLOADER_ID, { left: 5, top: 4, width: 20, height: 20 });
    const metadata = await sharp(await fs.readFile(filePathFor(result.avatar.split('/').pop()!))).metadata();

    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['jpeg', 20, 20]);
    assert.equal(result.avatarPoster, undefined);
  });

  test('crops every frame of an animated GIF and the poster with it', async () => {
    const frames = await Promise.all([0, 1, 2].map((i) => sharp({ create: { width: 30, height: 20, channels: 4, background: { r: i * 100, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()));
    const gif = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
    const result = await encodeAndStoreProfileImage(gif, UPLOADER_ID, { left: 10, top: 2, width: 16, height: 16 });
    const image = await sharp(await fs.readFile(filePathFor(result.avatar.split('/').pop()!)), { animated: true }).metadata();
    const poster = await sharp(await fs.readFile(filePathFor(result.avatarPoster!.split('/').pop()!))).metadata();

    assert.deepEqual([image.format, image.width, image.pageHeight, image.pages], ['gif', 16, 16, 3]);
    assert.deepEqual([poster.format, poster.width, poster.height], ['jpeg', 16, 16]);
  });

  test('reads the rect in the orientation the browser showed', async () => {
    // stored 40x20 and rotated by EXIF, so the person saw it 20x40
    const input = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#3a6' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await encodeAndStoreProfileImage(input, UPLOADER_ID, { left: 0, top: 20, width: 20, height: 20 });
    const metadata = await sharp(await fs.readFile(filePathFor(result.avatar.split('/').pop()!))).metadata();

    assert.deepEqual([metadata.width, metadata.height], [20, 20]);
  });

  test('pulls a rect rounded a pixel past the edge back inside', async () => {
    const result = await encodeAndStoreProfileImage(await staticJpeg(), UPLOADER_ID, { left: 3, top: 0, width: 6, height: 5 });
    const metadata = await sharp(await fs.readFile(filePathFor(result.avatar.split('/').pop()!))).metadata();

    assert.deepEqual([metadata.width, metadata.height], [5, 5]);
  });

  test('refuses a rect outside the picture and stores nothing', async () => {
    const input = await staticJpeg();
    await assert.rejects(
      () => encodeAndStoreProfileImage(input, UPLOADER_ID, { left: 4, top: 0, width: 8, height: 5 }),
      (err: Error & { code?: string }) => err.code === 'invalid_crop',
    );
    assert.deepEqual(await fs.readdir(uploadDir), []);
  });

  test('rejects bytes that are not an image', async () => {
    await assert.rejects(
      () => encodeAndStoreProfileImage(Buffer.from('not-an-image'), UPLOADER_ID),
      /Não foi possível processar a imagem/,
    );
  });

  test('removes the main file if writing the attachment fails', async () => {
    mock.restoreAll();
    mock.method(db, 'insert', () => ({ values: async () => { throw new Error('db offline'); } }) as never);

    const input = await staticJpeg();
    await assert.rejects(() => encodeAndStoreProfileImage(input, UPLOADER_ID), /db offline/);
    assert.deepEqual(await fs.readdir(uploadDir), []);
  });
});
